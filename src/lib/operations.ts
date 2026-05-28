import { logActivity, type AuditLog } from "@/src/lib/auditLogger";
import { safeGetUnreadThreadCount } from "@/src/lib/messages";
import {
  canAccessOperations,
  getMemberRoleForTenant,
  type MemberRole,
} from "@/src/lib/permissions";
import {
  formatResourceLimit,
  getPlanDisplayName,
  getPlanLimits,
  normalizePlanKey,
  planResourceLabels,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getTrialStatus,
  getUsagePercent,
  refreshWorkspaceUsageSnapshot,
  type TrialStatus,
  type WorkspaceUsage,
} from "@/src/lib/usage";

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

export type OperationsUsageItem = {
  key: PlanResource;
  label: string;
  limit: ResourceLimit;
  percent: number;
  used: number;
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
  subscription: {
    plan: PlanKey;
    planName: string;
    trial: TrialStatus;
    usage: OperationsUsageItem[];
    warnings: OperationsAlert[];
  };
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

type SafeTenantSettings = {
  brand_color?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  workspace_display_name?: string | null;
};

type SafeTenantSubscription = {
  plan: PlanKey;
};

const emptyUsage: WorkspaceUsage = {
  automations: 0,
  courses: 0,
  students: 0,
  team_members: 0,
  trainers: 0,
};

const emptyTrial: TrialStatus = {
  active: false,
  daysRemaining: 0,
  endsAt: null,
  expired: false,
  startedAt: null,
};

const permissionSensitiveActions = [
  "access_denied",
  "role_changed",
  "team_member_removed",
  "settings_updated",
  "workspace_branding_updated",
  "subscription_canceled",
  "plan_updated",
];

const adminActions = [
  "role_changed",
  "settings_updated",
  "workspace_branding_updated",
  "subscription_created",
  "subscription_canceled",
  "plan_updated",
  "invitation_created",
  "invitation_revoked",
  "demo_workspace_seeded",
  "demo_workspace_reset",
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
    if (isRecoverableAnalyticsError(result.error)) {
      return 0;
    }

    throw result.error;
  }

  return result.count ?? 0;
}

async function withAnalyticsFallback<T>(
  loader: () => Promise<T>,
  fallback: T,
) {
  try {
    return await loader();
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isRecoverableAnalyticsError(caught as { code?: string; message?: string })
    ) {
      return fallback;
    }

    throw caught;
  }
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

async function getSafeTenantSubscription(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    if (isRecoverableAnalyticsError(error)) {
      return { plan: "free" } satisfies SafeTenantSubscription;
    }

    throw error;
  }

  return {
    plan: normalizePlanKey(data?.plan),
  } satisfies SafeTenantSubscription;
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

function getLimitLabel(limit: ResourceLimit) {
  return limit === "unlimited" ? "Unlimited" : formatResourceLimit(limit);
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
      description: "Payments, payment links, or billing records exist for finance visibility.",
      key: "payments",
      score: paymentScore,
      status: getStatus(paymentScore),
      title: "Payment setup readiness",
      value: params.paymentReady ? "Visible" : "Needs data",
    },
  ];

  return { cards, readinessPercent: onboardingScore };
}

function buildUsageItems(plan: PlanKey, usage: WorkspaceUsage) {
  const limits = getPlanLimits(plan);

  return (Object.keys(limits) as PlanResource[]).map((key) => ({
    key,
    label: planResourceLabels[key],
    limit: limits[key],
    percent: getUsagePercent(usage[key], limits[key]),
    used: usage[key],
  }));
}

function buildLimitWarnings(usage: OperationsUsageItem[]) {
  return usage
    .filter((item) => item.limit !== "unlimited" && item.percent >= 80)
    .map((item) => ({
      description: `${item.used.toLocaleString()} of ${getLimitLabel(item.limit)} ${item.label.toLowerCase()} used.`,
      key: `limit-${item.key}`,
      severity: item.percent >= 100 ? "warning" : "attention",
      title:
        item.percent >= 100
          ? `${item.label} limit reached`
          : `${item.label} nearing limit`,
    })) satisfies OperationsAlert[];
}

