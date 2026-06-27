import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type ReportsDateRange =
  | "all_time"
  | "last_30_days"
  | "last_7_days"
  | "this_month";

export type ReportCategory =
  | "assignments"
  | "attendance"
  | "communication"
  | "courses"
  | "overview"
  | "payments"
  | "students"
  | "trainers";

export type ReportFilters = {
  cohortId?: string;
  courseId?: string;
  dateRange: ReportsDateRange;
  status?: string;
  trainerUserId?: string;
};

export type ReportOption = {
  id: string;
  label: string;
};

export type ReportMetric = {
  helper: string;
  label: string;
  tone: "blue" | "cyan" | "emerald" | "orange" | "rose" | "slate";
  value: string;
};

export type ReportRow = {
  cells: string[];
  id: string;
};

export type ReportSection = {
  description: string;
  headers: string[];
  key: ReportCategory;
  metrics: ReportMetric[];
  rows: ReportRow[];
  title: string;
};

export type ReportsData = {
  canExport: boolean;
  canViewFinancials: boolean;
  filters: {
    cohorts: ReportOption[];
    courses: ReportOption[];
    statuses: ReportOption[];
    trainers: ReportOption[];
  };
  generatedAt: string;
  role: string | null;
  scopeLabel: string;
  sections: Record<ReportCategory, ReportSection>;
};

const reportCategories: ReportCategory[] = [
  "overview",
  "students",
  "attendance",
  "assignments",
  "courses",
  "payments",
  "trainers",
  "communication",
];

const emptySection = (key: ReportCategory): ReportSection => ({
  description: "No report data available yet.",
  headers: ["Area", "Status", "Notes"],
  key,
  metrics: [],
  rows: [],
  title: `${key.charAt(0).toUpperCase()}${key.slice(1)} report`,
});

function toRpcFilters(filters: ReportFilters) {
  return {
    cohort_id: filters.cohortId ?? null,
    course_id: filters.courseId ?? null,
    date_range: filters.dateRange,
    status: filters.status ?? null,
    trainer_user_id: filters.trainerUserId ?? null,
  };
}

function normalizeOptions(value: unknown): ReportOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => item as Partial<ReportOption>)
    .filter((item): item is ReportOption => Boolean(item.id && item.label));
}

function normalizeMetric(value: unknown): ReportMetric | null {
  const metric = value as Partial<ReportMetric> | null;

  if (!metric?.label) return null;

  return {
    helper: metric.helper ?? "",
    label: metric.label,
    tone: metric.tone ?? "slate",
    value: String(metric.value ?? ""),
  };
}

function normalizeRow(value: unknown, index: number): ReportRow | null {
  const row = value as Partial<ReportRow> | null;

  if (!Array.isArray(row?.cells)) return null;

  return {
    cells: row.cells.map((cell) => String(cell ?? "")),
    id: row.id ?? `row-${index}`,
  };
}

function normalizeSection(data: unknown, key: ReportCategory): ReportSection {
  const payload = (data ?? {}) as Partial<ReportSection>;

  return {
    description: payload.description ?? "No report data available yet.",
    headers: Array.isArray(payload.headers)
      ? payload.headers.map((header) => String(header))
      : emptySection(key).headers,
    key,
    metrics: Array.isArray(payload.metrics)
      ? payload.metrics
          .map(normalizeMetric)
          .filter((metric): metric is ReportMetric => Boolean(metric))
      : [],
    rows: Array.isArray(payload.rows)
      ? payload.rows
          .map(normalizeRow)
          .filter((row): row is ReportRow => Boolean(row))
      : [],
    title: payload.title ?? emptySection(key).title,
  };
}

function buildEmptySections() {
  return Object.fromEntries(
    reportCategories.map((category) => [category, emptySection(category)]),
  ) as Record<ReportCategory, ReportSection>;
}

export async function getReportsData(tenantId: string, filters: ReportFilters) {
  const supabase = getSupabaseClient();
  const rpcFilters = toRpcFilters(filters);
  const filterOptionsResult = await supabase.rpc("get_reports_filter_options", {
    p_tenant_id: tenantId,
  });

  if (filterOptionsResult.error) {
    throw filterOptionsResult.error;
  }

  const optionsPayload = (filterOptionsResult.data ?? {}) as {
    can_export?: boolean;
    can_view_financials?: boolean;
    cohorts?: unknown;
    courses?: unknown;
    role?: string | null;
    scope_label?: string;
    statuses?: unknown;
    trainers?: unknown;
  };

  const sectionResults = await Promise.allSettled(
    reportCategories.map(async (category) => {
      const { data, error } = await supabase.rpc("get_reports_center_data", {
        p_filters: rpcFilters,
        p_report_key: category,
        p_tenant_id: tenantId,
      });

      if (error) throw error;

      return [category, normalizeSection(data, category)] as const;
    }),
  );
  const sections = buildEmptySections();

  for (const result of sectionResults) {
    if (result.status === "fulfilled") {
      const [category, section] = result.value;
      sections[category] = section;
    }
  }

  return {
    canExport: Boolean(optionsPayload.can_export),
    canViewFinancials: Boolean(optionsPayload.can_view_financials),
    filters: {
      cohorts: normalizeOptions(optionsPayload.cohorts),
      courses: normalizeOptions(optionsPayload.courses),
      statuses: normalizeOptions(optionsPayload.statuses),
      trainers: normalizeOptions(optionsPayload.trainers),
    },
    generatedAt: new Date().toISOString(),
    role: optionsPayload.role ?? null,
    scopeLabel: optionsPayload.scope_label ?? "Report scope",
    sections,
  } satisfies ReportsData;
}

function escapeCsvCell(value: string | number | null | undefined) {
  const raw = value === null || typeof value === "undefined" ? "" : String(value);

  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, headers: string[], rows: string[][]) {
  if (typeof window === "undefined") {
    return;
  }

  const csv = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function exportReportSectionCsv(
  tenantId: string,
  section: ReportSection,
  filters?: ReportFilters,
) {
  downloadCsv(
    `${section.key}-report.csv`,
    section.headers,
    section.rows.map((row) => row.cells),
  );

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("record_report_export_event", {
    p_filters: {
      ...toRpcFilters(filters ?? { dateRange: "all_time" }),
      row_count: section.rows.length,
    },
    p_report_key: section.key,
    p_tenant_id: tenantId,
  });

  if (error) throw error;
}

export function exportPaymentsCsv(data: { cells: string[] }[]) {
  downloadCsv(
    "payments-report.csv",
    ["Student", "Status", "Amount", "Course", "Date"],
    data.map((row) => row.cells),
  );
}

export function exportStudentsCsv(data: { cells: string[] }[]) {
  downloadCsv(
    "students-report.csv",
    ["Student", "Status", "Attendance flags", "Pending assignments", "Payment due"],
    data.map((row) => row.cells),
  );
}

export type CourseRevenueReportRow = {
  completedPaymentCount: number;
  courseTitle: string;
  revenueAmount: number;
};

export function exportCourseRevenueCsv(data: CourseRevenueReportRow[]) {
  downloadCsv(
    "course-revenue-report.csv",
    ["Course", "Completed Payment Count", "Revenue Amount"],
    data.map((course) => [
      course.courseTitle,
      String(course.completedPaymentCount),
      String(course.revenueAmount),
    ]),
  );
}
