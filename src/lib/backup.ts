import { logActivity } from "@/src/lib/auditLogger";
import { getMemberRoleForTenant, type MemberRole } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type BackupExportType =
  | "students"
  | "courses"
  | "cohorts"
  | "enrollments"
  | "sessions"
  | "attendance"
  | "assignments"
  | "payments"
  | "certificates";

export type BackupExportLogStatus = "completed" | "failed" | "started";

export type BackupExportLog = {
  completed_at: string | null;
  created_at: string;
  export_type: BackupExportType | string;
  id: string;
  metadata_json: Record<string, unknown>;
  requested_by: string | null;
  row_count: number | null;
  status: BackupExportLogStatus | string;
  tenant_id: string;
};

export type BackupDatasetConfig = {
  description: string;
  exportType: BackupExportType;
  label: string;
};

export type BackupRecoveryData = {
  datasets: BackupDatasetConfig[];
  generatedAt: string;
  lastExportAt: string | null;
  logs: BackupExportLog[];
  readiness: Array<{
    description: string;
    key: string;
    status: "action_needed" | "manual" | "ready";
    title: string;
  }>;
  risks: Array<{
    description: string;
    key: string;
    severity: "attention" | "warning";
    title: string;
  }>;
  role: MemberRole;
};

type ExportableRow = Record<string, unknown>;

const datasetConfigs: BackupDatasetConfig[] = [
  {
    description: "Student directory, status, source, and safe contact fields.",
    exportType: "students",
    label: "Students",
  },
  {
    description: "Course catalog, slugs, statuses, and creation metadata.",
    exportType: "courses",
    label: "Courses",
  },
  {
    description: "Cohorts, course mappings, and date ranges.",
    exportType: "cohorts",
    label: "Cohorts",
  },
  {
    description: "Student course enrollments and completion timestamps.",
    exportType: "enrollments",
    label: "Enrollments",
  },
  {
    description: "Scheduled sessions and live class meeting metadata.",
    exportType: "sessions",
    label: "Sessions",
  },
  {
    description: "Attendance records, statuses, remarks, and marking timestamps.",
    exportType: "attendance",
    label: "Attendance",
  },
  {
    description: "Assignment definitions, due dates, scores, and review status.",
    exportType: "assignments",
    label: "Assignments",
  },
  {
    description: "Payment records and receipt fields. Private gateway secrets are excluded.",
    exportType: "payments",
    label: "Payments",
  },
  {
    description: "Certificate-ready completed enrollments. Certificates are derived from completions.",
    exportType: "certificates",
    label: "Certificates",
  },
];

const datasetSelects: Record<BackupExportType, { orderBy: string; select: string; table: string }> = {
  assignments: {
    orderBy: "created_at",
    select:
      "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,instructions,max_score,due_at,status,created_by,created_at,updated_at",
    table: "assignments",
  },
  attendance: {
    orderBy: "created_at",
    select:
      "id,tenant_id,session_id,student_id,status,remarks,marked_by,marked_at,created_at",
    table: "attendance_records",
  },
  certificates: {
    orderBy: "completed_at",
    select:
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_at,updated_at",
    table: "enrollments",
  },
  cohorts: {
    orderBy: "created_at",
    select: "id,tenant_id,course_id,name,description,start_date,end_date,created_at",
    table: "cohorts",
  },
  courses: {
    orderBy: "created_at",
    select:
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    table: "courses",
  },
  enrollments: {
    orderBy: "created_at",
    select:
      "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at",
    table: "enrollments",
  },
  payments: {
    orderBy: "created_at",
    select:
      "id,tenant_id,student_id,course_id,enrollment_id,amount,currency,payment_method,status,paid_at,receipt_number,receipt_generated_at,notes,created_at",
    table: "payments",
  },
  sessions: {
    orderBy: "scheduled_start_at",
    select:
      "id,tenant_id,course_id,cohort_id,trainer_user_id,title,description,scheduled_start_at,scheduled_end_at,status,delivery_mode,meeting_provider,meeting_url,meeting_id,timezone,join_available_from,recording_url,created_by,created_at,updated_at",
    table: "sessions",
  },
  students: {
    orderBy: "created_at",
    select:
      "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at",
    table: "students",
  },
};

const secretKeyPattern =
  /(password|token|secret|key|service|jwt|authorization|passcode|otp|credential)/i;

export function getBackupDatasetConfigs() {
  return datasetConfigs;
}

function assertExportType(value: string): asserts value is BackupExportType {
  if (!datasetConfigs.some((dataset) => dataset.exportType === value)) {
    throw new Error("Unsupported export type.");
  }
}

async function requireBackupAccess(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to use backup exports.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Backup and recovery access is available to owners and admins only.");
  }

  return { role, user };
}

