"use client";

import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { GoogleOAuthButton } from "@/src/components/auth/GoogleOAuthButton";
import { Button } from "@/src/components/ui/Button";
import { signInWithPassword } from "@/src/lib/auth";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unable to sign in. Please try again.";
}

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const tenant = await signInWithPassword(email.trim(), password);

      router.replace(nextPath ?? (tenant ? "/app" : "/onboarding"));
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
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
        autoComplete="email"
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@academy.com"
        required
        type="email"
        value={email}
      />

      <AuthInput
        autoComplete="current-password"
        label="Password"
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Enter your password"
        required
        type="password"
        value={password}
      />

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button className="w-full" disabled={loading} size="lg" type="submit">
        {loading ? "Signing in..." : "Login"}
      </Button>
    </form>
  );
}
