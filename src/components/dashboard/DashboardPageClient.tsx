"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { StatCard } from "@/src/components/ui/StatCard";
import { AdminDashboard } from "@/src/components/dashboard/AdminDashboard";
import { OwnerDashboard } from "@/src/components/dashboard/OwnerDashboard";
import { StaffDashboard } from "@/src/components/dashboard/StaffDashboard";
import { TrainerDashboard } from "@/src/components/dashboard/TrainerDashboard";
import {
  getDashboardMetrics,
  type DashboardMetrics,
} from "@/src/lib/dashboard";
import {
  getUserNotifications,
  type Notification,
} from "@/src/lib/notifications";
import {
  formatResourceLimit,
  getPlanDisplayName,
  getPlanLimits,
  planResourceLabels,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getTenantSubscription } from "@/src/lib/subscription";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getTrialStatus,
  getUsagePercent,
  refreshWorkspaceUsageSnapshot,
  type TrialStatus,
  type WorkspaceUsage,
} from "@/src/lib/usage";

function formatCurrency(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function UsageMiniCard({
  label,
  limit,
  used,
}: {
  label: string;
  limit: ResourceLimit;
  used: number;
}) {
  const percent = getUsagePercent(used, limit);

  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#0B1F33]">{label}</p>
        <p className="text-xs font-semibold text-[#425B76]">
          {limit === "unlimited"
            ? "Unlimited"
            : `${used.toLocaleString()} / ${formatResourceLimit(limit)}`}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
        <div
          className="h-full rounded-full bg-[#145DA0]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SessionPreviewList({
  emptyText,
  sessions,
  showJoin = false,
}: {
  emptyText: string;
  sessions: DashboardMetrics["attendance"]["upcomingSessions"];
  showJoin?: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <div
          className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
          key={session.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[#0B1F33]">{session.title}</p>
              <p className="mt-1 text-sm text-[#425B76]">
                {session.cohortName ??
                  session.courseTitle ??
                  "General live class"}
              </p>
            </div>
            <Badge tone={session.status === "completed" ? "success" : "warning"}>
              {session.status}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-[#66788F]">
            <span>{formatDate(session.scheduled_start_at)}</span>
            <Badge
              tone={
                session.deliveryMode === "online"
                  ? "admin"
                  : session.deliveryMode === "hybrid"
                    ? "light"
                    : "staff"
              }
            >
              {session.deliveryMode}
            </Badge>
            {session.meetingProvider ? (
              <Badge tone="light">{session.meetingProvider.replace("_", " ")}</Badge>
            ) : null}
          </div>
          {showJoin && session.meetingUrl ? (
            <a
              className="mt-3 inline-flex h-9 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-3 text-xs font-semibold text-[#0B2A3D] transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]"
              href={session.meetingUrl}
              rel="noreferrer"
              target="_blank"
            >
              Start Class
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RecentStudentsCard({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
      <h3 className="text-xl font-semibold">Recent Students</h3>
      <p className="mt-2 text-sm leading-6 text-[#425B76]">
        Latest student and lead records visible to your role.
      </p>

      {metrics.recentStudents.length === 0 ? (
        <div className="mt-7 rounded-lg border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-6 text-center">
          <p className="font-semibold text-[#0B1F33]">No students yet</p>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Add a student record or review enrollment requests from your
            programs.
          </p>
          <Button className="mt-4" href="/app/students" size="sm" variant="secondary">
            Open students
          </Button>
        </div>
      ) : (
        <div className="mt-7 divide-y divide-[#D8E8F0] overflow-hidden rounded-3xl border border-[#D8E8F0]">
          {metrics.recentStudents.map((student) => (
            <div
              className="grid gap-3 bg-[#F6FBFE] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={student.id}
            >
              <div>
                <p className="font-semibold text-[#0B1F33]">
                  {student.full_name}
                </p>
                <p className="mt-1 text-sm text-[#425B76]">
                  {student.email || student.phone || "No contact details"}
                </p>
              </div>
              <div className="sm:text-right">
                <Badge className="border-[#D8E8F0] bg-white text-[#425B76]">
                  {student.status}
                </Badge>
                <p className="mt-2 text-xs text-[#66788F]">
                  {formatDate(student.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function DashboardPageClient() {
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [plan, setPlan] = useState<PlanKey>("free");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        setTenant(currentTenant);

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        const [dashboardMetrics, memberRole] = await Promise.all([
          getDashboardMetrics(currentTenant.id),
          user
            ? getCurrentMemberRole(currentTenant.id, user.id)
            : Promise.resolve(null),
        ]);
        const canViewUsage = memberRole === "owner" || memberRole === "admin";
        const [workspaceUsage, workspaceTrialStatus] = canViewUsage
          ? await Promise.all([
              refreshWorkspaceUsageSnapshot(currentTenant.id),
              getTrialStatus(currentTenant.id),
            ])
          : [null, null];
        const workspaceSubscription = canViewUsage
          ? await getTenantSubscription(currentTenant.id)
          : null;
        const recentNotifications = user
          ? await getUserNotifications(currentTenant.id, {
              limit: 5,
              status: "all",
            })
          : [];

        if (!active) {
          return;
        }

        setMetrics(dashboardMetrics);
        setNotifications(recentNotifications);
        setCurrentRole(memberRole);
        setPlan(workspaceSubscription?.plan ?? "free");
        setTrialStatus(workspaceTrialStatus);
        setUsage(workspaceUsage);
        setError("");
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load dashboard data."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [router]);

  const maxCourseRevenue = useMemo(() => {
    if (!metrics?.courseRevenue.length) {
      return 0;
    }

    return Math.max(...metrics.courseRevenue.map((course) => course.revenue));
  }, [metrics]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-[#D8E8F0] bg-white p-6">
          <span className="sr-only">Loading dashboard</span>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-5 h-10 w-full max-w-md" />
          <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton className="h-28" key={item} />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="mx-auto max-w-7xl">
        <FeedbackAlert onRetry={() => window.location.reload()}>
          {error || "Unable to load dashboard data. Please try again."}
        </FeedbackAlert>
      </div>
    );
  }

  const canViewFinance = currentRole === "owner" || currentRole === "admin";
  const metricCards = [
    {
      detail: "Students and leads in this workspace",
      label: "Total Students",
      value: String(metrics.totalStudents),
    },
    {
      detail: "Published programs, or drafts if none are published",
      label: "Active Programs",
      value: String(metrics.activeCourses),
    },
    {
      detail: "Student-program connections",
      label: "Enrollments",
      value: String(metrics.totalEnrollments),
    },
    ...(canViewFinance
      ? [
          {
            detail: "Recorded Finance Center payment volume",
            label: "Total Revenue",
            value: formatCurrency(metrics.totalRevenue),
          },
        ]
      : []),
    {
      detail: "Pending reminders due today or overdue",
      label: "Pending Reminders",
      value: String(metrics.pendingRemindersDue),
    },
    {
      detail: "Active internal automation rules",
      label: "Active Automations",
      value: String(metrics.activeAutomations),
    },
    {
      detail: "Automation runs that need workflow review",
      label: "Automation Failures",
      value: String(metrics.failedAutomationRuns),
    },
    ...(metrics.delegatedPermissions > 0
      ? [
          {
            detail: "Temporary or scoped permission exceptions",
            label: "Extra Permissions",
            value: String(metrics.delegatedPermissions),
          },
        ]
      : []),
  ];
  const canViewUsage = currentRole === "owner" || currentRole === "admin";
  const limits = getPlanLimits(plan);
  const nearLimitResources =
    usage && canViewUsage
      ? (Object.keys(limits) as PlanResource[]).filter((resource) => {
          const limit = limits[resource];

          return limit !== "unlimited" && usage[resource] >= limit * 0.8;
        })
      : [];
  const criticalNotifications = notifications.filter(
    (notification) =>
      notification.severity === "critical" &&
      notification.status !== "archived",
  );

  return (
    <div className="mx-auto max-w-7xl">
      {currentRole !== "owner" ? (
        <PageHeader
          actions={
            <div className="rounded-full border border-[#14B8C6]/30 bg-[#14B8C6]/10 px-4 py-2 text-sm font-medium text-[#0E7490]">
              Workspace: {tenant?.name ?? "Current workspace"}
            </div>
          }
          description={
            canViewFinance
              ? "Review students, programs, enrollments, student finance, and daily workspace activity."
              : "Review students, programs, enrollments, communication, and daily workspace activity."
          }
          eyebrow="Workspace home"
          title="Dashboard"
        />
      ) : null}

      {currentRole === "owner" ? (
        <OwnerDashboard metrics={metrics} tenant={tenant} />
      ) : currentRole === "admin" ? (
        <AdminDashboard metrics={metrics} />
      ) : currentRole === "staff" ? (
        <StaffDashboard metrics={metrics} />
      ) : currentRole === "trainer" ? (
        <TrainerDashboard metrics={metrics} />
      ) : null}

      {currentRole !== "owner" ? (
        <Card className="mt-8 border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <SectionHeader
              description={
                canViewFinance
                  ? "Review students, programs, student finance, analytics, and daily operations."
                  : "Review students, programs, analytics, and daily operations."
              }
              eyebrow="Workspace overview"
              title="Manage core records"
            />
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <Button href="/app/students" type="button" variant="secondary">
                View Students
              </Button>
              <Button href="/app/courses" type="button" variant="secondary">
                View Programs
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {canViewUsage && (trialStatus?.expired || nearLimitResources.length > 0) ? (
        <Card className="mt-8 border-[#FED7AA] bg-[#FFFBF7] p-5 text-[#0B1F33] shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <Badge tone="warning">
                {trialStatus?.expired ? "Trial expired" : "Plan attention"}
              </Badge>
              <h3 className="mt-3 text-lg font-semibold">
                Review your CoachFort plan
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#66788F]">
                {trialStatus?.expired
                  ? "Your workspace trial has ended. Billing controls are ready for the next paid-plan step."
                  : `${nearLimitResources.length} usage limit${nearLimitResources.length === 1 ? "" : "s"} are nearing capacity.`}
              </p>
            </div>
            <Button href="/app/subscription" type="button" variant="secondary">
              View subscription
            </Button>
          </div>
        </Card>
      ) : null}

      {canViewUsage && usage ? (
        <Card className="mt-8 border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <SectionHeader
              description="See how current workspace usage compares with your plan. Owners and admins can review plan options when capacity is running low."
              eyebrow="Workspace usage"
              title={`${getPlanDisplayName(plan)} plan limits`}
            />
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] px-4 py-3 text-sm font-semibold text-[#425B76]">
              {trialStatus?.active
                ? `Trial: ${trialStatus.daysRemaining} days left`
                : trialStatus?.expired
                  ? "Trial expired"
                  : "Trial status unavailable"}
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {(Object.keys(limits) as PlanResource[]).map((resource) => (
              <UsageMiniCard
                key={resource}
                label={planResourceLabels[resource]}
                limit={limits[resource]}
                used={usage[resource]}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {currentRole !== "owner" &&
      currentRole !== "admin" &&
      metrics.delegatedPermissions > 0 ? (
        <div className="mt-8">
          <FeedbackAlert tone="warning">
            You have temporary extra permissions in this workspace.
          </FeedbackAlert>
        </div>
      ) : null}

      {currentRole !== "owner" ? (
        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Button href="/app/students" size="lg">
            Add Student
          </Button>
          <Button href="/app/courses" size="lg" variant="secondary">
            Create Program
          </Button>
          {canViewFinance ? (
            <Button href="/app/finance" size="lg" variant="secondary">
              Open Student Finance
            </Button>
          ) : null}
        </section>
      ) : null}

      {currentRole !== "owner" ? (
        <>
      <section className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="light">Attendance</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                Attendance Snapshot
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Attendance recorded from live classes. Present and late count as
                attended.
              </p>
            </div>
            <Button href="/app/sessions" size="sm" variant="secondary">
              View Live Classes
            </Button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.attendance.attendancePercent === null
                  ? "N/A"
                  : `${metrics.attendance.attendancePercent}%`}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Attendance rate</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.attendance.totalMarkedAttendance}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Marked records</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.attendance.lowAttendanceAlerts}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Absent alerts</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(["online", "hybrid", "offline"] as const).map((mode) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-white p-3"
                key={mode}
              >
                <p className="text-lg font-semibold text-[#0B1F33]">
                  {metrics.attendance.deliveryModeBreakdown[mode]}
                </p>
                <p className="mt-1 text-xs capitalize text-[#66788F]">
                  {mode} upcoming
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <h3 className="text-xl font-semibold">Today&apos;s Classes</h3>
              <div className="mt-4">
                <SessionPreviewList
                  emptyText="No classes scheduled today."
                  sessions={metrics.attendance.todaysSessions}
                  showJoin
                />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold">Upcoming Live Classes</h3>
              <div className="mt-4">
                <SessionPreviewList
                  emptyText="No upcoming live classes scheduled."
                  sessions={metrics.attendance.upcomingSessions}
                  showJoin
                />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold">Recent Live Classes</h3>
              <div className="mt-4">
                <SessionPreviewList
                  emptyText="No recent live classes available."
                  sessions={metrics.attendance.recentSessions}
                />
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="light">Homework</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                Assignment Snapshot
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Track submissions, reviews, overdue work, and grading progress.
              </p>
            </div>
            <Button href="/app/assignments" size="sm" variant="secondary">
              View Assignments
            </Button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.assignments.totalAssignments}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Assignments</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.assignments.pendingReviews}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Pending reviews</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.assignments.overdueAssignments}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Overdue</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.assignments.averageScore ?? "N/A"}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Average score</p>
            </div>
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Upcoming Assignments</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Published homework due next for this workspace.
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {metrics.assignments.upcomingAssignments.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                No upcoming assignments.
              </p>
            ) : (
              metrics.assignments.upcomingAssignments.map((assignment) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={assignment.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#0B1F33]">
                        {assignment.title}
                      </p>
                      <p className="mt-1 text-sm text-[#425B76]">
                        Due{" "}
                        {assignment.due_at
                          ? formatDate(assignment.due_at)
                          : "date not set"}
                      </p>
                    </div>
                    <Button
                      href={`/app/assignments/${assignment.id}`}
                      size="sm"
                      variant="secondary"
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="light">Messages</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                Communication Snapshot
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Asynchronous announcements, discussions, direct messages, and
                internal notes.
              </p>
            </div>
            <Button href="/app/messages" size="sm" variant="secondary">
              Open Messages
            </Button>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.conversations.totalThreads}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Threads</p>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold text-[#0B1F33]">
                {metrics.conversations.unreadThreads}
              </p>
              <p className="mt-1 text-sm text-[#66788F]">Unread threads</p>
            </div>
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <h3 className="text-xl font-semibold">Recent Messages</h3>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Latest communication threads visible to your role.
          </p>
          <div className="mt-6 space-y-3">
            {metrics.conversations.recentThreads.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                No message threads yet.
              </p>
            ) : (
              metrics.conversations.recentThreads.map((thread) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={thread.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#0B1F33]">
                        {thread.title}
                      </p>
                      <p className="mt-1 line-clamp-1 text-sm text-[#425B76]">
                        {thread.recentMessage ||
                          thread.threadType.replaceAll("_", " ")}
                      </p>
                    </div>
                    <Button
                      href={`/app/messages/${thread.id}`}
                      size="sm"
                      variant="secondary"
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone={criticalNotifications.length ? "danger" : "light"}>
                Critical alerts
              </Badge>
              <h3 className="mt-4 text-xl font-semibold">Workspace Alerts</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Important subscription, system, and operational notices.
              </p>
            </div>
            <Button href="/app/notifications" size="sm" variant="secondary">
              View All
            </Button>
          </div>
          <div className="mt-6 space-y-3">
            {criticalNotifications.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                No critical alerts right now.
              </p>
            ) : (
              criticalNotifications.slice(0, 3).map((notification) => (
                <div
                  className="rounded-2xl border border-red-100 bg-red-50 p-4"
                  key={notification.id}
                >
                  <p className="font-semibold text-red-800">
                    {notification.title}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-red-700">
                    {notification.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="light">Notifications</Badge>
              <h3 className="mt-4 text-xl font-semibold">Recent Updates</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Latest in-app communication across live classes, attendance,
                billing, invitations, and system events.
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {notifications.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                No notifications yet.
              </p>
            ) : (
              notifications.slice(0, 5).map((notification) => (
                <div
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  key={notification.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#0B1F33]">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[#425B76]">
                        {notification.message}
                      </p>
                    </div>
                    <Badge
                      className={
                        notification.status === "unread"
                          ? "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]"
                          : "border-[#D8E8F0] bg-white text-[#425B76]"
                      }
                    >
                      {notification.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map((metric) => (
          <StatCard
            description={metric.detail}
            key={metric.label}
            label={metric.label}
            value={metric.value}
            status={
              <span className="h-2.5 w-2.5 rounded-full bg-[#14B8C6] shadow-lg shadow-[#14B8C6]/30" />
            }
          />
        ))}
      </section>

      {canViewFinance ? (
        <>
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">Recorded Payment Summary</h3>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    Finance Center payment status across recorded manual payments.
                  </p>
                </div>
                <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
                  {metrics.pendingPayments} open balances
                </Badge>
              </div>

              <div className="mt-7 space-y-4">
                {[
                  {
                    label: "Recorded",
                    tone: "bg-teal-400",
                    value: metrics.paymentStatusSummary.recorded,
                  },
                  {
                    label: "Confirmed",
                    tone: "bg-cyan-400",
                    value: metrics.paymentStatusSummary.confirmed,
                  },
                  {
                    label: "Refunded",
                    tone: "bg-amber-300",
                    value: metrics.paymentStatusSummary.refunded,
                  },
                  {
                    label: "Failed",
                    tone: "bg-red-400",
                    value: metrics.paymentStatusSummary.failed,
                  },
                  {
                    label: "Cancelled",
                    tone: "bg-slate-300",
                    value: metrics.paymentStatusSummary.cancelled,
                  },
                ].map((item) => {
                  const totalPayments =
                    metrics.paymentStatusSummary.recorded +
                    metrics.paymentStatusSummary.confirmed +
                    metrics.paymentStatusSummary.refunded +
                    metrics.paymentStatusSummary.failed +
                    metrics.paymentStatusSummary.cancelled;
                  const width =
                    totalPayments > 0 ? `${(item.value / totalPayments) * 100}%` : "0%";

                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <span className="font-medium text-[#425B76]">
                          {item.label}
                        </span>
                        <span className="font-semibold text-[#0B1F33]">
                          {item.value}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
                        <div
                          className={`h-full rounded-full ${item.tone}`}
                          style={{ width }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">Program Sales Overview</h3>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    Recorded Finance Center payments grouped by program.
                  </p>
                </div>
                <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
                  {metrics.courseRevenue.length} programs
                </Badge>
              </div>

              {metrics.courseRevenue.length === 0 ? (
                <div className="mt-7 rounded-3xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-6 text-center">
                  <p className="text-sm font-semibold text-[#0B1F33]">
                    No recorded revenue yet
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    Recorded student payments will appear here by program.
                  </p>
                </div>
              ) : (
                <div className="mt-7 space-y-4">
                  {metrics.courseRevenue.slice(0, 5).map((course) => {
                    const width =
                      maxCourseRevenue > 0
                        ? `${(course.revenue / maxCourseRevenue) * 100}%`
                        : "0%";

                    return (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                        key={course.courseId}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-[#0B1F33]">
                              {course.courseTitle}
                            </p>
                            <p className="mt-1 text-sm text-[#66788F]">
                              {course.paymentCount} recorded payments
                            </p>
                          </div>
                          <p className="font-semibold text-[#0E7490]">
                            {formatCurrency(course.revenue, course.currency)}
                          </p>
                        </div>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
                          <div
                            className="h-full rounded-full bg-teal-400"
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
              <h3 className="text-xl font-semibold">Recent Recorded Payments</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Latest five payments recorded in this workspace.
              </p>

              {metrics.recentPayments.length === 0 ? (
                <div className="mt-7 rounded-3xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-6 text-center text-sm text-[#425B76]">
                  No payments recorded yet.
                </div>
              ) : (
                <div className="mt-7 divide-y divide-[#D8E8F0] overflow-hidden rounded-3xl border border-[#D8E8F0]">
                  {metrics.recentPayments.map((payment) => (
                    <div
                      className="grid gap-3 bg-[#F6FBFE] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                      key={payment.id}
                    >
                      <div>
                        <p className="font-semibold text-[#0B1F33]">
                          {payment.studentName}
                        </p>
                        <p className="mt-1 text-sm text-[#425B76]">
                          {payment.courseTitle} · {formatDate(payment.payment_date)}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <p className="font-semibold text-[#0E7490]">
                          {formatCurrency(payment.amount, payment.currency)}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-[#66788F]">
                          {payment.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <RecentStudentsCard metrics={metrics} />
          </section>
        </>
      ) : (
        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <RecentStudentsCard metrics={metrics} />
        </section>
      )}
        </>
      ) : null}

    </div>
  );
}
