"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getDashboardMetrics,
  type DashboardMetrics,
} from "@/src/lib/dashboard";
import { loadDemoDataForTenant } from "@/src/lib/demoSeed";
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
import { canAccessPayments } from "@/src/lib/permissions";
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

function formatCurrency(value: number, currency = "USD") {
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

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-[#425B76]">{label}</p>
        <span className="h-2.5 w-2.5 rounded-full bg-[#14B8C6] shadow-lg shadow-[#14B8C6]/30" />
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-normal text-[#0B1F33]">
        {value}
      </p>
      <p className="mt-3 text-sm text-[#66788F]">{detail}</p>
    </Card>
  );
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
}: {
  emptyText: string;
  sessions: DashboardMetrics["attendance"]["upcomingSessions"];
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
                  "General session"}
              </p>
            </div>
            <Badge tone={session.status === "completed" ? "success" : "warning"}>
              {session.status}
            </Badge>
          </div>
          <p className="mt-3 text-xs font-medium text-[#66788F]">
            {formatDate(session.scheduled_start_at)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DashboardPageClient() {
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [demoError, setDemoError] = useState("");
  const [demoIntent] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
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

  async function handleLoadDemoData() {
    if (!tenant) {
      setDemoError("Workspace context is not available.");
      return;
    }

    setDemoLoading(true);
    setDemoError("");
    setDemoMessage("");

    try {
      const result = await loadDemoDataForTenant(tenant.id);
      const addedCount = Object.values(result).reduce(
        (total, count) => total + count,
        0,
      );
      const dashboardMetrics = await getDashboardMetrics(tenant.id);
      const workspaceUsage =
        currentRole === "owner" || currentRole === "admin"
          ? await refreshWorkspaceUsageSnapshot(tenant.id)
          : null;

      setMetrics(dashboardMetrics);
      setUsage(workspaceUsage);
      setDemoMessage(
        addedCount > 0
          ? `Demo data loaded. Added ${addedCount} sample records.`
          : "Demo data is already available in this workspace.",
      );
    } catch (caught) {
      setDemoError(getErrorMessage(caught, "Unable to load demo data."));
    } finally {
      setDemoLoading(false);
    }
  }

  const maxCourseRevenue = useMemo(() => {
    if (!metrics?.courseRevenue.length) {
      return 0;
    }

    return Math.max(...metrics.courseRevenue.map((course) => course.revenue));
  }, [metrics]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading dashboard</span>
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

  const metricCards = [
    {
      detail: "Students and leads in this workspace",
      label: "Total Students",
      value: String(metrics.totalStudents),
    },
    {
      detail: "Published courses, or drafts if none are published",
      label: "Active Courses",
      value: String(metrics.activeCourses),
    },
    {
      detail: "Student-course connections",
      label: "Enrollments",
      value: String(metrics.totalEnrollments),
    },
    {
      detail: "Completed payment volume",
      label: "Total Revenue",
      value: formatCurrency(metrics.totalRevenue),
    },
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
  ];
  const canLoadDemo = currentRole === "owner" || currentRole === "admin";
  const canViewUsage = currentRole === "owner" || currentRole === "admin";
  const limits = getPlanLimits(plan);
  const criticalNotifications = notifications.filter(
    (notification) =>
      notification.severity === "critical" &&
      notification.status !== "archived",
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Dashboard analytics
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Dashboard
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
            Real-time workspace analytics for students, courses, enrollments,
            and payments.
          </p>
        </div>
        <div className="rounded-full border border-[#14B8C6]/30 bg-[#14B8C6]/10 px-4 py-2 text-sm font-medium text-[#0E7490]">
          Workspace: {tenant?.name ?? "Current workspace"}
        </div>
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Badge
              className={
                demoIntent
                  ? "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]"
                  : "border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]"
              }
            >
              {demoIntent ? "Demo mode" : "Demo readiness"}
            </Badge>
            {demoIntent ? (
              <span className="ml-3 inline-flex rounded-full border border-[#9ADDEA] bg-[#EAF8FC] px-3 py-1 text-xs font-semibold text-[#0B6F87]">
                Demo version
              </span>
            ) : null}
            <h3 className="mt-4 text-xl font-semibold">
              {demoIntent ? "Demo Mode" : "Load a safe sample CoachFort workspace"}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#425B76]">
              {demoIntent
                ? "You are viewing a CoachFort demo workspace. Sample data can be loaded to explore students, courses, payments, reports, reminders, and WhatsApp-ready workflows."
                : "Add clearly marked demo students, courses, cohorts, payments, payment links, reminders, and automation rules to this workspace. This is tenant-scoped and does not run automatically."}
            </p>
          </div>
          {canLoadDemo ? (
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <Button
                disabled={demoLoading}
                onClick={handleLoadDemoData}
                type="button"
              >
                {demoLoading ? "Loading..." : "Load Demo Data"}
              </Button>
              <Button href="/app/students" type="button" variant="secondary">
                View Students
              </Button>
              <Button href="/app/courses" type="button" variant="secondary">
                View Courses
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
                Owner/admin only
              </Badge>
              <Button href="/app/students" type="button" variant="secondary">
                View Students
              </Button>
              <Button href="/app/courses" type="button" variant="secondary">
                View Courses
              </Button>
            </div>
          )}
        </div>

        {demoMessage ? (
          <div className="mt-5">
            <FeedbackAlert tone="success">{demoMessage}</FeedbackAlert>
          </div>
        ) : null}

        {demoError ? (
          <div className="mt-5">
            <FeedbackAlert>{demoError}</FeedbackAlert>
          </div>
        ) : null}
      </Card>

      {canViewUsage && usage ? (
        <Card className="mt-8 border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <Badge className="border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]">
                Workspace usage
              </Badge>
              <h3 className="mt-4 text-xl font-semibold">
                {getPlanDisplayName(plan)} plan limits
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#425B76]">
                Usage is refreshed from tenant-scoped counts and cached for
                billing readiness. Upgrade prompts are available to owner/admin
                users when limits are reached.
              </p>
            </div>
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

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <Button href="/app/students" size="lg">
          Add Student
        </Button>
        <Button href="/app/courses" size="lg" variant="secondary">
          Create Course
        </Button>
        {canAccessPayments(currentRole) ? (
          <Button href="/app/payments" size="lg" variant="secondary">
            Record Payment
          </Button>
        ) : null}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="light">Attendance</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                Attendance Snapshot
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Foundation metrics from marked sessions. Present and late count
                as attended.
              </p>
            </div>
            <Button href="/app/sessions" size="sm" variant="secondary">
              View Sessions
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
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xl font-semibold">Upcoming Sessions</h3>
              <div className="mt-4">
                <SessionPreviewList
                  emptyText="No upcoming sessions scheduled."
                  sessions={metrics.attendance.upcomingSessions}
                />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold">Recent Sessions</h3>
              <div className="mt-4">
                <SessionPreviewList
                  emptyText="No recent sessions available."
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
                Foundation metrics for submissions, reviews, overdue work, and
                grading readiness.
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
                Latest in-app communication across sessions, attendance,
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
          <MetricCard
            detail={metric.detail}
            key={metric.label}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Payment Status Summary</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Revenue health across tracked payments.
              </p>
            </div>
            <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
              {metrics.pendingPayments} pending
            </Badge>
          </div>

          <div className="mt-7 space-y-4">
            {[
              {
                label: "Completed",
                tone: "bg-teal-400",
                value: metrics.paymentStatusSummary.completed,
              },
              {
                label: "Pending",
                tone: "bg-amber-300",
                value: metrics.paymentStatusSummary.pending,
              },
              {
                label: "Failed",
                tone: "bg-red-400",
                value: metrics.paymentStatusSummary.failed,
              },
            ].map((item) => {
              const totalPayments =
                metrics.paymentStatusSummary.completed +
                metrics.paymentStatusSummary.pending +
                metrics.paymentStatusSummary.failed;
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
              <h3 className="text-xl font-semibold">Course Revenue Overview</h3>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Completed payments grouped by course.
              </p>
            </div>
            <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
              {metrics.courseRevenue.length} courses
            </Badge>
          </div>

          {metrics.courseRevenue.length === 0 ? (
            <div className="mt-7 rounded-3xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-6 text-center">
              <p className="text-sm font-semibold text-[#0B1F33]">
                No completed revenue yet
              </p>
              <p className="mt-2 text-sm leading-6 text-[#425B76]">
                Completed student payments will appear here by course.
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
                          {course.paymentCount} completed payments
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
          <h3 className="text-xl font-semibold">Recent Payments</h3>
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
                      {payment.courseTitle} · {formatDate(payment.paid_at)}
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

        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
          <h3 className="text-xl font-semibold">Recent Students</h3>
          <p className="mt-2 text-sm leading-6 text-[#425B76]">
            Latest student and lead records added to the CRM.
          </p>

          {metrics.recentStudents.length === 0 ? (
            <div className="mt-7 rounded-3xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-6 text-center text-sm text-[#425B76]">
              No students added yet.
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
      </section>

    </div>
  );
}
