"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { Button } from "@/src/components/ui/Button";
import { resetPasswordWithOtp, verifyAuthOtp } from "@/src/lib/authOtp";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (newPassword !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const normalizedEmail = email.trim();
      const verification = await verifyAuthOtp({
        email: normalizedEmail,
        otp: otp.trim(),
        purpose: "password_reset",
      });

      if (!verification.resetToken) {
        throw new Error("Password reset verification failed.");
      }

      setResetToken(verification.resetToken);
      const result = await resetPasswordWithOtp({
        email: normalizedEmail,
        newPassword,
        resetToken: verification.resetToken,
      });

      setMessage(result.message);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to reset your password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
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

      <AuthInput
        autoComplete="new-password"
        label="New password"
        minLength={8}
        onChange={(event) => setNewPassword(event.target.value)}
        placeholder="Create a new password"
        required
        type="password"
        value={newPassword}
      />

      <AuthInput
        autoComplete="new-password"
        label="Confirm new password"
        minLength={8}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder="Repeat the new password"
        required
        type="password"
        value={confirmPassword}
      />

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}{" "}
          <Link className="font-semibold text-emerald-900" href="/login">
            Back to login
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button className="w-full" disabled={loading || Boolean(resetToken)} size="lg" type="submit">
        {loading ? "Resetting password..." : "Reset password"}
      </Button>
    </form>
  );
}
