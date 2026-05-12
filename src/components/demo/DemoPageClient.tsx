"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { requireClientSession, signInWithGoogle } from "@/src/lib/auth";
import { getCurrentTenant } from "@/src/lib/tenant";

type DemoAccessState = "checking" | "guest" | "needs-workspace" | "ready";

const demoHighlights = [
  {
    description:
      "Explore sample students, notes, enrollments, cohorts, and follow-up workflows.",
    title: "Student CRM",
  },
  {
    description:
      "Open structured demo courses with sections, lessons, and progress-ready content.",
    title: "Course delivery",
  },
  {
    description:
      "Review sample payments, UPI-ready payment links, receipts, and payment status reporting.",
    title: "Payments and receipts",
  },
  {
    description:
      "See reports, reminders, automation rules, and WhatsApp-ready sharing flows in context.",
    title: "Operations command center",
  },
];

function getPrimaryAction(state: DemoAccessState) {
  if (state === "ready") {
    return {
      href: "/app?demo=1",
      label: "Open Demo Workspace",
    };
  }

  if (state === "needs-workspace") {
    return {
      href: "/onboarding",
      label: "Create Workspace First",
    };
  }

  return {
    href: "/login",
    label: "Sign in with Google",
  };
}

export function DemoPageClient() {
  const [error, setError] = useState("");
  const [oauthLoading, setOauthLoading] = useState(false);
  const [state, setState] = useState<DemoAccessState>("checking");

  useEffect(() => {
    let active = true;

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

        const tenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        setState(tenant ? "ready" : "needs-workspace");
      } catch {
        if (active) {
          setState("guest");
        }
      }
    }

    checkDemoAccess();

    return () => {
      active = false;
    };
  }, []);

  const primaryAction = getPrimaryAction(state);

  async function handlePrimaryAction() {
    setError("");

    if (state === "guest") {
      setOauthLoading(true);

      try {
        await signInWithGoogle("/app?demo=1");
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
          <Badge className="border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]">
            Demo workspace
          </Badge>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-6xl">
            You are about to enter a sample CoachOS workspace.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#425B76]">
            The demo lets prospects explore CoachOS with sample students,
            courses, payments, receipts, reminders, reports, and WhatsApp-ready
            workflows. Demo data is clearly marked as sample data and is loaded
            only into the workspace you choose.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {state === "guest" ? (
              <Button
                disabled={oauthLoading}
                onClick={handlePrimaryAction}
                size="lg"
                type="button"
              >
                {oauthLoading ? "Redirecting..." : "Sign in and Open Demo"}
              </Button>
            ) : (
              <Button
                disabled={state === "checking"}
                href={state === "checking" ? undefined : primaryAction.href}
                size="lg"
              >
                {state === "checking" ? "Checking access..." : primaryAction.label}
              </Button>
            )}
            <a
              className="inline-flex h-12 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-6 text-base font-semibold text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]"
              href="https://wa.me/917338841434"
              rel="noreferrer"
              target="_blank"
            >
              Contact Us on WhatsApp
            </a>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <p className="mt-5 text-sm leading-6 text-[#66788F]">
            Google may show the Supabase authentication domain during sign-in.
            You will be redirected back to CoachOS after authentication.
          </p>
        </div>

        <Card className="border-[#D8E8F0] bg-white p-5 shadow-2xl shadow-[#0B2A3D]/10 sm:p-6">
          <div className="rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-5">
            <div className="flex items-center justify-between gap-4 border-b border-[#D8E8F0] pb-5">
              <div>
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Sample CoachOS Workspace
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
