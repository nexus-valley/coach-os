import Link from "next/link";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { StatCard } from "@/src/components/ui/StatCard";
import type { DashboardMetrics } from "@/src/lib/dashboard";
import type { Tenant } from "@/src/lib/tenant";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function getNextAction(metrics: DashboardMetrics) {
  if (metrics.activeCourses === 0) {
    return {
      description:
        "Create a clear program offer before inviting students or sharing your public page.",
      href: "/app/courses",
      label: "Create your first program",
      status: "Start here",
    };
  }

  if (metrics.totalStudents === 0) {
    return {
      description:
        "Review your program's publish and sharing status, then use its public link to receive enrollment requests.",
      href: "/app/courses",
      label: "Prepare your program for students",
      status: "Next step",
    };
  }

  if (metrics.totalEnrollments === 0) {
    return {
      description:
        "Open Programs to review enrollment requests and confirm the right program access for each student.",
      href: "/app/courses",
      label: "Review requests and enrollments",
      status: "Next step",
    };
  }

  if (metrics.attendance.upcomingSessions.length === 0) {
    return {
      description:
        "Your student and program foundation is in place. Schedule the next live class or review learning materials.",
      href: "/app/sessions",
      label: "Plan the next live class",
      status: "Keep moving",
    };
  }

  return {
    description:
      "Review student follow-ups, upcoming classes, and anything that needs attention today.",
    href: "/app/students",
    label: "Review today's workspace",
    status: "Today",
  };
}

