"use client";

import { useState } from "react";
import { BrainCircuit, Loader2, ArrowRight, Mail } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-sm rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="gradient-btn mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
            <BrainCircuit className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Re<span className="gradient-text">call</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {step === "email" ? "Sign in with your email — no password needed." : `We sent a 6-digit code to ${email}`}
          </p>
          {step === "code" && (
            <p className="mt-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-medium text-amber-200">
              Don&apos;t see it? Check your spam folder.
            </p>
          )}
        </div>

        {step === "email" ? (
          <div className="flex flex-col gap-3">
            <div className="glass flex items-center gap-2 rounded-xl px-3">
              <Mail className="h-4 w-4 text-muted" />
              <input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && sendCode()}
                placeholder="you@example.com"
                className="flex-1 bg-transparent py-3 text-sm text-zinc-100 placeholder:text-muted focus:outline-none"
              />
            </div>
            <button
              onClick={sendCode}
              disabled={loading || !email.trim()}
              className="gradient-btn flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send code <ArrowRight className="h-4 w-4" /></>}
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
              placeholder="000000"
              className="glass rounded-xl py-3 text-center text-2xl font-mono tracking-[0.5em] text-zinc-100 placeholder:text-muted focus:outline-none"
            />
            <button
              onClick={verify}
              disabled={loading || code.length !== 6}
              className="gradient-btn flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & sign in"}
            </button>
            <button
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="text-xs text-muted hover:text-zinc-300"
            >
              ← Use a different email
            </button>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-center text-xs text-violet-200 hover:bg-violet-500/20"
              >
                Dev mode: open the test email to read your code →
              </a>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
