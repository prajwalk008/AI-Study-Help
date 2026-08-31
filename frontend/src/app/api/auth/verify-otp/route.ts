import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { normalizeEmail, hashOtp, safeEqualHex } from "@/lib/otp";
import { createSession, setSessionCookie } from "@/lib/session";
import { STORAGE_QUOTA_BYTES } from "@/lib/uploadLimits";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = normalizeEmail((body as { email?: unknown })?.email);
  const code = String((body as { code?: unknown })?.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter your email and the 6-digit code." }, { status: 400 });
  }

  const db = await getDb();
  const otps = db.collection("otps");
  const otp = await otps.findOne({ email });

  if (!otp) {
    return NextResponse.json({ error: "No code found. Request a new one." }, { status: 400 });
  }
  if (new Date(otp.expiresAt).getTime() < Date.now()) {
    await otps.deleteOne({ email });
    return NextResponse.json({ error: "Code expired. Request a new one." }, { status: 400 });
  }
  if ((otp.attempts ?? 0) >= MAX_ATTEMPTS) {
    await otps.deleteOne({ email });
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  const ok = safeEqualHex(otp.codeHash, hashOtp(email, code));
  if (!ok) {
    await otps.updateOne({ email }, { $inc: { attempts: 1 } });
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  // Success: burn the OTP, upsert the (now verified) user, start a session.
  await otps.deleteOne({ email });
  const users = db.collection("users");
  await users.updateOne(
    { email },
    {
      $set: { email, verified: true },
      $setOnInsert: {
        createdAt: new Date(),
        storageQuotaBytes: STORAGE_QUOTA_BYTES,
        storageUsedBytes: 0,
      },
    },
    { upsert: true }
  );
  const user = await users.findOne({ email });
  if (!user) {
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }

  const token = await createSession(user._id);
  await setSessionCookie(token);
  return NextResponse.json({
    user: {
      id: String(user._id),
      email: user.email,
      storageQuotaBytes: user.storageQuotaBytes ?? STORAGE_QUOTA_BYTES,
      storageUsedBytes: user.storageUsedBytes ?? 0,
    },
  });
}
