"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
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

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      console.log("Attempting login with:", email);

      const tenant = await signInWithPassword(email.trim(), password);

      console.log("Login success. Tenant:", tenant);

      router.replace(tenant ? "/app" : "/onboarding");
    } catch (caught: unknown) {
      console.error("Login error:", caught);
      setError(getErrorMessage(caught));
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