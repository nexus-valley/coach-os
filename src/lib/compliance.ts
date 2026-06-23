import {
  formatActivityAction,
  formatActivityEntity,
  normalizeSeverity,
} from "@/src/lib/activityFormatter";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { AuditLog, AuditLogSeverity } from "@/src/lib/auditLogger";
import { getMemberRoleForTenant, type MemberRole } from "@/src/lib/permissions";

export type ComplianceCategory =
  | "all"
  | "auth_security"
  | "users_roles"
  | "students"
  | "courses_cohorts"
  | "sessions_attendance"
  | "assignments"
  | "payments"
  | "automation"
  | "delegated_permissions"
  | "settings"
  | "system";

export type ComplianceFilters = {
  action?: string;
  category?: ComplianceCategory;
  dateRange?: "all" | "today" | "week" | "month";
  entityType?: string;
  limit?: number;
  page?: number;
  search?: string;
  severity?: AuditLogSeverity | "all";
};

export type ComplianceAutomationRun = {
  completedAt: string | null;
  entityId: string | null;
  entityType: string | null;
  errorMessage: string | null;
  id: string;
  startedAt: string;
  status: string;
  triggerSource: string | null;
};

export type ComplianceSummary = {
  automationRuns: number;
  delegatedPermissionUsage: number;
  failedOrBlockedActions: number;
  paymentEvents: number;
  recentSecurityEvents: number;
  sensitiveEvents: number;
  totalAuditEvents: number;
  userRoleChanges: number;
};

export type ComplianceActor = {
  id: string;
  label: string;
};

export type ComplianceData = {
  actors: ComplianceActor[];
  automationDelegationEvents: AuditLog[];
  automationRuns: ComplianceAutomationRun[];
  events: AuditLog[];
  generatedAt: string;
  hasMore: boolean;
  paymentEvents: AuditLog[];
  role: MemberRole;
  sensitiveEvents: AuditLog[];
  summary: ComplianceSummary;
  total: number;
};

const auditLogComplianceSelect =
  "id,tenant_id,user_id,user_name,user_email,action,entity_type,entity_id,entity_name,description,severity,created_at,metadata";

const sensitiveActions = new Set([
  "access_denied",
  "role_changed",
  "team_member_removed",
  "delegated_permission_created",
  "delegated_permission_activated",
  "delegated_permission_revoked",
  "delegated_permission_expired",
  "delegated_permission_used",
  "automation_created",
  "automation_updated",
  "automation_enabled",
  "automation_disabled",
  "automation_failed",
  "automation_duplicate_skipped",
  "payment_created",
  "payment_deleted",
  "payment_link_updated",
  "payment_link_deleted",
  "receipt_generated",
  "subscription_status_changed",
  "workspace_plan_changed",
  "billing_profile_updated",
  "settings_updated",
  "branding_updated",
  "workspace_branding_updated",
  "student_deleted",
]);

const categoryEntityTypes: Record<Exclude<ComplianceCategory, "all">, string[]> = {
  assignments: ["assignment", "assignment_submission"],
  auth_security: ["security"],
  automation: ["automation", "automation_run", "automation_run_log"],
  courses_cohorts: ["course", "cohort", "course_section", "lesson"],
  delegated_permissions: ["delegated_permission"],
  payments: [
    "payment",
    "payment_link",
    "receipt",
    "invoice",
    "payment_transaction",
    "subscription",
  ],
  sessions_attendance: ["session", "attendance_record"],
  settings: ["workspace_settings", "usage"],
  students: ["student", "enrollment", "student_portal_account"],
  system: ["operations", "report", "demo_data", "notification", "communication_log"],
  users_roles: ["team_member", "team_invitation", "trainer_assignment"],
};

const secretKeyPattern =
  /(password|token|secret|key|service|jwt|authorization|passcode|otp|credential)/i;

