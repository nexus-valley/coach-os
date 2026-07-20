"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { requireClientSession, signInWithGoogleForDemo } from "@/src/lib/auth";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type DemoAccessState = "checking" | "guest";

const demoHighlights = [
  {
    description:
      "Review how a coach can set up programs, share public pages, and collect enrollment requests.",
    title: "Program sales flow",
  },
  {
    description:
      "See approved student access, live class readiness, materials, and student portal context.",
    title: "Student access and delivery",
  },
  {
    description:
      "Review Finance Center workflows for invoices, manual payment records, receipts, and open balances.",
    title: "Invoices and receipts",
  },
  {
    description:
      "See owner dashboards for enrollments, recorded payments, student growth, and coaching operations.",
    title: "Owner dashboard",
  },
];

export function DemoPageClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [oauthLoading, setOauthLoading] = useState(false);
  const [state, setState] = useState<DemoAccessState>("checking");

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) {
        router.replace("/app?demo=1");
      }
    });

    async function checkDemoAccess() {
      try {
        const session = await requireClientSession();

        if (!active) {
          return;
        }

        if (!session) {
          setState("guest");
          return;
        }

        router.replace("/app?demo=1");
      } catch {
        if (active) {
          setState("guest");
        }
      }
    }

    checkDemoAccess();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handlePrimaryAction() {
    setError("");

    if (state === "guest") {
      setOauthLoading(true);

      try {
        await signInWithGoogleForDemo();
      } catch (caught) {
        setOauthLoading(false);
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to continue with Google. Please try again.",
        );
      }
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(46,203,234,0.18),transparent_30rem),linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_48%,#EAF7FC_100%)] text-[#0B1F33]">
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-10 px-5 py-16 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
        <div>
          <CoachFortBrandAsset
            className="mb-8 h-16 w-56 sm:h-20 sm:w-72"
            variant="fullLogo"
          />
          <Badge className="border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]">
            Demo workspace
          </Badge>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-6xl">
            You are about to enter a sample CoachFort workspace.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#425B76]">
            The demo lets prospects explore CoachFort with sample programs,
            enrollment requests, student access, live delivery, invoices,
            manual payment records, receipts, reports, and coaching operations.
            Demo data is clearly marked as sample data and is loaded only into
            the workspace you choose.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button
              disabled={state === "checking" || oauthLoading}
              onClick={handlePrimaryAction}
              size="lg"
              type="button"
            >
              {state === "checking"
                ? "Checking access..."
                : oauthLoading
                  ? "Redirecting..."
                  : "Sign in with Google to Try Demo"}
            </Button>
            <a
              className="inline-flex h-12 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-6 text-base font-semibold text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]"
              href="mailto:support@coachfort.com"
            >
              Email support
            </a>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <p className="mt-5 text-sm leading-6 text-[#66788F]">
            After signing in, you&apos;ll be taken directly into the CoachFort app
            demo.
          </p>
        </div>

        <Card className="border-[#D8E8F0] bg-white p-5 shadow-2xl shadow-[#0B2A3D]/10 sm:p-6">
          <div className="rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-5">
            <div className="flex items-center justify-between gap-4 border-b border-[#D8E8F0] pb-5">
              <div>
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Sample CoachFort Workspace
                </p>
                <p className="mt-1 text-xs font-medium text-[#66788F]">
                  Demo records are added manually by an owner or admin.
                </p>
              </div>
              <span className="rounded-full border border-[#9ADDEA] bg-[#EAF8FC] px-3 py-1 text-xs font-semibold text-[#0B6F87]">
                Safe preview
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {demoHighlights.map((item) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-white p-4"
                  key={item.title}
                >
                  <p className="font-semibold text-[#0B1F33]">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              Demo setup never runs automatically. Open your app workspace, then
              use the owner/admin-only <strong>Load Demo Data</strong> action on
              the dashboard.
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
