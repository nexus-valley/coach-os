"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { requireClientSession } from "@/src/lib/auth";
import { getCurrentTenant } from "@/src/lib/tenant";

type RouteGuardProps = {
  children: React.ReactNode;
  mode: "app" | "onboarding";
};

export function RouteGuard({ children, mode }: RouteGuardProps) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState("Checking your secure session...");

  useEffect(() => {
    let active = true;

    async function guardRoute() {
      try {
        const session = await requireClientSession();

        if (!active) {
          return;
        }

        if (!session) {
          router.replace("/login");
          return;
        }

        const tenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (mode === "app" && !tenant) {
          router.replace("/onboarding");
          return;
        }

        if (mode === "onboarding" && tenant) {
          router.replace("/app");
          return;
        }

        setAllowed(true);
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to verify access. Redirecting to login...");
        router.replace("/login");
      }
    }

    guardRoute();

    return () => {
      active = false;
    };
  }, [mode, router]);

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl shadow-black/20">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-white" />
          <p className="mt-5 text-sm font-medium text-zinc-300">{message}</p>
        </div>
      </main>
    );
  }

  return children;
}
