import nodemailer, { Transporter } from "nodemailer";

let cached: Transporter | null = null;

async function getTransport(): Promise<Transporter> {
  if (cached) return cached;
  if (process.env.USE_ETHEREAL === "true") {
    // fake SMTP inbox for local dev, nothing actually gets delivered
    const acc = await nodemailer.createTestAccount();
    cached = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: acc.user, pass: acc.pass },
    });
  } else {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return cached;
}

// returns an Ethereal preview link in dev, null once real SMTP is configured
export async function sendOtpEmail(to: string, code: string): Promise<string | null> {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM || "Recall <no-reply@recall.app>",
    to,
    subject: `${code} is your Recall verification code`,
    text: `Your Recall verification code is ${code}. It expires in 10 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:420px">
      <h2>Verify your email</h2>
      <p>Your Recall verification code is:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</div>
      <p style="color:#666">This code expires in 10 minutes.</p>
    </div>`,
  });
  return nodemailer.getTestMessageUrl(info) || null;
}