export function OwnerDashboard({
  metrics,
  tenant,
}: {
  metrics: DashboardMetrics;
  tenant: Tenant | null;
}) {
  const nextAction = getNextAction(metrics);
  const workspaceStage =
    metrics.activeCourses === 0
      ? "Getting started"
      : metrics.totalStudents === 0
        ? "Program started"
        : metrics.totalEnrollments === 0
          ? "Building your audience"
          : "Running";
  const attentionItems = [
    {
      description: "Student payment records need a follow-up.",
      href: "/app/finance",
      label: "Open student balances",
      tone: "warning" as const,
      value: metrics.pendingPayments,
    },
    {
      description: "Assignment submissions are waiting for review.",
      href: "/app/assignments",
      label: "Assignment reviews",
      tone: "warning" as const,
      value: metrics.assignments.pendingReviews,
    },
    {
      description: "Marked absences may need coach follow-up.",
      href: "/app/sessions",
      label: "Attendance follow-ups",
      tone: "warning" as const,
      value: metrics.attendance.lowAttendanceAlerts,
    },
    {
      description: "Unread workspace conversations need a response.",
      href: "/app/messages",
      label: "Unread conversations",
      tone: "info" as const,
      value: metrics.conversations.unreadThreads,
    },
  ].filter((item) => item.value > 0);
  const setupChecklist = [
    {
      description: "Confirm your workspace name, contact details, and team settings.",
      href: "/app/settings",
      label: "Complete workspace profile",
      status: "Review",
      tone: "info" as const,
    },
    {
      description: "Add the coach details and sections visitors should see.",
      href: "/app/settings/public-site",
      label: "Configure public page",
      status: "Review",
      tone: "info" as const,
    },
    {
      description: "Define the offer, delivery format, and student outcome.",
      href: "/app/courses",
      label: "Create first program",
      status: metrics.activeCourses > 0 ? "Started" : "Start",
      tone: metrics.activeCourses > 0 ? ("success" as const) : ("warning" as const),
    },
    {
      description: "Check publish readiness and copy the program link when ready.",
      href: "/app/courses",
      label: "Publish and share program",
      status: "Review",
      tone: "info" as const,
    },
    {
      description: "Open Programs to review new requests and confirm access.",
      href: "/app/courses",
      label: "Review student requests",
      status: "Review",
      tone: "info" as const,
    },
    {
      description: "Invite a teammate only when someone else needs workspace access.",
      href: "/app/settings",
      label: "Invite team if needed",
      status: "Optional",
      tone: "light" as const,
    },
  ];
  const quickActions = [
    {
      description: "Create, publish, and manage coaching programs.",
      href: "/app/courses",
      label: "Programs",
    },
    {
      description: "Edit the CoachFort-hosted page you share with visitors.",
      href: "/app/settings/public-site",
      label: "Public page",
    },
    {
      description: "Review public program requests before confirming access.",
      href: "/app/courses",
      label: "Student requests",
    },
    {
      description: "See enrollment status across all programs.",
      href: "/app/enrollments",
      label: "Enrollments",
    },
    {
      description: "Invite teammates and review workspace roles.",
      href: "/app/settings",
      label: "Team",
    },
    {
      description: "Review your Starter or Growth workspace plan.",
      href: "/app/subscription",
      label: "CoachFort plan",
    },
    {
      description: "Schedule classes and review upcoming delivery.",
      href: "/app/sessions",
      label: "Live classes",
    },
    {
      description: "Organize learning resources for your students.",
      href: "/app/documents",
      label: "Content library",
    },
    {
      description: "Publish updates and manage student discussions.",
      href: "/app/community",
      label: "Community",
    },
  ];

  return (
    <div className="mt-2">
      <section className="border-b border-[#D8E8F0] pb-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <Badge tone="light">{workspaceStage}</Badge>
            <h1 className="mt-4 text-3xl font-semibold text-[#0B1F33] sm:text-4xl">
              {tenant?.name ?? "Your CoachFort workspace"}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
              Set up your coaching offer, welcome students, and manage delivery
              from one clear workspace.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/app/settings/public-site" variant="secondary">
              View public page
            </Button>
            <Button href="/app/subscription" variant="secondary">
              View CoachFort plan
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-[#9ADDEA] bg-[#EAF8FC] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase text-[#0E7490]">
              {nextAction.status}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#0B1F33]">
              {nextAction.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#425B76]">
              {nextAction.description}
            </p>
          </div>
          <Button href={nextAction.href}>Continue</Button>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          description={`${metrics.totalEnrollments.toLocaleString()} program enrollments.`}
          label="Students"
          value={metrics.totalStudents.toLocaleString()}
        />
        <StatCard
          description="Published programs, or drafts when none are published."
          label="Programs"
          value={metrics.activeCourses.toLocaleString()}
        />
        <StatCard
          description="Student payments recorded by your workspace."
          label="Recorded student revenue"
          value={formatCurrency(metrics.totalRevenue)}
        />
        <StatCard
          description="Student payment records that may need follow-up."
          label="Open student balances"
          status={
            metrics.pendingPayments > 0 ? (
              <Badge tone="warning">Review</Badge>
            ) : (
              <Badge tone="success">Clear</Badge>
            )
          }
          value={metrics.pendingPayments.toLocaleString()}
        />
      </section>

      <section className="mt-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold text-[#0B1F33]">
              Set up your workspace
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#425B76]">
              Follow these guided actions in order. Review steps stay open when
              CoachFort cannot confirm completion from current dashboard data.
            </p>
          </div>
          <Badge tone="light">6 guided steps</Badge>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {setupChecklist.map((item, index) => (
            <Link
              className="rounded-lg border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5 transition hover:border-[#2ECBEA] hover:shadow-md"
              href={item.href}
              key={item.label}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B2A3D] text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <p className="font-semibold text-[#0B1F33]">{item.label}</p>
                </div>
                <Badge tone={item.tone}>{item.status}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#425B76]">
                {item.description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {attentionItems.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold text-[#0B1F33]">
              Needs attention
            </h2>
            <Badge tone="warning">{attentionItems.length}</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {attentionItems.map((item) => (
              <Link
                className="rounded-lg border border-[#FED7AA] bg-[#FFFBF7] p-4 transition hover:border-[#F59E0B]"
                href={item.href}
                key={item.label}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-[#0B1F33]">{item.label}</p>
                    <p className="mt-1 text-sm leading-6 text-[#5D7185]">
                      {item.description}
                    </p>
                  </div>
                  <Badge tone={item.tone}>{item.value}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-2xl font-semibold text-[#0B1F33]">Quick actions</h2>
        <p className="mt-2 text-sm leading-6 text-[#425B76]">
          Go directly to the workspace area you need.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <Link
              className="rounded-lg border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5 transition hover:border-[#2ECBEA] hover:bg-[#F7FCFF]"
              href={action.href}
              key={action.href}
            >
              <p className="font-semibold text-[#0B1F33]">{action.label}</p>
              <p className="mt-1 text-sm leading-6 text-[#5D7185]">
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm shadow-[#0B2A3D]/5">
          <p className="text-sm font-semibold text-[#0B1F33]">
            Your CoachFort plan
          </p>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Starter or Growth controls what is available in this workspace.
            Review plan status and usage from CoachFort Plan.
          </p>
          <Button className="mt-4" href="/app/subscription" size="sm" variant="secondary">
            Review CoachFort plan
          </Button>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm shadow-[#0B2A3D]/5">
          <p className="text-sm font-semibold text-[#0B1F33]">
            Student finance
          </p>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Record payments handled directly between your coaching business and
            students. CoachFort does not collect, hold, or refund those payments
            in this phase.
          </p>
          <Button className="mt-4" href="/app/finance" size="sm" variant="secondary">
            Open student finance
          </Button>
        </Card>
      </section>
    </div>
  );
}
