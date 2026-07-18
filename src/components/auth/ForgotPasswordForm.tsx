"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { Button } from "@/src/components/ui/Button";
import { requestAuthOtp } from "@/src/lib/authOtp";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const normalizedEmail = email.trim();
      const result = await requestAuthOtp({
        email: normalizedEmail,
        purpose: "password_reset",
      });
      setMessage(result.message);
      router.push(`/reset-password?email=${encodeURIComponent(normalizedEmail)}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to request a verification code.",
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

      <Button className="w-full" disabled={loading} size="lg" type="submit">
        {loading ? "Sending code..." : "Send reset code"}
      </Button>
    </form>
  );
}
