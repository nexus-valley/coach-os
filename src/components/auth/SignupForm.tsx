"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { Button } from "@/src/components/ui/Button";
import { signUpWithPassword } from "@/src/lib/auth";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signUpWithPassword({
        email: email.trim(),
        fullName: fullName.trim(),
        password,
      });
      router.replace("/onboarding");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create your account. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
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
        placeholder="you@academy.com"
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

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button className="w-full" disabled={loading} size="lg" type="submit">
        {loading ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
