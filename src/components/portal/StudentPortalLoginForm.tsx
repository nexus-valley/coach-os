"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthInput } from "@/src/components/auth/AuthInput";
import { Button } from "@/src/components/ui/Button";
import { signInWithPassword } from "@/src/lib/auth";
import { getCurrentStudentPortalContext } from "@/src/lib/studentPortalAuth";
import { getCurrentTenant } from "@/src/lib/tenant";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to sign in.";
}

export function StudentPortalLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    let active = true;

    async function redirectExistingSession() {
      const [portalContext, teamTenant] = await Promise.all([
        getCurrentStudentPortalContext().catch(() => null),
        getCurrentTenant().catch(() => null),
      ]);

      if (!active) {
        return;
      }

      if (portalContext) {
        router.replace("/portal");
        return;
      }

      if (teamTenant) {
        router.replace("/app");
      }
    }

    redirectExistingSession();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signInWithPassword(email.trim(), password);

      if (result.studentPortalAccount) {
        router.replace("/portal");
        return;
      }

      if (result.tenant) {
        router.replace("/app");
        return;
      }

      setError("No active student portal access is linked to this account.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <AuthInput
        autoComplete="email"
        label="Student email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="student@coachbrand.com"
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
        {loading ? "Signing in..." : "Open Student Portal"}
      </Button>
    </form>
  );
}
