"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import {
  exportReportSectionCsv,
  getReportsData,
  type ReportCategory,
  type ReportFilters,
  type ReportMetric,
  type ReportSection,
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

const reportTabs: { description: string; label: string; value: ReportCategory }[] = [
  {
    description: "Cross-functional health snapshot",
    label: "Overview",
    value: "overview",
  },
  { description: "Student status and risk", label: "Students", value: "students" },
  {
    description: "Presence, absence, and late trends",
    label: "Attendance",
    value: "attendance",
  },
  {
    description: "Submission and review performance",
    label: "Assignments",
    value: "assignments",
  },
  {
    description: "Course, cohort, and session health",
    label: "Courses",
    value: "courses",
  },
  { description: "Revenue and payment backlog", label: "Payments", value: "payments" },
  {
    description: "Trainer workload and reviews",
    label: "Trainers",
    value: "trainers",
  },
  {
    description: "Notifications and message activity",
    label: "Communication",
    value: "communication",
  },
];

const metricToneClass: Record<ReportMetric["tone"], string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function MetricCard({ metric }: { metric: ReportMetric }) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm">
      <div
        className={[
          "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
          metricToneClass[metric.tone],
        ].join(" ")}
      >
        {metric.label}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33]">
        {metric.value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#66788F]">{metric.helper}</p>
    </Card>
  );
}

function ReportTable({ section }: { section: ReportSection }) {
  if (section.rows.length === 0) {
    return (
      <EmptyState
        description="This report has no rows for the selected filters."
        icon="RP"
        title="No report data"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#D8E8F0]">
      <table className="min-w-[860px] w-full bg-white text-left text-sm">
        <thead className="border-b border-[#D8E8F0] bg-[#F6FAFD] text-xs font-semibold uppercase text-[#66788F]">
          <tr>
            {section.headers.map((header) => (
              <th className="px-5 py-4" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E8F1F6]">
          {section.rows.map((row) => (
            <tr className="transition hover:bg-[#F8FCFE]" key={row.id}>
              {row.cells.map((cell, index) => (
                <td
                  className={[
                    "px-5 py-4 text-[#425B76]",
                    index === 0 ? "font-semibold text-[#0B1F33]" : "",
                  ].join(" ")}
                  key={`${row.id}-${section.headers[index] ?? index}`}
                >
                  {cell || "N/A"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPageClient() {
  const router = useRouter();
  const [activeReport, setActiveReport] = useState<ReportCategory>("overview");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<ReportFilters>({
    dateRange: "last_30_days",
  });
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

        const data = await getReportsData(currentTenant.id, filters);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setReportsData(data);
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load reports."));
        }
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
  }, [filters, router]);

  const section = reportsData?.sections[activeReport] ?? null;
  const activeTab = useMemo(
    () => reportTabs.find((tab) => tab.value === activeReport) ?? reportTabs[0],
    [activeReport],
  );

  async function handleExport() {
    if (!tenant || !section || !reportsData?.canExport) {
      return;
    }

    setExporting(true);
    setError("");

    try {
      await exportReportSectionCsv(tenant.id, section);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to export report."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#145DA0]/20 bg-[#145DA0]/10 text-[#145DA0]">
            Reports & Analytics
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Reports center
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
            Student, attendance, assignment, payment, trainer, and communication
            analytics for the current workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="light">{reportsData?.scopeLabel ?? "Loading scope"}</Badge>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            {tenant?.name ?? "Workspace"}
          </Badge>
        </div>
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-[#425B76]">Date range</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {rangeOptions.map((option) => {
                const active = option.value === filters.dateRange;

                return (
                  <button
                    className={[
                      "h-10 rounded-full px-4 text-sm font-semibold transition",
                      active
                        ? "bg-[#145DA0] text-white shadow-sm"
                        : "border border-[#D8E8F0] bg-white text-[#425B76] hover:bg-[#F3FAFD]",
                    ].join(" ")}
                    key={option.value}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        dateRange: option.value,
                      }))
                    }
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#425B76]">Course</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  courseId: event.target.value || undefined,
                }))
              }
              value={filters.courseId ?? ""}
            >
              <option value="">All courses</option>
              {reportsData?.filters.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#425B76]">Cohort</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  cohortId: event.target.value || undefined,
                }))
              }
              value={filters.cohortId ?? ""}
            >
              <option value="">All cohorts</option>
              {reportsData?.filters.cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {cohort.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#425B76]">Status</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value || undefined,
                }))
              }
              value={filters.status ?? ""}
            >
              <option value="">All statuses</option>
              {reportsData?.filters.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#425B76]">Trainer</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  trainerUserId: event.target.value || undefined,
                }))
              }
              value={filters.trainerUserId ?? ""}
            >
              <option value="">All trainers</option>
              {reportsData?.filters.trainers.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.label}
                </option>
              ))}
            </select>
          </label>

          <Button
            disabled={!section || !reportsData?.canExport || section.rows.length === 0 || exporting}
            onClick={handleExport}
            type="button"
            variant="secondary"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
        <p className="mt-4 text-sm text-[#66788F]">
          Generated {reportsData ? formatDateTime(reportsData.generatedAt) : "after loading"}.
          Trainer users see assigned-course, assigned-cohort, and scoped-student
          analytics only.
        </p>
      </Card>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="mt-6 grid gap-3 lg:grid-cols-4">
        {reportTabs.map((tab) => {
          const active = tab.value === activeReport;

          return (
            <button
              className={[
                "rounded-2xl border p-4 text-left transition",
                active
                  ? "border-[#145DA0] bg-[#145DA0] text-white shadow-lg shadow-[#145DA0]/15"
                  : "border-[#D8E8F0] bg-white text-[#425B76] hover:border-[#2ECBEA]/60 hover:bg-[#F8FCFE]",
              ].join(" ")}
              key={tab.value}
              onClick={() => setActiveReport(tab.value)}
              type="button"
            >
              <span className="text-sm font-semibold">{tab.label}</span>
              <span
                className={[
                  "mt-2 block text-xs leading-5",
                  active ? "text-blue-100" : "text-[#66788F]",
                ].join(" ")}
              >
                {tab.description}
              </span>
            </button>
          );
        })}
      </section>

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card
              className="h-36 animate-pulse border-[#D8E8F0] bg-white"
              key={item}
            >
              <span className="sr-only">Loading report metric</span>
            </Card>
          ))}
        </section>
      ) : section ? (
        <section className="mt-6 space-y-6">
          <div>
            <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
              {activeTab.label}
            </Badge>
            <h3 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
              {section.title}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66788F]">
              {section.description}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {section.metrics.map((metric) => (
              <MetricCard key={`${section.key}-${metric.label}`} metric={metric} />
            ))}
          </div>

          <Card className="border-[#D8E8F0] bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h4 className="text-xl font-semibold text-[#0B1F33]">
                  Report rows
                </h4>
                <p className="mt-1 text-sm text-[#66788F]">
                  Showing up to 12 high-signal rows for this report.
                </p>
              </div>
              <Badge tone="light">{section.rows.length} rows</Badge>
            </div>
            <ReportTable section={section} />
          </Card>
        </section>
      ) : (
        <EmptyState
          description="Reports will appear once workspace data is available."
          icon="RP"
          title="No reports available"
        />
      )}
    </div>
  );
}