function buildOperationalAlerts(params: {
  activeAutomations: number;
  coursesWithoutCohorts: number;
  failedInvites: number;
  failedPaymentLinks: number;
  inactiveAutomations: number;
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

  if (params.failedInvites > 0 || params.failedPaymentLinks > 0) {
    alerts.push({
      description: `${params.failedInvites} failed/revoked invite${params.failedInvites === 1 ? "" : "s"} and ${params.failedPaymentLinks} failed/expired payment link${params.failedPaymentLinks === 1 ? "" : "s"} found.`,
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

  const [
    settings,
    subscription,
    trial,
    usage,
    activeStudents,
    activeCourses,
    cohortsCount,
    enrollmentsCount,
    trainersCount,
    activeAutomations,
    inactiveAutomations,
    upcomingSessions,
    overdueAssignments,
    pendingReminders,
    unreadNotifications,
    activeThreads,
    recentAnnouncements,
    failedInvites,
    failedPaymentLinks,
    unpaidInvoices,
    coursesAndCohorts,
    unreadMessageThreads,
    latestActivity,
  ] = await Promise.all([
    getSafeTenantSettings(tenantId),
    getSafeTenantSubscription(tenantId),
    withAnalyticsFallback(() => getTrialStatus(tenantId), emptyTrial),
    withAnalyticsFallback(
      () => refreshWorkspaceUsageSnapshot(tenantId),
      emptyUsage,
    ),
    countExactWithStatus("students", tenantId, "active"),
    countExactWithStatus("courses", tenantId, "published"),
    countExact("cohorts", tenantId),
    countExactWithStatus("enrollments", tenantId, "active"),
    countTrainers(tenantId),
    supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .then((result) => getCount(result as CountResult)),
    supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", false)
      .gte("updated_at", last30Days.toISOString())
      .then((result) => getCount(result as CountResult)),
    countUpcomingSessions(tenantId),
    countOverdueAssignments(tenantId),
    countPendingReminders(tenantId),
    countExactWithStatus("notifications", tenantId, "unread"),
    countExactWithStatus("conversation_threads", tenantId, "active"),
    supabase
      .from("conversation_threads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("thread_type", "announcement")
      .gte("created_at", last30Days.toISOString())
      .then((result) => getCount(result as CountResult)),
    countExactInStatus("team_invitations", tenantId, ["expired", "revoked"], last30Days.toISOString()),
    countExactInStatus("payment_links", tenantId, [
      "cancelled",
      "expired",
      "failed",
    ], last30Days.toISOString()),
    countExactInStatus("invoices", tenantId, ["issued", "overdue"]),
    withAnalyticsFallback(() => getCoursesAndCohorts(tenantId), {
      cohorts: [],
      courses: [],
    }),
    withAnalyticsFallback(() => safeGetUnreadThreadCount(tenantId), 0),
    withAnalyticsFallback(() => getLatestActivity(tenantId), []),
  ]);

  const courseIdsWithCohorts = new Set(
    coursesAndCohorts.cohorts
      .map((cohort) => cohort.course_id)
      .filter((courseId): courseId is string => Boolean(courseId)),
  );
  const coursesWithoutCohorts = coursesAndCohorts.courses.filter(
    (course) => course.status === "published" && !courseIdsWithCohorts.has(course.id),
  ).length;
  const paymentReady =
    (await countExact("payments", tenantId)) > 0 ||
    (await countExact("payment_links", tenantId)) > 0 ||
    unpaidInvoices > 0;
  const brandingConfigured = Boolean(
    settings?.workspace_display_name?.trim() &&
      settings?.brand_color?.trim() &&
      (settings.support_email?.trim() || settings.support_phone?.trim()),
  );
  const plan = subscription?.plan ?? "free";
  const usageItems = buildUsageItems(plan, usage);
  const limitWarnings = buildLimitWarnings(usageItems);
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
    ...limitWarnings,
    ...buildOperationalAlerts({
      activeAutomations,
      coursesWithoutCohorts,
      failedInvites,
      failedPaymentLinks,
      inactiveAutomations,
      overdueAssignments,
      pendingReminders,
      trainers: trainersCount,
      unpaidInvoices,
      upcomingSessions,
    }),
  ];
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
      helper: "Failed, expired, or cancelled payment links.",
      key: "failedPaymentLinks",
      label: "Payment link issues",
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
    subscription: {
      plan,
      planName: getPlanDisplayName(plan),
      trial,
      usage: usageItems,
      warnings: limitWarnings,
    },
  };
}
