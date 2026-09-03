import { logActivity, type AuditLog } from "@/src/lib/auditLogger";
import { getTeamChatThreads } from "@/src/lib/academyChat";
import { getDelegatedPermissionCounts } from "@/src/lib/delegatedPermissions";
import { safeOptionalQuery } from "@/src/lib/optionalQuery";
import {
  canAccessOperations,
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type OperationsStatus = "attention" | "healthy" | "warning";

export type OperationsHealthCard = {
  description: string;
  key: string;
  score: number;
  status: OperationsStatus;
  title: string;
  value: string;
};

export type OperationsMetric = {
  helper: string;
  key: string;
  label: string;
  tone: "blue" | "cyan" | "emerald" | "orange" | "rose" | "slate";
  value: string;
};

export type OperationsAlert = {
  description: string;
  key: string;
  severity: Exclude<OperationsStatus, "healthy">;
  title: string;
};

export type OperationsFeedItem = {
  action: string;
  createdAt: string;
  description: string;
  entityName: string;
  entityType: string;
  id: string;
  severity: string;
};

export type OperationsConsoleData = {
  alerts: OperationsAlert[];
  communication: {
    activeThreads: number;
    recentAnnouncements: number;
    unreadMessageThreads: number;
    unreadNotifications: number;
  };
  feed: {
    adminActions: OperationsFeedItem[];
    communicationActivity: OperationsFeedItem[];
    latest: OperationsFeedItem[];
  };
  generatedAt: string;
  health: {
    cards: OperationsHealthCard[];
    readinessPercent: number;
  };
  metrics: OperationsMetric[];
  role: MemberRole;
  securitySignals: OperationsMetric[];
};

type CountResult = {
  count: number | null;
  error: { code?: string; message?: string } | null;
};

type AuditRow = {
  action: string;
  created_at: string;
  description: string | null;
  entity_name: string | null;
  entity_type: string;
  id: string;
  severity: string;
};

type CourseRow = {
  id: string;
  status: string;
  title: string;
};

type CohortRow = {
  course_id: string | null;
  id: string;
  name: string;
};

type AutomationRunSignal = {
  error_message: string | null;
  started_at: string;
  trigger_source: string | null;
};

type SafeTenantSettings = {
  brand_color?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  workspace_display_name?: string | null;
};

const permissionSensitiveActions = [
  "access_denied",
  "role_changed",
  "delegated_permission_created",
  "delegated_permission_activated",
  "delegated_permission_revoked",
  "delegated_permission_expired",
  "delegated_permission_used",
  "team_member_removed",
  "settings_updated",
  "workspace_branding_updated",
  "subscription_canceled",
  "plan_updated",
];

const adminActions = [
  "role_changed",
  "delegated_permission_created",
  "delegated_permission_activated",
  "delegated_permission_revoked",
  "delegated_permission_expired",
  "settings_updated",
  "workspace_branding_updated",
  "subscription_created",
  "subscription_canceled",
  "plan_updated",
  "invitation_created",
  "invitation_revoked",
  "demo_workspace_seeded",
  "demo_workspace_reset",
  "automation_created",
  "automation_updated",
  "automation_enabled",
  "automation_disabled",
  "automation_failed",
];

const communicationActions = [
  "conversation_created",
  "conversation_archived",
  "conversation_locked",
  "message_sent",
  "message_edited",
  "message_deleted",
  "notification_created",
  "notification_archived",
  "communication_logged",
];

function isRecoverableAnalyticsError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    error?.code === "42501" ||
    message.includes("column") ||
    message.includes("permission denied") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function getCount(result: CountResult) {
  if (result.error) {
    throw result.error;
  }

  return result.count ?? 0;
}

async function optionalOperationQuery<T>(
  helper: string,
  table: string,
  loader: () => Promise<T>,
  fallback: T,
) {
  return safeOptionalQuery(
    {
      area: "operations.getOperationsConsoleData",
      helper,
      table,
    },
    loader,
    fallback,
  );
}

async function getSafeTenantSettings(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("workspace_display_name,brand_color,support_email,support_phone")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    if (isRecoverableAnalyticsError(error)) {
      return null;
    }

    throw error;
  }

  return (data as SafeTenantSettings | null) ?? null;
}

