"use client";

import { useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { requestOtp, verifyOtp, type User } from "@/lib/api";

export default function LoginView({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    setLoading(true);
    try {
      const { previewUrl } = await requestOtp(email.trim());
      setPreviewUrl(previewUrl);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setError(null);
    setLoading(true);
    try {
      const { user } = await verifyOtp(email.trim(), code.trim());
      onSignedIn(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Recall</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {step === "email"
              ? "Enter your email to continue"
              : `Enter the code sent to ${email}`}
          </p>
          {step === "code" && (
            <p className="mt-3 text-xs text-[var(--muted)]">Don&apos;t see it? Check spam.</p>
          )}
        </div>

        {step === "email" ? (
          <div className="flex flex-col gap-3">
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && sendCode()}
              placeholder="Email address"
              className="w-full rounded-full border border-[var(--composer-border)] bg-white px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--text)]"
            />
            <button
              onClick={sendCode}
              disabled={loading || !email.trim()}
              className="flex items-center justify-center gap-2 rounded-full bg-[var(--send)] py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()}
              placeholder="6-digit code"
              className="w-full rounded-full border border-[var(--composer-border)] bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-[var(--text)] outline-none placeholder:tracking-normal placeholder:text-[var(--muted)] focus:border-[var(--text)]"
            />
            <button
              onClick={verify}
              disabled={loading || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-full bg-[var(--send)] py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
            </button>
            <button
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="text-center text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              Use a different email
            </button>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Dev: open test email
              </a>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-center text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}