function csvValue(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function sanitizeRows(rows: ExportableRow[]) {
  return rows.map((row) => {
    const sanitized: ExportableRow = {};

    Object.entries(row).forEach(([key, value]) => {
      if (!secretKeyPattern.test(key)) {
        sanitized[key] = value;
      }
    });

    return sanitized;
  });
}

export function rowsToCsv(rows: ExportableRow[]) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers,
    ...rows.map((row) => headers.map((header) => csvValue(row[header]))),
  ];

  return lines
    .map((line) =>
      line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, rows: ExportableRow[]) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function insertExportLog(params: {
  exportType: BackupExportType;
  metadata?: Record<string, unknown>;
  rowCount?: number;
  status: BackupExportLogStatus;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("record_backup_export_log_secure", {
      p_export_type: params.exportType,
      p_metadata: params.metadata ?? {},
      p_row_count: params.rowCount ?? null,
      p_status: params.status,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as BackupExportLog;
}

function getBackupExportErrorCategory(caught: unknown) {
  if (!(caught instanceof Error)) {
    return "unknown";
  }

  const message = caught.message.toLowerCase();

  if (message.includes("permission") || message.includes("access")) {
    return "access_denied";
  }

  if (message.includes("network") || message.includes("fetch")) {
    return "network";
  }

  if (message.includes("timeout")) {
    return "timeout";
  }

  if (message.includes("row") || message.includes("limit")) {
    return "row_limit";
  }

  return "export_failed";
}

export async function getBackupRecoveryData(tenantId: string) {
  const { role } = await requireBackupAccess(tenantId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backup_export_logs")
    .select(
      "id,tenant_id,requested_by,export_type,status,row_count,metadata_json,created_at,completed_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(12);

  const logs = error ? [] : ((data ?? []) as BackupExportLog[]);
  const lastCompleted = logs.find((log) => log.status === "completed");

  return {
    datasets: datasetConfigs,
    generatedAt: new Date().toISOString(),
    lastExportAt: lastCompleted?.completed_at ?? lastCompleted?.created_at ?? null,
    logs,
    readiness: [
      {
        description:
          "Tenant CSV exports are available from this center for operational recovery support.",
        key: "tenant_exports",
        status: "ready",
        title: "Tenant data export",
      },
      {
        description:
          "This app does not manage Supabase infrastructure backups. Confirm daily backups or manual backup process in Supabase.",
        key: "supabase_backups",
        status: "manual",
        title: "Supabase backup process",
      },
      {
        description:
          "Source recovery depends on the GitHub repository and Vercel project remaining accessible.",
        key: "source_deployment",
        status: "manual",
        title: "GitHub and Vercel recovery",
      },
      {
        description:
          "Environment variables must be documented in a secure password manager, not in source code.",
        key: "environment_variables",
        status: "manual",
        title: "Secure environment variable inventory",
      },
      {
        description:
          "Keep domain registrar and DNS recovery instructions available to owner/admin operators.",
        key: "dns_recovery",
        status: "manual",
        title: "Domain and DNS recovery steps",
      },
    ],
    risks: [
      {
        description:
          "Full database restore must be performed through Supabase or a controlled backend process, not from the browser.",
        key: "no_client_restore",
        severity: "attention",
        title: "No client-side restore actions",
      },
      {
        description:
          "CSV exports support tenant recovery workflows but are not a replacement for point-in-time database backups.",
        key: "csv_not_pitr",
        severity: "warning",
        title: "CSV export is not infrastructure backup",
      },
    ],
    role,
  } satisfies BackupRecoveryData;
}

export async function exportTenantDataset(tenantId: string, exportType: string) {
  assertExportType(exportType);
  await requireBackupAccess(tenantId);

  const config = datasetSelects[exportType];
  const startedLog = await insertExportLog({
    exportType,
    metadata: { table: config.table },
    status: "started",
    tenantId,
  });

  await logActivity({
    action: "export_started",
    description: `Started ${exportType.replace(/_/g, " ")} export`,
    entityId: startedLog.id,
    entityName: exportType,
    entityType: "backup_export",
    metadata: { exportType, table: config.table },
    severity: "info",
    tenantId,
  });

  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from(config.table)
      .select(config.select)
      .eq("tenant_id", tenantId)
      .order(config.orderBy, { ascending: false })
      .limit(5000);

    if (exportType === "certificates") {
      query = query.eq("status", "completed").not("completed_at", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const rows = sanitizeRows(((data ?? []) as unknown) as ExportableRow[]);
    const completedLog = await insertExportLog({
      exportType,
      metadata: {
        startedLogId: startedLog.id,
        table: config.table,
      },
      rowCount: rows.length,
      status: "completed",
      tenantId,
    });

    await logActivity({
      action: "export_completed",
      description: `Completed ${exportType.replace(/_/g, " ")} export`,
      entityId: completedLog.id,
      entityName: exportType,
      entityType: "backup_export",
      metadata: { exportType, rowCount: rows.length, table: config.table },
      severity: "info",
      tenantId,
    });

    return {
      filename: `coachfort-${exportType}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
    };
  } catch (caught) {
    await insertExportLog({
      exportType,
      metadata: {
        errorCategory: getBackupExportErrorCategory(caught),
        startedLogId: startedLog.id,
        table: config.table,
      },
      status: "failed",
      tenantId,
    }).catch(() => null);

    await logActivity({
      action: "export_failed",
      description: `Failed ${exportType.replace(/_/g, " ")} export`,
      entityId: startedLog.id,
      entityName: exportType,
      entityType: "backup_export",
      metadata: {
        errorCategory: getBackupExportErrorCategory(caught),
        exportType,
        table: config.table,
      },
      severity: "warning",
      tenantId,
    });

    throw caught;
  }
}

export async function logBackupCenterViewed(tenantId: string) {
  await requireBackupAccess(tenantId);
  await logActivity({
    action: "backup_center_viewed",
    description: "Opened Backup & Recovery Center",
    entityName: "Backup & Recovery",
    entityType: "backup_export",
    metadata: { route: "/app/backup" },
    severity: "info",
    tenantId,
  });
}