function getStatus(score: number): OperationsStatus {
  if (score >= 80) {
    return "healthy";
  }

  if (score >= 45) {
    return "attention";
  }

  return "warning";
}

function toFeedItem(row: AuditRow): OperationsFeedItem {
  return {
    action: row.action,
    createdAt: row.created_at,
    description: row.description ?? "Operational activity recorded.",
    entityName: row.entity_name ?? row.entity_type,
    entityType: row.entity_type,
    id: row.id,
    severity: row.severity,
  };
}

async function getCurrentUserAndRole(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to access operations.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!canAccessOperations(role)) {
    await logActivity({
      action: "access_denied",
      description: "Blocked operations console access without owner/admin role.",
      entityName: "Operations",
      entityType: "security",
      metadata: { role },
      severity: "warning",
      tenantId,
    });

    throw new Error("Operations console is available to owners and admins only.");
  }

  return { role: role as MemberRole, user };
}

async function countExact(table: string, tenantId: string) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  return getCount(result as CountResult);
}

async function countExactWithStatus(
  table: string,
  tenantId: string,
  status: string,
) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", status);

  return getCount(result as CountResult);
}

async function countExactWithStatusSince(
  table: string,
  tenantId: string,
  status: string,
  since: string,
) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", status)
    .gte("started_at", since);

  return getCount(result as CountResult);
}

async function getAutomationRunSignals(tenantId: string, since: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("trigger_source,status,error_message,started_at")
    .eq("tenant_id", tenantId)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isRecoverableAnalyticsError(error)) {
      return {
        latestFailure: null,
        topTrigger: null,
      };
    }

    throw error;
  }

  const runs = (data ?? []) as (AutomationRunSignal & { status: string })[];
  const triggerCounts = new Map<string, number>();

  for (const run of runs) {
    if (!run.trigger_source) {
      continue;
    }

    triggerCounts.set(run.trigger_source, (triggerCounts.get(run.trigger_source) ?? 0) + 1);
  }

  const topTrigger = Array.from(triggerCounts.entries()).sort(
    (left, right) => right[1] - left[1],
  )[0];

  return {
    latestFailure:
      runs.find((run) => run.status === "failed") ?? null,
    topTrigger: topTrigger
      ? {
          count: topTrigger[1],
          trigger: topTrigger[0],
        }
      : null,
  };
}

async function countExactInStatus(
  table: string,
  tenantId: string,
  statuses: string[],
  since?: string,
) {
  const supabase = getSupabaseClient();
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", statuses);

  if (since) {
    query = query.gte("created_at", since);
  }

  const result = await query;

  return getCount(result as CountResult);
}

async function countUpcomingSessions(tenantId: string) {
  const supabase = getSupabaseClient();
  const now = new Date();
  const weekAhead = new Date(now);
  weekAhead.setDate(now.getDate() + 7);

  const result = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "scheduled")
    .gte("scheduled_start_at", now.toISOString())
    .lte("scheduled_start_at", weekAhead.toISOString());

  return getCount(result as CountResult);
}

async function countOverdueAssignments(tenantId: string) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("status", "closed")
    .lt("due_at", new Date().toISOString());

  return getCount(result as CountResult);
}

async function countPendingReminders(tenantId: string) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString());

  return getCount(result as CountResult);
}

