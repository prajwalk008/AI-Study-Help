import crypto from "crypto";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "./mongo";

const COOKIE = "recall_session";
const TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || "30", 10);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

import { STORAGE_QUOTA_BYTES } from "./uploadLimits";

export interface SessionUser {
  id: string;
  email: string;
  storageQuotaBytes: number;
  storageUsedBytes: number;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: ObjectId): Promise<string> {
  // only the hash is stored, so a DB leak doesn't hand out live sessions
  const token = crypto.randomBytes(32).toString("hex");
  const db = await getDb();
  const now = new Date();
  await db.collection("sessions").insertOne({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeen: now,
    expiresAt: new Date(now.getTime() + TTL_MS),
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await db
    .collection("sessions")
    .findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;

  const user = await db.collection("users").findOne({ _id: session.userId });
  if (!user) return null;

  return {
    id: String(user._id),
    email: user.email,
    storageQuotaBytes: user.storageQuotaBytes ?? STORAGE_QUOTA_BYTES,
    storageUsedBytes: user.storageUsedBytes ?? 0,
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.collection("sessions").deleteOne({ tokenHash: hashToken(token) });
  }
  store.delete(COOKIE);
}
