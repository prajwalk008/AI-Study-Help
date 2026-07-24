import crypto from "crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(email: string, code: string): string {
  // pepper so a DB leak alone doesn't hand out valid codes
  const pepper = process.env.OTP_PEPPER || "";
  return crypto.createHmac("sha256", pepper).update(`${email}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
