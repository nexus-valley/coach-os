"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import {
  getCurrentStudentPortalContext,
  type StudentPortalContext,
} from "@/src/lib/studentPortalAuth";
import { getCurrentTenant } from "@/src/lib/tenant";

type StudentPortalGuardProps = {
  children: (context: StudentPortalContext) => React.ReactNode;
};

export function StudentPortalGuard({ children }: StudentPortalGuardProps) {
  const router = useRouter();
  const [context, setContext] = useState<StudentPortalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Checking your student portal access...");

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      try {
        const portalContext = await getCurrentStudentPortalContext();

        if (!active) {
          return;
        }

        if (portalContext) {
          setContext(portalContext);
          return;
        }

        const teamTenant = await getCurrentTenant().catch(() => null);

        if (!active) {
          return;
        }

        if (teamTenant) {
          router.replace("/app");
          return;
        }

        router.replace("/portal/login");
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to verify portal access. Redirecting...");
        router.replace("/portal/login");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    checkAccess();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading || !context) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B1F33]">
        <div className="rounded-3xl border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
          <CoachFortBrandAsset
            alt="Loading CoachFort portal"
            className="mx-auto h-16 w-16"
            variant="spinner"
          />
          <h1 className="mt-6 text-xl font-semibold">Loading student portal</h1>
          <p className="mt-2 text-sm font-medium text-[#425B76]">{message}</p>
        </div>
      </main>
    );
  }

  return children(context);
}
