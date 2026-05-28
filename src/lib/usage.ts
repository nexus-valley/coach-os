import { logActivity } from "@/src/lib/auditLogger";
import { createNotificationForTenantRoles } from "@/src/lib/notifications";
import {
  getPlanDefinition,
  isWithinLimit,
  normalizePlanKey,
  planResourceLabels,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type WorkspaceUsage = Record<PlanResource, number>;

export type TrialStatus = {
  active: boolean;
  daysRemaining: number;
  endsAt: string | null;
  expired: boolean;
  startedAt: string | null;
};

export type TrialLifecycleState =
  | "active_paid"
  | "blocked_placeholder"
  | "grace_period"
  | "past_due"
  | "trial_active"
  | "trial_expired"
  | "trial_expiring";

type TenantPlanRecord = {
  id: string;
  is_trial_active?: boolean | null;
  plan?: string | null;
  plan_limits_json?: Record<string, unknown> | null;
  trial_ends_at?: string | null;
  trial_started_at?: string | null;
  usage_snapshot_json?: Record<string, unknown> | null;
};

type LimitCheckOptions = {
  includePendingInvitations?: boolean;
  trainerOnly?: boolean;
};

const emptyUsage: WorkspaceUsage = {
  automations: 0,
  courses: 0,
  students: 0,
  team_members: 0,
  trainers: 0,
};

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

function getCount(result: { count: number | null }) {
  return result.count ?? 0;
}

async function getResourceUsageCount(tenantId: string, resource: PlanResource) {
  const supabase = getSupabaseClient();

  if (resource === "students") {
    const { count, error } = await supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  if (resource === "courses") {
    const { count, error } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  if (resource === "automations") {
    const { count, error } = await supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  if (resource === "trainers") {
    const { count, error } = await supabase
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "trainer");

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  const { count, error } = await supabase
    .from("tenant_members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function getTenantPlanRecord(tenantId: string) {
  const supabase = getSupabaseClient();
  const fullResult = await supabase
    .from("tenants")
    .select(
      "id,plan,trial_started_at,trial_ends_at,is_trial_active,plan_limits_json,usage_snapshot_json",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (!fullResult.error) {
    return (fullResult.data as TenantPlanRecord | null) ?? null;
  }

  if (!isMissingColumnError(fullResult.error)) {
    throw fullResult.error;
  }

  const fallbackResult = await supabase
    .from("tenants")
    .select("id,plan")
    .eq("id", tenantId)
    .maybeSingle();

  if (fallbackResult.error) {
    throw fallbackResult.error;
  }

  return (fallbackResult.data as TenantPlanRecord | null) ?? null;
}

async function getPendingInvitationCount(
  tenantId: string,
  trainerOnly: boolean,
) {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("team_invitations")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");

  if (trainerOnly) {
    query = query.eq("role", "trainer");
  }

  const { count, error } = await query;

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function getWorkspaceUsage(tenantId: string) {
  const supabase = getSupabaseClient();
  const [
    studentsResult,
    coursesResult,
    trainersResult,
    automationsResult,
    teamMembersResult,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "trainer"),
    supabase
      .from("automation_rules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
  ]);

  const firstError =
    studentsResult.error ??
    coursesResult.error ??
    trainersResult.error ??
    automationsResult.error ??
    teamMembersResult.error;

  if (firstError) {
    throw firstError;
  }

  return {
    automations: getCount(automationsResult),
    courses: getCount(coursesResult),
    students: getCount(studentsResult),
    team_members: getCount(teamMembersResult),
    trainers: getCount(trainersResult),
  } satisfies WorkspaceUsage;
}

export async function refreshWorkspaceUsageSnapshot(tenantId: string) {
  const tenant = await getTenantPlanRecord(tenantId);
  let usage: WorkspaceUsage;

  try {
    usage = await getWorkspaceUsage(tenantId);
  } catch {
    return emptyUsage;
  }

  if (!tenant) {
    return usage;
  }

  const plan = normalizePlanKey(tenant.plan);
  const limits = getPlanDefinition(plan).limits;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      plan_limits_json: limits,
      usage_snapshot_json: usage,
    })
    .eq("id", tenantId);

  if (error && !isMissingColumnError(error)) {
    return usage;
  }

  return usage;
}

export async function getTrialStatus(tenantId: string): Promise<TrialStatus> {
  const tenant = await getTenantPlanRecord(tenantId);
  const endsAt = tenant?.trial_ends_at ?? null;
  const startedAt = tenant?.trial_started_at ?? null;

  if (!endsAt) {
    return {
      active: Boolean(tenant?.is_trial_active),
      daysRemaining: 0,
      endsAt,
      expired: false,
      startedAt,
    };
  }

  const remainingMs = new Date(endsAt).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / 86_400_000));
  const expired = remainingMs <= 0;

  return {
    active: Boolean(tenant?.is_trial_active) && !expired,
    daysRemaining,
    endsAt,
    expired,
    startedAt,
  };
}

export async function getTrialLifecycleState(
  tenantId: string,
): Promise<TrialLifecycleState> {
  const tenant = await getTenantPlanRecord(tenantId);
  const trial = await getTrialStatus(tenantId);

  if (tenant?.plan && normalizePlanKey(tenant.plan) !== "free") {
    return "active_paid";
  }

  if (trial.active && trial.daysRemaining <= 3) {
    return "trial_expiring";
  }

  if (trial.active) {
    return "trial_active";
  }

  if (trial.expired) {
    return "trial_expired";
  }

  return "blocked_placeholder";
}

async function getEffectiveUsageForLimit(
  tenantId: string,
  resource: PlanResource,
  options: LimitCheckOptions = {},
) {
  const usedCount = await getResourceUsageCount(tenantId, resource);
  let used = usedCount;

  if (options.includePendingInvitations) {
    used += await getPendingInvitationCount(
      tenantId,
      Boolean(options.trainerOnly),
    );
  }

  return {
    usage: {
      ...emptyUsage,
      [resource]: usedCount,
    },
    used,
  };
}

async function checkCanCreateResource(
  tenantId: string,
  resource: PlanResource,
  options: LimitCheckOptions = {},
) {
  const tenant = await getTenantPlanRecord(tenantId);
  const plan = normalizePlanKey(tenant?.plan);
  const limits = getPlanDefinition(plan).limits;
  const { usage, used } = await getEffectiveUsageForLimit(
    tenantId,
    resource,
    options,
  );
  const limit = limits[resource];

  return {
    allowed: isWithinLimit(used, limit),
    limit,
    plan,
    usage,
    used,
  };
}

export async function canCreateStudent(tenantId: string) {
  return (await checkCanCreateResource(tenantId, "students")).allowed;
}

export async function canCreateCourse(tenantId: string) {
  return (await checkCanCreateResource(tenantId, "courses")).allowed;
}

export async function canCreateAutomation(tenantId: string) {
  return (await checkCanCreateResource(tenantId, "automations")).allowed;
}

export async function canInviteTeamMember(tenantId: string) {
  return (
    await checkCanCreateResource(tenantId, "team_members", {
      includePendingInvitations: true,
    })
  ).allowed;
}

export async function canCreateTrainer(tenantId: string) {
  return (
    await checkCanCreateResource(tenantId, "trainers", {
      includePendingInvitations: true,
      trainerOnly: true,
    })
  ).allowed;
}

export async function enforceWorkspaceLimit(
  tenantId: string,
  resource: PlanResource,
  options: LimitCheckOptions = {},
) {
  const result = await checkCanCreateResource(tenantId, resource, options);

  if (result.allowed) {
    return result;
  }

  const label = planResourceLabels[resource].toLowerCase();
  const limitText =
    result.limit === "unlimited"
      ? "Unlimited"
      : (result.limit as ResourceLimit).toLocaleString();

  await logActivity({
    action: "workspace_limit_reached",
    description: `Reached ${label} limit for the ${result.plan} plan.`,
    entityName: resource,
    entityType: "subscription",
    metadata: {
      limit: limitText,
      plan: result.plan,
      resource,
      used: result.used,
    },
    severity: "warning",
    tenantId,
  });

  try {
    await createNotificationForTenantRoles({
      actionUrl: "/app/subscription",
      entityType: "usage",
      message: `The ${label} limit for the ${result.plan} plan has been reached.`,
      metadata: {
        limit: limitText,
        plan: result.plan,
        resource,
        used: result.used,
      },
      roles: ["owner", "admin"],
      severity: "warning",
      tenantId,
      title: "Workspace limit reached",
      type: "subscription_notice",
    });
  } catch {
    // Limit notifications must not hide the original upgrade prompt.
  }

  throw new Error(
    `You have reached the ${label} limit for your current plan. Upgrade your workspace plan to continue.`,
  );
}

export function getUsagePercent(used: number, limit: ResourceLimit) {
  if (limit === "unlimited") {
    return 100;
  }

  if (limit <= 0) {
    return 100;
  }

  return Math.min(100, Math.round((used / limit) * 100));
}

export { planResourceLabels };
