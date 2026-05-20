import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AuditLogSeverity = "info" | "warning" | "critical";

export type AuditLog = {
  action: string;
  created_at: string;
  description: string | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_type: string;
  id: string;
  metadata: Record<string, unknown>;
  severity: AuditLogSeverity;
  tenant_id: string;
  user_email: string | null;
  user_id: string | null;
  user_name: string | null;
};

export type AuditLogFilters = {
  action?: string;
  dateRange?: "all" | "today" | "week" | "month";
  entityType?: string;
  limit?: number;
  page?: number;
  search?: string;
  severity?: AuditLogSeverity | "all";
};

export type LogActivityInput = {
  action: string;
  description?: string;
  entityId?: string | null;
  entityName?: string | null;
  entityType: string;
  metadata?: Record<string, unknown>;
  severity?: AuditLogSeverity;
  tenantId: string;
  userId?: string | null;
};

const auditLogListSelect =
  "id,tenant_id,user_id,user_name,user_email,action,entity_type,entity_id,entity_name,description,severity,created_at";
const auditLogDetailSelect = `${auditLogListSelect},metadata`;

function getUserDisplayName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  const metadataName = user.user_metadata?.full_name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }

  return user.email?.split("@")[0] ?? "Workspace user";
}

function getStartDateForRange(dateRange: AuditLogFilters["dateRange"]) {
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

function inferSeverity(action: string): AuditLogSeverity {
  if (
    [
      "settings_updated",
      "student_deleted",
      "subscription_plan_changed",
      "plan_updated",
      "subscription_canceled",
      "team_member_removed",
      "trial_expired",
      "certificate_revoked",
      "user_deleted",
      "workspace_modified",
    ].includes(action)
  ) {
    return "critical";
  }

  if (
    [
      "cohort_deleted",
      "course_section_deleted",
      "access_denied",
      "enrollment_deleted",
      "invitation_revoked",
      "lesson_deleted",
      "payment_deleted",
      "payment_link_deleted",
      "payment_link_updated",
      "reminder_deleted",
      "role_changed",
      "session_canceled",
      "workspace_limit_reached",
    ].includes(action)
  ) {
    return "warning";
  }

  return "info";
}

function sanitizeSearchFilter(search: string) {
  return search.replace(/[,%]/g, " ").trim();
}

export async function logActivity(input: LogActivityInput) {
  try {
    const supabase = getSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const userId = input.userId ?? user.id;
    const { data, error } = await supabase
      .from("audit_logs")
      .insert({
        action: input.action,
        description: input.description ?? null,
        entity_id: input.entityId ?? null,
        entity_name: input.entityName ?? null,
        entity_type: input.entityType,
        metadata: input.metadata ?? {},
        severity: input.severity ?? inferSeverity(input.action),
        tenant_id: input.tenantId,
        user_email: user.email ?? null,
        user_id: userId,
        user_name: getUserDisplayName(user),
      })
      .select(auditLogDetailSelect)
      .single();

    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[CoachFort audit] Activity was not recorded.", {
          code: error.code,
          message: error.message,
        });
      }

      return null;
    }

    return data as AuditLog;
  } catch (caught) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[CoachFort audit] Activity was not recorded.",
        caught instanceof Error ? caught.message : caught,
      );
    }

    return null;
  }
}

export async function getAuditLogsForTenant(
  tenantId: string,
  filters: AuditLogFilters = {},
) {
  const page = Math.max(filters.page ?? 1, 1);
  const limit = Math.min(Math.max(filters.limit ?? 25, 10), 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const supabase = getSupabaseClient();
  let query = supabase
    .from("audit_logs")
    .select(auditLogListSelect, { count: "exact" })
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

  const startDate = getStartDateForRange(filters.dateRange);

  if (startDate) {
    query = query.gte("created_at", startDate);
  }

  const search = sanitizeSearchFilter(filters.search?.trim() ?? "");

  if (search) {
    query = query.or(
      `entity_name.ilike.%${search}%,description.ilike.%${search}%,user_name.ilike.%${search}%,user_email.ilike.%${search}%`,
    );
  }

  const { count, data, error } = await query;

  if (error) {
    throw error;
  }

  return {
    hasMore: (count ?? 0) > page * limit,
    logs: (data ?? []) as AuditLog[],
    page,
    total: count ?? 0,
  };
}

export async function getAuditLogById(tenantId: string, logId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select(auditLogDetailSelect)
    .eq("tenant_id", tenantId)
    .eq("id", logId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AuditLog | null) ?? null;
}
