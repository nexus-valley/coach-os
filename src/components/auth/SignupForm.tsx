"use client";

import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { GoogleOAuthButton } from "@/src/components/auth/GoogleOAuthButton";
import {
  maintenanceTestingMessage,
} from "@/src/components/marketing/EarlyAccessNotice";
import { Button } from "@/src/components/ui/Button";
import { requestAuthOtp, verifyAuthOtp } from "@/src/lib/authOtp";
import { signUpWithPassword } from "@/src/lib/auth";

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const isInviteSignup = nextPath?.startsWith("/invite/") ?? false;
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"details" | "otp">("details");

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    setLoading(true);

    try {
      const normalizedEmail = email.trim();

      if (step === "details") {
        await requestAuthOtp({
          email: normalizedEmail,
          purpose: "signup_email_verification",
        });
        setMessage("We sent a verification code to your email.");
        setCooldown(60);
        setStep("otp");
        return;
      }

      await verifyAuthOtp({
        email: normalizedEmail,
        otp: otp.trim(),
        purpose: "signup_email_verification",
      });

      await signUpWithPassword({
        email: normalizedEmail,
        fullName: fullName.trim(),
        password,
      });
      router.replace(nextPath ?? "/onboarding");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create your account. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      await requestAuthOtp({
        email: email.trim(),
        purpose: "signup_email_verification",
      });
      setMessage("We sent a new verification code to your email.");
      setCooldown(60);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to request a new code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
        <p className="font-semibold">Maintenance and testing</p>
        <p className="mt-1">{maintenanceTestingMessage}</p>
        {isInviteSignup ? (
          <p className="mt-3 font-semibold text-amber-900">
            This invite signup flow remains available for invited workspace users.
          </p>
        ) : null}
      </div>

      <GoogleOAuthButton
        disabled={loading}
        onError={setError}
        redirectPath={nextPath ?? undefined}
      />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-zinc-200" />
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
          or
        </span>
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <AuthInput
        autoComplete="name"
        label="Full name"
        onChange={(event) => setFullName(event.target.value)}
        placeholder="Your name"
        required
        type="text"
        value={fullName}
      />
      <AuthInput
        autoComplete="email"
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="coach@yourbrand.com"
        required
        type="email"
        value={email}
      />
      <AuthInput
        autoComplete="new-password"
        label="Password"
        minLength={6}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Create a secure password"
        required
        type="password"
        value={password}
      />

      {step === "otp" ? (
        <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <AuthInput
            autoComplete="one-time-code"
            inputMode="numeric"
            label="Verification code"
            maxLength={6}
            onChange={(event) => setOtp(event.target.value)}
            placeholder="6-digit code"
            required
            type="text"
            value={otp}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <button
              className="font-semibold text-[#145DA0] disabled:text-zinc-400"
              disabled={loading || cooldown > 0}
              onClick={handleResend}
              type="button"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <button
              className="font-semibold text-zinc-600"
              disabled={loading}
              onClick={() => {
                setStep("details");
                setOtp("");
                setMessage("");
                setError("");
              }}
              type="button"
            >
              Edit details
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button
        className="w-full"
        disabled={loading}
        size="lg"
        type="submit"
      >
        {loading
          ? step === "details"
            ? "Sending code..."
            : "Verifying..."
          : step === "details"
            ? "Send verification code"
            : "Verify and create account"}
      </Button>
    </form>
  );
}
