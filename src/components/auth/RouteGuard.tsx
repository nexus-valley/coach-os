"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { requireClientSession } from "@/src/lib/auth";
import { createWorkspace, getCurrentTenant } from "@/src/lib/tenant";

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
        const demoIntent =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("demo") === "1";

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
          if (demoIntent) {
            setMessage("Preparing your demo workspace...");

            await createWorkspace({
              category: "Other",
              name: "CoachOS Demo Workspace",
            });

            if (!active) {
              return;
            }

            setAllowed(true);
            return;
          }

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
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(46,203,234,0.22),transparent_30rem),linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF7FC_100%)] px-5 text-[#0B1F33]">
        <div className="rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[#2ECBEA] shadow-lg shadow-[#2ECBEA]/25" />
          <p className="mt-5 text-sm font-medium text-[#425B76]">{message}</p>
        </div>
      </main>
    );
  }

  return children;
}