function getStartDateForRange(dateRange: ComplianceFilters["dateRange"]) {
  const now = new Date();

  if (dateRange === "today") {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  if (dateRange === "week") {
    now.setDate(now.getDate() - 7);
    return now.toISOString();
  }

  if (dateRange === "month") {
    now.setDate(now.getDate() - 30);
    return now.toISOString();
  }

  return null;
}

function sanitizeSearchFilter(search: string) {
  return search.replace(/[,%]/g, " ").trim();
}

function isSensitiveEvent(log: AuditLog) {
  return normalizeSeverity(log.severity) === "critical" || sensitiveActions.has(log.action);
}

function isFailedOrBlocked(log: AuditLog) {
  return (
    log.action.includes("failed") ||
    log.action.includes("blocked") ||
    log.action === "access_denied" ||
    normalizeSeverity(log.severity) === "critical"
  );
}

function isPaymentEvent(log: AuditLog) {
  return categoryEntityTypes.payments.includes(log.entity_type);
}

function isAutomationOrDelegation(log: AuditLog) {
  return (
    categoryEntityTypes.automation.includes(log.entity_type) ||
    categoryEntityTypes.delegated_permissions.includes(log.entity_type)
  );
}

export function getComplianceCategoryLabel(category: ComplianceCategory) {
  const labels: Record<ComplianceCategory, string> = {
    all: "All categories",
    assignments: "Assignments",
    auth_security: "Auth & security",
    automation: "Automation",
    courses_cohorts: "Courses & cohorts",
    delegated_permissions: "Delegated permissions",
    payments: "Payments & finance",
    sessions_attendance: "Sessions & attendance",
    settings: "Settings",
    students: "Students",
    system: "System",
    users_roles: "Users & roles",
  };

  return labels[category];
}

export const complianceCategoryOptions: Array<{
  label: string;
  value: ComplianceCategory;
}> = [
  "all",
  "auth_security",
  "users_roles",
  "students",
  "courses_cohorts",
  "sessions_attendance",
  "assignments",
  "payments",
  "automation",
  "delegated_permissions",
  "settings",
  "system",
].map((value) => ({
  label: getComplianceCategoryLabel(value as ComplianceCategory),
  value: value as ComplianceCategory,
}));

function summarizeMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") {
    return "No metadata";
  }

  const safeEntries = Object.entries(metadata)
    .filter(([key]) => !secretKeyPattern.test(key))
    .slice(0, 4)
    .map(([key, value]) => {
      if (value === null || typeof value === "undefined") {
        return `${key}: empty`;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value).slice(0, 80)}`;
      }

      if (Array.isArray(value)) {
        return `${key}: ${value.length} item${value.length === 1 ? "" : "s"}`;
      }

      return `${key}: object`;
    });

  return safeEntries.length ? safeEntries.join(" | ") : "Metadata redacted";
}

export function getComplianceMetadataSummary(log: AuditLog) {
  return summarizeMetadata(log.metadata);
}

export function exportComplianceEventsCsv(logs: AuditLog[]) {
  const header = [
    "timestamp",
    "actor",
    "email",
    "category",
    "action",
    "entity_type",
    "entity_name",
    "severity",
    "description",
    "metadata_summary",
  ];
  const rows = logs.map((log) => [
    log.created_at,
    log.user_name || log.user_email || "Workspace user",
    log.user_email ?? "",
    formatActivityEntity(log.entity_type),
    formatActivityAction(log.action),
    log.entity_type,
    log.entity_name ?? "",
    normalizeSeverity(log.severity),
    log.description ?? "",
    getComplianceMetadataSummary(log),
  ]);
  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "coachfort-compliance-events.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function countAuditLogs(tenantId: string) {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function getOptionalAutomationRuns(tenantId: string) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("automation_runs")
      .select(
        "id,status,trigger_source,entity_type,entity_id,started_at,completed_at,error_message",
      )
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(12);

    if (error) {
      throw error;
    }

    return ((data ?? []) as Array<{
      completed_at: string | null;
      entity_id: string | null;
      entity_type: string | null;
      error_message: string | null;
      id: string;
      started_at: string;
      status: string;
      trigger_source: string | null;
    }>).map((run) => ({
      completedAt: run.completed_at,
      entityId: run.entity_id,
      entityType: run.entity_type,
      errorMessage: run.error_message,
      id: run.id,
      startedAt: run.started_at,
      status: run.status,
      triggerSource: run.trigger_source,
    }));
  } catch {
    return [];
  }
}

export async function getComplianceCenterData(
  tenantId: string,
  filters: ComplianceFilters = {},
): Promise<ComplianceData> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to view compliance data.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Compliance visibility is available to owners and admins only.");
  }

  const page = Math.max(filters.page ?? 1, 1);
  const limit = Math.min(Math.max(filters.limit ?? 50, 25), 200);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("audit_logs")
    .select(auditLogComplianceSelect, { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.action && filters.action !== "all") {
    query = query.eq("action", filters.action);
  }

  if (filters.entityType && filters.entityType !== "all") {
    query = query.eq("entity_type", filters.entityType);
  }

  if (filters.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }

  if (filters.category && filters.category !== "all") {
    query = query.in("entity_type", categoryEntityTypes[filters.category]);
  }

  const startDate = getStartDateForRange(filters.dateRange);

  if (startDate) {
    query = query.gte("created_at", startDate);
  }

  const search = sanitizeSearchFilter(filters.search?.trim() ?? "");

  if (search) {
    query = query.or(
      `entity_name.ilike.%${search}%,description.ilike.%${search}%,user_name.ilike.%${search}%,user_email.ilike.%${search}%,action.ilike.%${search}%`,
    );
  }

  const [{ count, data, error }, totalAuditEvents, automationRuns] =
    await Promise.all([
      query,
      countAuditLogs(tenantId),
      getOptionalAutomationRuns(tenantId),
    ]);

  if (error) {
    throw error;
  }

  const events = ((data ?? []) as AuditLog[]).map((log) => ({
    ...log,
    metadata: log.metadata ?? {},
    severity: normalizeSeverity(log.severity),
  }));

  const actorsById = new Map<string, ComplianceActor>();
  events.forEach((event) => {
    if (event.user_id) {
      actorsById.set(event.user_id, {
        id: event.user_id,
        label: event.user_name || event.user_email || "Workspace user",
      });
    }
  });

  const sensitiveEvents = events.filter(isSensitiveEvent);
  const automationDelegationEvents = events.filter(isAutomationOrDelegation);
  const paymentEvents = events.filter(isPaymentEvent);

  return {
    actors: Array.from(actorsById.values()),
    automationDelegationEvents: automationDelegationEvents.slice(0, 8),
    automationRuns,
    events,
    generatedAt: new Date().toISOString(),
    hasMore: (count ?? 0) > page * limit,
    paymentEvents: paymentEvents.slice(0, 8),
    role,
    sensitiveEvents: sensitiveEvents.slice(0, 8),
    summary: {
      automationRuns: automationRuns.length,
      delegatedPermissionUsage: events.filter(
        (event) => event.action === "delegated_permission_used",
      ).length,
      failedOrBlockedActions: events.filter(isFailedOrBlocked).length,
      paymentEvents: paymentEvents.length,
      recentSecurityEvents: events.filter(
        (event) => event.entity_type === "security" || event.action === "access_denied",
      ).length,
      sensitiveEvents: sensitiveEvents.length,
      totalAuditEvents,
      userRoleChanges: events.filter(
        (event) =>
          event.action === "role_changed" ||
          event.entity_type === "team_member" ||
          event.entity_type === "team_invitation",
      ).length,
    },
    total: count ?? 0,
  };
}
