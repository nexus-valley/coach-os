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
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

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

export function DashboardPageClient() {
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
  const [demoError, setDemoError] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

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

        if (!active) {
          return;
        }

        setMetrics(dashboardMetrics);
        setCurrentRole(memberRole);
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

      setMetrics(dashboardMetrics);
      setDemoConfirmOpen(false);
      setDemoMessage(
        addedCount > 0
          ? `Demo data loaded. Added ${addedCount} sample records.`
          : "Demo data is already loaded for this workspace.",
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
  const workspaceHasData =
    metrics.totalStudents > 0 ||
    metrics.activeCourses > 0 ||
    metrics.totalEnrollments > 0 ||
    metrics.totalRevenue > 0;

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

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <Button href="/app/students" size="lg">
          Add Student
        </Button>
        <Button href="/app/courses" size="lg" variant="secondary">
          Create Course
        </Button>
        <Button href="/app/payments" size="lg" variant="secondary">
          Record Payment
        </Button>
      </section>

      <Card className="mt-6 border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Badge className="border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]">
              Demo readiness
            </Badge>
            <h3 className="mt-4 text-xl font-semibold">
              Load a safe sample CoachOS workspace
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#425B76]">
              Add clearly marked demo students, courses, cohorts, payments,
              payment links, reminders, and automation rules to this workspace.
              This is tenant-scoped and does not run automatically.
            </p>
          </div>
          {canLoadDemo ? (
            <Button onClick={() => setDemoConfirmOpen(true)} type="button">
              Load Demo Data
            </Button>
          ) : (
            <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
              Owner/admin only
            </Badge>
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

      {demoConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#0B2A3D]/40 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/20 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#0E7490]">
                  Confirm demo setup
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Load sample data?
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8E8F0] text-sm font-semibold text-[#425B76] transition hover:bg-[#F3FAFD] hover:text-[#0B1F33]"
                onClick={() => setDemoConfirmOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <p className="mt-5 text-sm leading-6 text-[#425B76]">
              This will add sample students, courses, payments, payment links,
              cohorts, reminders, and automations to this workspace. Existing
              demo records are checked first, so repeated loads will not create
              duplicates.
            </p>

            {workspaceHasData ? (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                This workspace already has data. Demo records will be added
                alongside existing records and marked with sample/demo notes.
              </div>
            ) : null}

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={demoLoading}
                onClick={() => setDemoConfirmOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={demoLoading}
                onClick={handleLoadDemoData}
                type="button"
              >
                {demoLoading ? "Loading..." : "Confirm and Load Demo Data"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
