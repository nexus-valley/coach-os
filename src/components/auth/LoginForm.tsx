"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
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

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

function getCompatibleNextPath(params: {
  hasStudentPortal: boolean;
  hasTenant: boolean;
  nextPath: string | null;
}) {
  if (!params.nextPath) {
    return null;
  }

  if (params.nextPath.startsWith("/app")) {
    return params.hasTenant ? params.nextPath : null;
  }

  if (params.nextPath.startsWith("/portal")) {
    return params.hasStudentPortal ? params.nextPath : null;
  }

  return params.nextPath;
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
      const result = await signInWithPassword(email.trim(), password);
      const compatibleNextPath = getCompatibleNextPath({
        hasStudentPortal: Boolean(result.studentPortalAccount),
        hasTenant: Boolean(result.tenant),
        nextPath,
      });

      router.replace(
        compatibleNextPath ??
          (result.tenant
            ? "/app"
            : result.studentPortalAccount
              ? "/portal"
              : "/onboarding"),
      );
    } catch (caught: unknown) {
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
        placeholder="coach@yourbrand.com"
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

      <div className="text-right text-sm">
        <Link className="font-semibold text-[#145DA0]" href="/forgot-password">
          Forgot password?
        </Link>
      </div>

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
