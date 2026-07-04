import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { normalizeEmail, generateOtp, hashOtp } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/mailer";

export const runtime = "nodejs";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = normalizeEmail((body as { email?: unknown })?.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const db = await getDb();
  const otps = db.collection("otps");

  // Resend cooldown: don't let someone spam emails / regenerate codes rapidly.
  const existing = await otps.findOne({ email });
  if (existing?.lastSentAt && Date.now() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code." }, { status: 429 });
  }

  const code = generateOtp();
  const now = new Date();
  // One active OTP per email (unique index) — overwrite any previous code.
  await otps.updateOne(
    { email },
    {
      $set: {
        email,
        codeHash: hashOtp(email, code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        lastSentAt: now,
      },
    },
    { upsert: true }
  );

  let previewUrl: string | null = null;
  try {
    previewUrl = await sendOtpEmail(email, code);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to send email: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 502 }
    );
  }

  // previewUrl is only returned in dev (Ethereal) so you can open the email to read the code.
  return NextResponse.json({ ok: true, previewUrl });
}
