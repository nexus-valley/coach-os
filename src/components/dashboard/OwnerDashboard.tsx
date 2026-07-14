import Link from "next/link";

import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
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

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${value}%`;
}

export function OwnerDashboard({
  metrics,
  tenant,
}: {
  metrics: DashboardMetrics;
  tenant: Tenant | null;
}) {
  const attentionItems = [
    {
      description: "Pending payments need owner review.",
      href: "/app/finance",
      label: "Pending payments",
      tone: "warning" as const,
      value: metrics.pendingPayments,
    },
    {
      description: "Homework submissions are waiting for review.",
      href: "/app/assignments",
      label: "Assignment reviews",
      tone: "warning" as const,
      value: metrics.assignments.pendingReviews,
    },
    {
      description: "Published assignments are past due.",
      href: "/app/assignments",
      label: "Overdue assignments",
      tone: "danger" as const,
      value: metrics.assignments.overdueAssignments,
    },
    {
      description: "Marked absences may need coach follow-up.",
      href: "/app/sessions",
      label: "Attendance alerts",
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
    {
      description: "Automation runs failed and should be checked.",
      href: "/app/automations",
      label: "Automation failures",
      tone: "danger" as const,
      value: metrics.failedAutomationRuns,
    },
    {
      description: "Due reminders can unblock follow-ups.",
      href: "/app/reminders",
      label: "Reminders due",
      tone: "warning" as const,
      value: metrics.pendingRemindersDue,
    },
    {
      description: "Temporary permission exceptions are active.",
      href: "/app/permissions",
      label: "Extra permissions",
      tone: "info" as const,
      value: metrics.delegatedPermissions,
    },
  ].filter((item) => item.value > 0);

  const quickActions = [
    {
      description: "Complete legal, tax, and invoice contact readiness.",
      href: "/app/billing-profile",
      label: "Billing profile",
    },
    {
      description: "Add or review student records.",
      href: "/app/students",
      label: "Manage students",
    },
    {
      description: "Update published and draft programs.",
      href: "/app/courses",
      label: "Review programs",
    },
    {
      description: "Check fee plans, invoices, and payment status.",
      href: "/app/finance",
      label: "Open sales",
    },
    {
      description: "Review coaching materials and uploads.",
      href: "/app/documents",
      label: "Manage content",
    },
    {
      description: "Review plan, usage, and billing readiness.",
      href: "/app/subscription",
      label: "CoachFort billing",
    },
    {
      description: "Review staff operations and team metadata.",
      href: "/app/team-operations",
      label: "Team operations",
    },
  ];
  const launchChecklist = [
    {
      description:
        "Add the legal, tax, billing contact, and invoice details CoachFort will need before payment support goes live.",
      href: "/app/billing-profile",
      label: "Complete billing profile",
      status: "Open",
      tone: "info" as const,
    },
    {
      description:
        "Invite admins, staff, or trainers and confirm every role has the right workspace access.",
      href: "/app/settings",
      label: "Invite your team",
      status: "Open",
      tone: "info" as const,
    },
    {
      description:
        "Create the first student records so programs, payments, and portal access have real context.",
      href: "/app/students",
      label: "Add students",
      status: metrics.totalStudents > 0 ? "Started" : "Start",
      tone: metrics.totalStudents > 0 ? ("success" as const) : ("warning" as const),
    },
    {
      description:
        "Publish a program so learning delivery is ready for student portal use.",
      href: "/app/courses",
      label: "Create programs",
      status: metrics.activeCourses > 0 ? "Started" : "Start",
      tone: metrics.activeCourses > 0 ? ("success" as const) : ("warning" as const),
    },
    {
      description:
        "Upload resources, policies, or learning material when the content library is ready.",
      href: "/app/documents",
      label: "Prepare materials",
      status: "Open",
      tone: "info" as const,
    },
    {
      description:
        "Use announcements for official updates and community for controlled student discussion.",
      href: "/app/announcements",
      label: "Publish communication",
      status: "Open",
      tone: "info" as const,
    },
  ];

  return (
    <Card className="mb-8 mt-8 border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <SectionHeader
          description="A focused operating view for sales, program delivery, student growth, risk signals, and the next owner actions."
          eyebrow="Command Center"
          title={`Home for ${tenant?.name ?? "this workspace"}`}
        />
        <div className="flex flex-wrap gap-3">
          <Button href="/app/students" size="sm" variant="secondary">
            Students
          </Button>
          <Button href="/app/finance" size="sm" variant="secondary">
            Sales
          </Button>
          <Button href="/app/subscription" size="sm" variant="secondary">
            CoachFort Billing
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          description="Completed payment revenue recorded in the workspace."
          label="Revenue"
          value={formatCurrency(metrics.totalRevenue)}
        />
        <StatCard
          description={`${metrics.totalEnrollments.toLocaleString()} enrollments across active learning programs.`}
          label="Students"
          value={metrics.totalStudents.toLocaleString()}
        />
        <StatCard
          description="Published programs, or drafts if none are published."
          label="Programs"
          value={metrics.activeCourses.toLocaleString()}
        />
        <StatCard
          description="Pending payment records that may need follow-up."
          label="Payments due"
          status={
            metrics.pendingPayments > 0 ? (
              <Badge tone="warning">Review</Badge>
            ) : (
              <Badge tone="success">Clear</Badge>
            )
          }
          value={metrics.pendingPayments.toLocaleString()}
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-[#D8E8F0] bg-[#F7FCFF] p-5 shadow-none">
          <SectionHeader
            actions={
              attentionItems.length > 0 ? (
                <Badge tone="warning">{attentionItems.length} signals</Badge>
              ) : (
                <Badge tone="success">Clear</Badge>
              )
            }
            description="The strongest owner-facing signals already available from workspace activity."
            title="Attention needed"
          />

          {attentionItems.length > 0 ? (
            <div className="mt-5 grid gap-3">
              {attentionItems.slice(0, 5).map((item) => (
                <Link
                  className="group rounded-lg border border-[#D8E8F0] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:shadow-sm hover:shadow-[#0B2A3D]/8"
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
          ) : (
            <div className="mt-5 rounded-lg border border-[#D8E8F0] bg-white p-5">
              <Badge tone="success">No urgent owner signals</Badge>
              <p className="mt-3 text-sm leading-6 text-[#5D7185]">
                Payments, reviews, attendance alerts, reminders, conversations,
                permissions, and automation failures are clear based on the
                current dashboard data.
              </p>
            </div>
          )}
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm shadow-[#0B2A3D]/5">
          <SectionHeader
            description="A compact view of business and delivery momentum."
            title="Business and learning health"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#D8E8F0] bg-[#F7FCFF] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.paymentStatusSummary.completed.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-[#5D7185]">Completed payments</p>
            </div>
            <div className="rounded-lg border border-[#D8E8F0] bg-[#F7FCFF] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {formatPercent(metrics.attendance.attendancePercent)}
              </p>
              <p className="mt-1 text-sm text-[#5D7185]">Attendance rate</p>
            </div>
            <div className="rounded-lg border border-[#D8E8F0] bg-[#F7FCFF] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.assignments.totalAssignments.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-[#5D7185]">Assignments tracked</p>
            </div>
            <div className="rounded-lg border border-[#D8E8F0] bg-[#F7FCFF] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.activeAutomations.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-[#5D7185]">Active automations</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 border-[#D8E8F0] bg-[#F7FCFF] p-5 shadow-none">
        <SectionHeader
          description="A launch-readiness guide for owners. These links use existing workspace pages and do not create tasks or change data by themselves."
          title="Coaching launch checklist"
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {launchChecklist.map((item) => (
            <Link
              className="rounded-lg border border-[#D8E8F0] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:shadow-sm hover:shadow-[#0B2A3D]/8"
              href={item.href}
              key={item.label}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-[#0B1F33]">{item.label}</p>
                <Badge tone={item.tone}>{item.status}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#5D7185]">
                {item.description}
              </p>
            </Link>
          ))}
        </div>
      </Card>

      <Card className="mt-6 border-[#D8E8F0] bg-white p-5 shadow-sm shadow-[#0B2A3D]/5">
        <SectionHeader
          description="Common owner actions, grouped so the dashboard points to the next workspace task."
          title="What to do next"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              className="rounded-lg border border-[#D8E8F0] bg-[#F7FCFF] p-4 transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-white hover:shadow-sm hover:shadow-[#0B2A3D]/8"
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
      </Card>
    </Card>
  );
}
