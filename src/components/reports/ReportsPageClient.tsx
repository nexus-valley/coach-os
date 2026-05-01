"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PaymentStatusBadge } from "@/src/components/payments/PaymentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  exportCourseRevenueCsv,
  exportPaymentsCsv,
  exportStudentsCsv,
  getReportsData,
  type ReportsData,
  type ReportsDateRange,
} from "@/src/lib/reports";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const rangeOptions: { label: string; value: ReportsDateRange }[] = [
  { label: "Last 7 days", value: "last_7_days" },
  { label: "Last 30 days", value: "last_30_days" },
  { label: "This month", value: "this_month" },
  { label: "All time", value: "all_time" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
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

function StudentStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
        Active
      </Badge>
    );
  }

  if (status === "lead") {
    return (
      <Badge className="border-[#145DA0]/25 bg-[#145DA0]/10 text-[#145DA0]">
        Lead
      </Badge>
    );
  }

  if (status === "blocked") {
    return (
      <Badge className="border-red-500/30 bg-red-50 text-red-700">
        Blocked
      </Badge>
    );
  }

  return (
    <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]">
      Inactive
    </Badge>
  );
}

export function ReportsPageClient() {
  const router = useRouter();
  const [dateRange, setDateRange] =
    useState<ReportsDateRange>("last_30_days");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportsData, setReportsData] = useState<ReportsData | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadReports() {
      setLoading(true);
      setError("");

      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const data = await getReportsData(currentTenant.id, dateRange);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setReportsData(data);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load reports."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReports();

    return () => {
      active = false;
    };
  }, [dateRange, router]);

  const metrics = reportsData?.metrics;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Reports
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Reports & export
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Review revenue, students, enrollments, and payment activity for the
            current workspace.
          </p>
        </div>
        <div className="rounded-full border border-teal-400/30 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-300">
          {tenant?.name ?? "Loading workspace..."}
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">Date filter</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {rangeOptions.map((option) => {
                const active = option.value === dateRange;

                return (
                  <button
                    className={[
                      "h-10 rounded-full px-4 text-sm font-semibold transition",
                      active
                        ? "bg-teal-400 text-black"
                        : "border border-white/10 bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white",
                    ].join(" ")}
                    key={option.value}
                    onClick={() => setDateRange(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!reportsData || reportsData.payments.length === 0}
              onClick={() =>
                reportsData ? exportPaymentsCsv(reportsData.payments) : null
              }
              type="button"
              variant="secondary"
            >
              Export payments CSV
            </Button>
            <Button
              disabled={!reportsData || reportsData.students.length === 0}
              onClick={() =>
                reportsData ? exportStudentsCsv(reportsData.students) : null
              }
              type="button"
              variant="secondary"
            >
              Export students CSV
            </Button>
            <Button
              disabled={!reportsData || reportsData.courseRevenue.length === 0}
              onClick={() =>
                reportsData
                  ? exportCourseRevenueCsv(reportsData.courseRevenue)
                  : null
              }
              type="button"
              variant="secondary"
            >
              Export course revenue CSV
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card
              className="h-36 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading report metric</span>
            </Card>
          ))}
        </section>
      ) : (
        <>
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
              <p className="text-sm text-slate-400">Total revenue</p>
              <h3 className="mt-4 text-3xl font-semibold text-teal-300">
                {formatCurrency(metrics?.totalRevenue ?? 0)}
              </h3>
              <p className="mt-3 text-sm text-slate-500">
                Completed payments only
              </p>
            </Card>
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
              <p className="text-sm text-slate-400">Total payments</p>
              <h3 className="mt-4 text-3xl font-semibold">
                {metrics?.totalPaymentsCount ?? 0}
              </h3>
              <p className="mt-3 text-sm text-slate-500">
                All payment statuses
              </p>
            </Card>
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
              <p className="text-sm text-slate-400">New students</p>
              <h3 className="mt-4 text-3xl font-semibold">
                {metrics?.newStudentsCount ?? 0}
              </h3>
              <p className="mt-3 text-sm text-slate-500">
                Created in selected range
              </p>
            </Card>
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10">
              <p className="text-sm text-slate-400">Enrollments</p>
              <h3 className="mt-4 text-3xl font-semibold">
                {metrics?.enrollmentsCount ?? 0}
              </h3>
              <p className="mt-3 text-sm text-slate-500">
                Created in selected range
              </p>
            </Card>
          </section>

          <section className="mt-6">
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                    Revenue by course
                  </Badge>
                  <h3 className="mt-4 text-2xl font-semibold">
                    Course revenue overview
                  </h3>
                </div>
                <p className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-slate-300">
                  {reportsData?.courseRevenue.length ?? 0} courses
                </p>
              </div>

              {!reportsData || reportsData.courseRevenue.length === 0 ? (
                <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
                  <h4 className="text-xl font-semibold">
                    No completed revenue yet
                  </h4>
                  <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                    Completed payments will appear here grouped by course.
                  </p>
                </div>
              ) : (
                <div className="mt-7 space-y-3">
                  {reportsData.courseRevenue.map((course) => (
                    <div
                      className="grid gap-4 rounded-2xl border border-white/10 bg-[#15181b] p-4 md:grid-cols-[1fr_auto_auto] md:items-center"
                      key={course.courseId}
                    >
                      <p className="font-semibold">{course.courseTitle}</p>
                      <p className="text-sm text-slate-400">
                        {course.completedPaymentCount} completed payments
                      </p>
                      <p className="font-semibold text-teal-300">
                        {formatCurrency(course.revenueAmount)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <section className="mt-6">
            <Card className="overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
              <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-6 sm:flex-row sm:items-center">
                <div>
                  <Badge className="border-white/15 bg-white/10 text-white">
                    Payments report
                  </Badge>
                  <h3 className="mt-4 text-2xl font-semibold">Payments</h3>
                </div>
                <p className="text-sm text-slate-400">
                  {reportsData?.payments.length ?? 0} rows
                </p>
              </div>

              {!reportsData || reportsData.payments.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No payments found for this date range.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Student</th>
                        <th className="px-5 py-4">Course</th>
                        <th className="px-5 py-4">Amount</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4">Method</th>
                        <th className="px-5 py-4">Paid date</th>
                        <th className="px-5 py-4">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {reportsData.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-5 py-4 font-semibold">
                            {payment.student?.full_name ??
                              "Student unavailable"}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {payment.course?.title ?? "Course unavailable"}
                          </td>
                          <td className="px-5 py-4 font-semibold">
                            {formatCurrency(payment.amount)}
                          </td>
                          <td className="px-5 py-4">
                            <PaymentStatusBadge status={payment.status} />
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {payment.payment_method}
                          </td>
                          <td className="px-5 py-4 text-slate-400">
                            {formatDate(payment.paid_at)}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {payment.receipt_number ?? "Not generated"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>

          <section className="mt-6">
            <Card className="overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
              <div className="flex flex-col justify-between gap-4 border-b border-white/10 p-6 sm:flex-row sm:items-center">
                <div>
                  <Badge className="border-white/15 bg-white/10 text-white">
                    Students report
                  </Badge>
                  <h3 className="mt-4 text-2xl font-semibold">Students</h3>
                </div>
                <p className="text-sm text-slate-400">
                  {reportsData?.students.length ?? 0} rows
                </p>
              </div>

              {!reportsData || reportsData.students.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No students found for this date range.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[860px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Name</th>
                        <th className="px-5 py-4">Email</th>
                        <th className="px-5 py-4">Phone</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4">Source</th>
                        <th className="px-5 py-4">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {reportsData.students.map((student) => (
                        <tr key={student.id}>
                          <td className="px-5 py-4 font-semibold">
                            {student.full_name}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {student.email || "Not added"}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {student.phone || "Not added"}
                          </td>
                          <td className="px-5 py-4">
                            <StudentStatusBadge status={student.status} />
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            {student.source || "Direct"}
                          </td>
                          <td className="px-5 py-4 text-slate-400">
                            {formatDate(student.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
