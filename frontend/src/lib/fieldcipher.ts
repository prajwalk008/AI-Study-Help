import crypto from "crypto";

const PREFIX = "v1.";

function fieldKey(): Buffer {
    const raw = (process.env.MONGO_FIELD_KEY || "").trim();
    if (!raw) throw new Error("MONGO_FIELD_KEY is not set.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("MONGO_FIELD_KEY must decode to 32 bytes.");
    return key;
}
/** Fingerprint used to find an account. It cannot be turned back into the email. */
export function emailFingerprint(email: string): string {
    return crypto.createHmac("sha256", fieldKey()).update(email).digest("hex");
}
export function encryptField(value: string, stamp: string): string {
    if (value.startsWith(PREFIX)) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", fieldKey(), iv);
    cipher.setAAD(Buffer.from(stamp, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}


export function decryptField(value: string, stamp: string): string {
    if (!value.startsWith(PREFIX)) return value;
    const parts = value.slice(PREFIX.length).split(".");
    if (parts.length !== 3) throw new Error("Locked value is damaged.");
    try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", fieldKey(), Buffer.from(parts[0], "base64url"));
        decipher.setAAD(Buffer.from(stamp, "utf8"));
        decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
        const plain = Buffer.concat([decipher.update(Buffer.from(parts[1], "base64url")), decipher.final()]);
        return plain.toString("utf8");
    } catch {
        throw new Error("Could not unlock this value. The key is wrong, or the value was changed.");
    }
}


export function encryptJson(value: unknown, stamp: string): string {
    return encryptField(JSON.stringify(value), stamp);
}


/** Old citation lists are still arrays. New ones are a locked string. */
export function decryptJson<T>(value: unknown, stamp: string): T | null {
    if (value == null) return null;
    if (typeof value !== "string") return value as T;
    if (!value.startsWith(PREFIX)) return value as T;
    return JSON.parse(decryptField(value, stamp)) as T;
}
export function openEmail(stored: unknown, lookup: unknown): string {
    if (typeof stored !== "string") return "";
    if (!stored.startsWith(PREFIX)) return stored;
    if (typeof lookup !== "string" || !lookup) throw new Error("Locked email is missing its lookup fingerprint.");
    return decryptField(stored, `users|email|${lookup}`);
}