async function countTrainers(tenantId: string) {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("tenant_members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "trainer");

  return getCount(result as CountResult);
}

async function getCoursesAndCohorts(tenantId: string) {
  const supabase = getSupabaseClient();
  const [coursesResult, cohortsResult] = await Promise.all([
    supabase
      .from("courses")
      .select("id,title,status")
      .eq("tenant_id", tenantId),
    supabase
      .from("cohorts")
      .select("id,name,course_id")
      .eq("tenant_id", tenantId),
  ]);

  if (coursesResult.error) {
    if (isRecoverableAnalyticsError(coursesResult.error)) {
      return { cohorts: [], courses: [] };
    }

    throw coursesResult.error;
  }

  if (cohortsResult.error) {
    if (isRecoverableAnalyticsError(cohortsResult.error)) {
      return {
        cohorts: [],
        courses: (coursesResult.data ?? []) as CourseRow[],
      };
    }

    throw cohortsResult.error;
  }

  return {
    cohorts: (cohortsResult.data ?? []) as CohortRow[],
    courses: (coursesResult.data ?? []) as CourseRow[],
  };
}

async function getLatestActivity(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,action,entity_type,entity_name,description,severity,created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    if (isRecoverableAnalyticsError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as AuditLog[]).map((row) =>
    toFeedItem(row as unknown as AuditRow),
  );
}

function buildHealthCards(params: {
  activeAutomations: number;
  activeCourses: number;
  activeThreads: number;
  brandingConfigured: boolean;
  cohorts: number;
  enrollments: number;
  paymentReady: boolean;
  students: number;
  unreadNotifications: number;
}) {
  const brandingScore = params.brandingConfigured ? 100 : 35;
  const courseScore =
    params.activeCourses > 0 && params.cohorts > 0 && params.enrollments > 0
      ? 100
      : params.activeCourses > 0
        ? 65
        : 20;
  const automationScore = params.activeAutomations > 0 ? 100 : 35;
  const communicationScore =
    params.activeThreads > 0 || params.unreadNotifications > 0 ? 100 : 45;
  const paymentScore = params.paymentReady ? 100 : 40;
  const onboardingScore = Math.round(
    (brandingScore +
      courseScore +
      automationScore +
      communicationScore +
      paymentScore) /
      5,
  );

  const cards: OperationsHealthCard[] = [
    {
      description: "Composite readiness across branding, courses, payments, automations, and communication.",
      key: "onboarding",
      score: onboardingScore,
      status: getStatus(onboardingScore),
      title: "Onboarding readiness",
      value: `${onboardingScore}%`,
    },
    {
      description: "Workspace name, brand color, and support identity are configured.",
      key: "branding",
      score: brandingScore,
      status: getStatus(brandingScore),
      title: "Branding configured",
      value: params.brandingConfigured ? "Ready" : "Needs setup",
    },
    {
      description: "Courses, cohorts, and enrollments exist for operational demos.",
      key: "courses",
      score: courseScore,
      status: getStatus(courseScore),
      title: "Course readiness",
      value: `${params.activeCourses} courses`,
    },
    {
      description: "Active automation rules are available for follow-up workflows.",
      key: "automations",
      score: automationScore,
      status: getStatus(automationScore),
      title: "Automation readiness",
      value: `${params.activeAutomations} active`,
    },
    {
      description: "Message threads or notifications are available for team operations.",
      key: "communication",
      score: communicationScore,
      status: getStatus(communicationScore),
      title: "Communication readiness",
      value: `${params.activeThreads} threads`,
    },
    {
      description: "Finance records or preserved legacy payment-link records exist for visibility.",
      key: "payments",
      score: paymentScore,
      status: getStatus(paymentScore),
      title: "Payment setup readiness",
      value: params.paymentReady ? "Visible" : "Needs data",
    },
  ];

  return { cards, readinessPercent: onboardingScore };
}

function buildOperationalAlerts(params: {
  activeAutomations: number;
  coursesWithoutCohorts: number;
  failedInvites: number;
  failedPaymentLinks: number;
  inactiveAutomations: number;
  failedAutomationRuns: number;
  draftAutomations: number;
  overdueAssignments: number;
  pendingReminders: number;
  trainers: number;
  unpaidInvoices: number;
  upcomingSessions: number;
}) {
  const alerts: OperationsAlert[] = [];

  if (params.trainers === 0) {
    alerts.push({
      description: "No trainer users are active in this workspace yet.",
      key: "no-trainers",
      severity: "attention",
      title: "No trainers assigned",
    });
  }

  if (params.upcomingSessions === 0) {
    alerts.push({
      description: "There are no scheduled sessions in the next 7 days.",
      key: "no-upcoming-sessions",
      severity: "attention",
      title: "No upcoming sessions",
    });
  }

  if (params.coursesWithoutCohorts > 0) {
    alerts.push({
      description: `${params.coursesWithoutCohorts} active course${params.coursesWithoutCohorts === 1 ? "" : "s"} do not have cohorts.`,
      key: "courses-without-cohorts",
      severity: "attention",
      title: "Courses without cohorts",
    });
  }

  if (params.unpaidInvoices > 0) {
    alerts.push({
      description: `${params.unpaidInvoices} billing invoice${params.unpaidInvoices === 1 ? "" : "s"} need follow-up.`,
      key: "unpaid-invoices",
      severity: "warning",
      title: "Unpaid invoices",
    });
  }

  if (params.overdueAssignments > 0 || params.pendingReminders > 0) {
    alerts.push({
      description: `${params.overdueAssignments} overdue assignment${params.overdueAssignments === 1 ? "" : "s"} and ${params.pendingReminders} pending reminder${params.pendingReminders === 1 ? "" : "s"}.`,
      key: "work-queue",
      severity: "warning",
      title: "Operational follow-up queue",
    });
  }

  if (params.inactiveAutomations > 0 && params.activeAutomations === 0) {
    alerts.push({
      description: "Automation rules exist but none are active.",
      key: "inactive-automations",
      severity: "attention",
      title: "Automations are inactive",
    });
  }

  if (params.failedAutomationRuns > 0) {
    alerts.push({
      description: `${params.failedAutomationRuns} automation run${params.failedAutomationRuns === 1 ? "" : "s"} failed recently.`,
      key: "failed-automation-runs",
      severity: "warning",
      title: "Automation failures detected",
    });
  }

  if (params.draftAutomations > 0) {
    alerts.push({
      description: `${params.draftAutomations} workflow draft${params.draftAutomations === 1 ? "" : "s"} are waiting to be activated.`,
      key: "draft-automations",
      severity: "attention",
      title: "Automation drafts pending",
    });
  }

  if (params.failedInvites > 0 || params.failedPaymentLinks > 0) {
    alerts.push({
      description: `${params.failedInvites} failed/revoked invite${params.failedInvites === 1 ? "" : "s"} and ${params.failedPaymentLinks} failed/expired parked online-payment record${params.failedPaymentLinks === 1 ? "" : "s"} found.`,
      key: "failed-operations",
      severity: "attention",
      title: "Recent failed operations",
    });
  }

  return alerts;
}

export async function getOperationsConsoleData(
  tenantId: string,
): Promise<OperationsConsoleData> {
  const { role } = await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  const now = new Date();
  const last30Days = new Date(now);
  last30Days.setDate(now.getDate() - 30);
  const last24Hours = new Date(now);
  last24Hours.setDate(now.getDate() - 1);

  const [
    settings,
    activeStudents,
    activeCourses,
    cohortsCount,
    enrollmentsCount,
    trainersCount,
    activeAutomations,
    inactiveAutomations,
    failedAutomationRuns,
    automationRunsLast24Hours,
    failedAutomationRunsLast24Hours,
    automationRunSignals,
    draftAutomations,
    upcomingSessions,
    overdueAssignments,
    pendingReminders,
    unreadNotifications,
    activeThreads,
    recentAnnouncements,
    failedInvites,
    failedPaymentLinks,
    delegatedPermissionCounts,
    unpaidInvoices,
    coursesAndCohorts,
    unreadMessageThreads,
    latestActivity,
  ] = await Promise.all([
    optionalOperationQuery<SafeTenantSettings | null>(
      "getSafeTenantSettings",
      "tenants",
      () => getSafeTenantSettings(tenantId),
      null,
    ),
    optionalOperationQuery(
      "countActiveStudents",
      "students",
      () => countExactWithStatus("students", tenantId, "active"),
      0,
    ),
    optionalOperationQuery(
      "countPublishedCourses",
      "courses",
      () => countExactWithStatus("courses", tenantId, "published"),
      0,
    ),
    optionalOperationQuery(
      "countCohorts",
      "cohorts",
      () => countExact("cohorts", tenantId),
      0,
    ),
    optionalOperationQuery(
      "countActiveEnrollments",
      "enrollments",
      () => countExactWithStatus("enrollments", tenantId, "active"),
      0,
    ),
    optionalOperationQuery(
      "countTrainers",
      "tenant_members",
      () => countTrainers(tenantId),
      0,
    ),
    optionalOperationQuery(
      "countActiveAutomations",
      "automation_rules",
      async () => {
        const result = await supabase
          .from("automation_rules")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true);

        return getCount(result as CountResult);
      },
      0,
    ),
    optionalOperationQuery(
      "countInactiveAutomations",
      "automation_rules",
      async () => {
        const result = await supabase
          .from("automation_rules")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", false)
          .gte("updated_at", last30Days.toISOString());

        return getCount(result as CountResult);
      },
      0,
    ),
    optionalOperationQuery(
      "countFailedAutomationRuns",
      "automation_runs",
      () => countExactWithStatus("automation_runs", tenantId, "failed"),
      0,
    ),
    optionalOperationQuery(
      "countAutomationRunsLast24Hours",
      "automation_runs",
      async () => {
        const result = await supabase
          .from("automation_runs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("started_at", last24Hours.toISOString());

        return getCount(result as CountResult);
      },
      0,
    ),
    optionalOperationQuery(
      "countFailedAutomationRunsLast24Hours",
      "automation_runs",
      () =>
        countExactWithStatusSince(
          "automation_runs",
          tenantId,
          "failed",
          last24Hours.toISOString(),
        ),
      0,
    ),
    optionalOperationQuery(
      "getAutomationRunSignals",
      "automation_runs",
      () => getAutomationRunSignals(tenantId, last24Hours.toISOString()),
      { latestFailure: null, topTrigger: null },
    ),
    optionalOperationQuery(
      "countDraftAutomations",
      "automation_rules",
      () => countExactWithStatus("automation_rules", tenantId, "draft"),
      0,
    ),
    optionalOperationQuery(
      "countUpcomingSessions",
      "sessions",
      () => countUpcomingSessions(tenantId),
      0,
    ),
    optionalOperationQuery(
      "countOverdueAssignments",
      "assignments",
      () => countOverdueAssignments(tenantId),
      0,
    ),
    optionalOperationQuery(
      "countPendingReminders",
      "reminders",
      () => countPendingReminders(tenantId),
      0,
    ),
    optionalOperationQuery(
      "countUnreadNotifications",
      "notifications",
      () => countExactWithStatus("notifications", tenantId, "unread"),
      0,
    ),
    optionalOperationQuery(
      "countActiveTeamChatThreads",
      "get_team_chat_threads",
      async () => {
        const threads = await getTeamChatThreads(tenantId);

        return threads.filter((thread) => thread.status === "active").length;
      },
      0,
    ),
    optionalOperationQuery(
      "countRecentTeamChatAnnouncements",
      "get_team_chat_threads",
      async () => {
        const threads = await getTeamChatThreads(tenantId);
        const threshold = last30Days.getTime();

        return threads.filter(
          (thread) =>
            ["course_announcement", "cohort_announcement"].includes(
              thread.thread_type,
            ) && new Date(thread.created_at).getTime() >= threshold,
        ).length;
      },
      0,
    ),
    optionalOperationQuery(
      "countFailedInvites",
      "team_invitations",
      () =>
        countExactInStatus(
          "team_invitations",
          tenantId,
          ["expired", "revoked"],
          last30Days.toISOString(),
        ),
      0,
    ),
    optionalOperationQuery(
      "countFailedPaymentLinks",
      "payment_links",
      () =>
        countExactInStatus(
          "payment_links",
          tenantId,
          ["cancelled", "expired", "failed"],
          last30Days.toISOString(),
        ),
      0,
    ),
    optionalOperationQuery(
      "getDelegatedPermissionCounts",
      "delegated_permissions",
      () => getDelegatedPermissionCounts(tenantId),
      { active: 0, broadWorkspace: 0, expiringSoon: 0 },
    ),
    optionalOperationQuery(
      "countUnpaidInvoices",
      "invoices",
      () => countExactInStatus("invoices", tenantId, ["issued", "overdue"]),
      0,
    ),
    optionalOperationQuery(
      "getCoursesAndCohorts",
      "courses/cohorts",
      () => getCoursesAndCohorts(tenantId),
      {
        cohorts: [],
        courses: [],
      },
    ),
    optionalOperationQuery(
      "getUnreadTeamChatThreadCount",
      "get_team_chat_threads",
      async () => 0,
      0,
    ),
    optionalOperationQuery(
      "getLatestActivity",
      "audit_logs",
      () => getLatestActivity(tenantId),
      [],
    ),
  ]);

  const courseIdsWithCohorts = new Set(
    coursesAndCohorts.cohorts
      .map((cohort) => cohort.course_id)
      .filter((courseId): courseId is string => Boolean(courseId)),
  );
  const coursesWithoutCohorts = coursesAndCohorts.courses.filter(
    (course) => course.status === "published" && !courseIdsWithCohorts.has(course.id),
  ).length;
  const [paymentCount, paymentLinkCount] = await Promise.all([
    optionalOperationQuery(
      "countPaymentsForReadiness",
      "payments",
      () => countExact("payments", tenantId),
      0,
    ),
    optionalOperationQuery(
      "countPaymentLinksForReadiness",
      "payment_links",
      () => countExact("payment_links", tenantId),
      0,
    ),
  ]);
  const paymentReady =
    paymentCount > 0 || paymentLinkCount > 0 || unpaidInvoices > 0;
  const brandingConfigured = Boolean(
    settings?.workspace_display_name?.trim() &&
      settings?.brand_color?.trim() &&
      (settings.support_email?.trim() || settings.support_phone?.trim()),
  );
  const health = buildHealthCards({
    activeAutomations,
    activeCourses,
    activeThreads,
    brandingConfigured,
    cohorts: cohortsCount,
    enrollments: enrollmentsCount,
    paymentReady,
    students: activeStudents,
    unreadNotifications,
  });
  const alerts = [
    ...buildOperationalAlerts({
      activeAutomations,
      draftAutomations,
      coursesWithoutCohorts,
      failedInvites,
      failedAutomationRuns,
      failedPaymentLinks,
      inactiveAutomations,
      overdueAssignments,
      pendingReminders,
      trainers: trainersCount,
      unpaidInvoices,
      upcomingSessions,
    }),
  ];

  if (automationRunSignals.latestFailure) {
    alerts.push({
      description:
        automationRunSignals.latestFailure.error_message ??
        "A workflow failed in the last 24 hours.",
      key: "latest-automation-failure",
      severity: "warning",
      title: "Latest automation failure",
    });
  }

  if (delegatedPermissionCounts.broadWorkspace > 0) {
    alerts.push({
      description: `${delegatedPermissionCounts.broadWorkspace} delegated permission${delegatedPermissionCounts.broadWorkspace === 1 ? "" : "s"} grant workspace-wide access.`,
      key: "broad-delegated-permissions",
      severity: "attention",
      title: "Broad delegated permissions",
    });
  }

  if (delegatedPermissionCounts.expiringSoon > 0) {
    alerts.push({
      description: `${delegatedPermissionCounts.expiringSoon} delegated permission${delegatedPermissionCounts.expiringSoon === 1 ? "" : "s"} expire in the next 7 days.`,
      key: "expiring-delegated-permissions",
      severity: "attention",
      title: "Delegated permissions expiring",
    });
  }

  const permissionSignals = latestActivity.filter((item) =>
    permissionSensitiveActions.includes(item.action),
  );
  const metrics: OperationsMetric[] = [
    {
      helper: "Active learner profiles in this workspace.",
      key: "students",
      label: "Active students",
      tone: "blue",
      value: activeStudents.toLocaleString(),
    },
    {
      helper: "Published courses ready for delivery.",
      key: "courses",
      label: "Active courses",
      tone: "cyan",
      value: activeCourses.toLocaleString(),
    },
    {
      helper: "Cohorts currently available for operations.",
      key: "cohorts",
      label: "Active cohorts",
      tone: "emerald",
      value: cohortsCount.toLocaleString(),
    },
    {
      helper: "Trainer users in the workspace team.",
      key: "trainers",
      label: "Active trainers",
      tone: trainersCount > 0 ? "slate" : "orange",
      value: trainersCount.toLocaleString(),
    },
    {
      helper: "Scheduled classes in the next 7 days.",
      key: "sessions",
      label: "Sessions next 7 days",
      tone: upcomingSessions > 0 ? "emerald" : "orange",
      value: upcomingSessions.toLocaleString(),
    },
    {
      helper: "Due assignments that are not closed.",
      key: "overdueAssignments",
      label: "Overdue assignments",
      tone: overdueAssignments > 0 ? "rose" : "emerald",
      value: overdueAssignments.toLocaleString(),
    },
    {
      helper: "Pending reminders due now or overdue.",
      key: "pendingReminders",
      label: "Pending reminders",
      tone: pendingReminders > 0 ? "orange" : "emerald",
      value: pendingReminders.toLocaleString(),
    },
    {
      helper: "Active automation rules for operational workflows.",
      key: "automations",
      label: "Active automations",
      tone: activeAutomations > 0 ? "cyan" : "orange",
      value: activeAutomations.toLocaleString(),
    },
    {
      helper: "Automation workflow runs recorded in the last 24 hours.",
      key: "automationRuns24h",
      label: "Automation runs 24h",
      tone: automationRunsLast24Hours > 0 ? "cyan" : "slate",
      value: automationRunsLast24Hours.toLocaleString(),
    },
    {
      helper: "Most common automation trigger in the last 24 hours.",
      key: "automationTopTrigger",
      label: "Top trigger 24h",
      tone: automationRunSignals.topTrigger ? "blue" : "slate",
      value: automationRunSignals.topTrigger
        ? `${automationRunSignals.topTrigger.trigger} (${automationRunSignals.topTrigger.count})`
        : "None",
    },
  ];
  const securitySignals: OperationsMetric[] = [
    {
      helper: "Revoked or expired invitations.",
      key: "failedInvites",
      label: "Failed invites",
      tone: failedInvites > 0 ? "orange" : "emerald",
      value: failedInvites.toLocaleString(),
    },
    {
      helper: "Failed, expired, or cancelled parked online-payment records.",
      key: "failedPaymentLinks",
      label: "Parked gateway issues",
      tone: failedPaymentLinks > 0 ? "orange" : "emerald",
      value: failedPaymentLinks.toLocaleString(),
    },
    {
      helper: "Inactive automation rules.",
      key: "inactiveAutomations",
      label: "Inactive automations",
      tone: inactiveAutomations > 0 ? "slate" : "emerald",
      value: inactiveAutomations.toLocaleString(),
    },
    {
      helper: "Failed automation workflow runs.",
      key: "failedAutomationRuns",
      label: "Automation failures",
      tone: failedAutomationRuns > 0 ? "rose" : "emerald",
      value: failedAutomationRuns.toLocaleString(),
    },
    {
      helper: "Failed automation workflow runs in the last 24 hours.",
      key: "failedAutomationRuns24h",
      label: "Automation failures 24h",
      tone: failedAutomationRunsLast24Hours > 0 ? "rose" : "emerald",
      value: failedAutomationRunsLast24Hours.toLocaleString(),
    },
    {
      helper: "Active permission exceptions granted outside base roles.",
      key: "delegatedPermissions",
      label: "Delegated permissions",
      tone: delegatedPermissionCounts.active > 0 ? "orange" : "emerald",
      value: delegatedPermissionCounts.active.toLocaleString(),
    },
    {
      helper: "Delegated permission exceptions expiring within 7 days.",
      key: "delegatedPermissionsExpiring",
      label: "Expiring exceptions",
      tone: delegatedPermissionCounts.expiringSoon > 0 ? "orange" : "emerald",
      value: delegatedPermissionCounts.expiringSoon.toLocaleString(),
    },
    {
      helper: "Recent permission-sensitive activity events.",
      key: "permissionActions",
      label: "Sensitive activity",
      tone: permissionSignals.length > 0 ? "orange" : "emerald",
      value: permissionSignals.length.toLocaleString(),
    },
  ];

  await Promise.all([
    logActivity({
      action: "operations_console_viewed",
      description: "Viewed read-only operations console.",
      entityName: "Operations Console",
      entityType: "operations",
      metadata: { role },
      tenantId,
    }),
    logActivity({
      action: "workspace_health_checked",
      description: "Checked workspace operational health.",
      entityName: "Workspace Health",
      entityType: "operations",
      metadata: {
        alerts: alerts.length,
        readinessPercent: health.readinessPercent,
      },
      tenantId,
    }),
  ]);

  return {
    alerts,
    communication: {
      activeThreads,
      recentAnnouncements,
      unreadMessageThreads,
      unreadNotifications,
    },
    feed: {
      adminActions: latestActivity
        .filter((item) => adminActions.includes(item.action))
        .slice(0, 6),
      communicationActivity: latestActivity
        .filter((item) => communicationActions.includes(item.action))
        .slice(0, 6),
      latest: latestActivity.slice(0, 8),
    },
    generatedAt: new Date().toISOString(),
    health,
    metrics,
    role,
    securitySignals,
  };
}
