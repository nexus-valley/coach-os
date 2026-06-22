import { logActivity } from "@/src/lib/auditLogger";
import {
  getMemberRoleForTenant,
  getRolePermissions,
  type MemberRole,
  type Permission,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export const delegatedPermissionKeys = [
  "view_payments",
  "manage_payments",
  "view_reports",
  "manage_sessions",
  "edit_attendance",
  "edit_attendance_after_lock",
  "manage_assignments",
  "review_assignments",
  "issue_certificates",
  "manage_students",
  "manage_courses",
  "manage_cohorts",
  "manage_messages",
  "manage_notifications",
  "manage_automations_readonly",
] as const;

export const delegatedPermissionScopeTypes = [
  "workspace",
  "course",
  "cohort",
  "student",
  "session",
  "assignment",
] as const;

export const delegatedPermissionStatuses = [
  "pending",
  "active",
  "expired",
  "revoked",
] as const;

export type DelegatedPermissionKey = (typeof delegatedPermissionKeys)[number];
export type DelegatedPermissionScopeType =
  (typeof delegatedPermissionScopeTypes)[number];
export type DelegatedPermissionStatus =
  (typeof delegatedPermissionStatuses)[number];

export type DelegatedPermission = {
  approved_by: string | null;
  created_at: string;
  expires_at: string | null;
  granted_by: string | null;
  id: string;
  metadata_json: Record<string, unknown>;
  permission_key: DelegatedPermissionKey;
  reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  scope_id: string | null;
  scope_type: DelegatedPermissionScopeType | null;
  starts_at: string;
  status: DelegatedPermissionStatus;
  tenant_id: string;
  updated_at: string;
  user_id: string;
};

export type DelegatedPermissionWithUser = DelegatedPermission & {
  user: {
    email: string | null;
    full_name: string | null;
    role: MemberRole | null;
  };
};

export type CreateDelegatedPermissionInput = {
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
  permissionKey: DelegatedPermissionKey;
  reason?: string | null;
  scopeId?: string | null;
  scopeType?: DelegatedPermissionScopeType | null;
  startsAt?: string | null;
  tenantId: string;
  userId: string;
};

export type DelegatedPermissionCheck = {
  logUsage?: boolean;
  permissionKey: DelegatedPermissionKey;
  scopeId?: string | null;
  scopeType?: DelegatedPermissionScopeType | null;
  tenantId: string;
  userId?: string | null;
};

export type EffectivePermission = {
  expiresAt: string | null;
  key: DelegatedPermissionKey | Permission;
  scopeId: string | null;
  scopeType: DelegatedPermissionScopeType | null;
  source: "delegated" | "role";
};

export type PermissionExplanation =
  | {
      permission: DelegatedPermissionKey | Permission;
      source: "delegated";
      delegatedPermission: DelegatedPermission;
    }
  | {
      permission: DelegatedPermissionKey | Permission;
      role: MemberRole;
      source: "role";
    }
  | {
      permission: DelegatedPermissionKey | Permission;
      source: "none";
    };

export const delegatedPermissionLabels: Record<DelegatedPermissionKey, string> = {
  edit_attendance: "Edit attendance",
  edit_attendance_after_lock: "Edit locked attendance",
  issue_certificates: "Issue certificates",
  manage_assignments: "Manage assignments",
  manage_automations_readonly: "View automations",
  manage_cohorts: "Manage cohorts",
  manage_courses: "Manage courses",
  manage_messages: "Manage messages",
  manage_notifications: "Manage notifications",
  manage_payments: "Manage payments",
  manage_sessions: "Manage sessions",
  manage_students: "Manage students",
  review_assignments: "Review assignments",
  view_payments: "View payments",
  view_reports: "View reports",
};

export const delegatedPermissionScopeLabels: Record<
  DelegatedPermissionScopeType,
  string
> = {
  assignment: "Assignment",
  cohort: "Cohort",
  course: "Course",
  session: "Session",
  student: "Student",
  workspace: "Workspace",
};

const delegatedToRolePermission: Partial<
  Record<DelegatedPermissionKey, Permission>
> = {
  edit_attendance: "manage_attendance",
  edit_attendance_after_lock: "manage_attendance",
  manage_courses: "manage_courses",
  manage_payments: "manage_payments",
  manage_students: "manage_students",
  view_payments: "access_payments",
};

const delegatedPermissionSelect =
  "id,tenant_id,user_id,permission_key,scope_type,scope_id,status,reason,granted_by,approved_by,starts_at,expires_at,revoked_at,revoked_by,metadata_json,created_at,updated_at";

function assertDelegatedPermissionKey(
  key: string,
): asserts key is DelegatedPermissionKey {
  if (!delegatedPermissionKeys.includes(key as DelegatedPermissionKey)) {
    throw new Error("Unsupported delegated permission.");
  }
}

function assertDelegatedScope(
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
) {
  if (!scopeType) {
    return;
  }

  if (!delegatedPermissionScopeTypes.includes(scopeType as DelegatedPermissionScopeType)) {
    throw new Error("Unsupported delegated permission scope.");
  }

  if (scopeType !== "workspace" && !scopeId) {
    throw new Error("Scoped permissions require a scope id.");
  }
}

function isNotExpired(permission: DelegatedPermission, now = new Date()) {
  const startsAt = new Date(permission.starts_at);
  const expiresAt = permission.expires_at ? new Date(permission.expires_at) : null;

  return (
    permission.status === "active" &&
    startsAt.getTime() <= now.getTime() &&
    (!expiresAt || expiresAt.getTime() > now.getTime())
  );
}

function scopeMatches(
  permission: DelegatedPermission,
  scopeType?: DelegatedPermissionScopeType | null,
  scopeId?: string | null,
) {
  if (!permission.scope_type || permission.scope_type === "workspace") {
    return true;
  }

  if (!scopeType) {
    return false;
  }

  if (permission.scope_type !== scopeType) {
    return false;
  }

  return Boolean(scopeId && permission.scope_id === scopeId);
}

async function getCurrentUser() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to manage permissions.");
  }

  return user;
}

async function getTenantMemberUserIds(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId);

  if (error) {
    throw error;
  }

  return new Set((data ?? []).map((member) => member.user_id as string));
}

async function getPermissionRowsForUser(tenantId: string, userId: string) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("delegated_permissions")
    .select(delegatedPermissionSelect)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return [];
    }

    throw error;
  }

  return (data ?? []) as DelegatedPermission[];
}

export async function getDelegatedPermissions(tenantId: string) {
  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(tenantId, user.id);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("delegated_permissions")
    .select(delegatedPermissionSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (role !== "owner" && role !== "admin") {
    query = query
      .eq("user_id", user.id)
      .eq("status", "active")
      .lte("starts_at", new Date().toISOString());
  }

  const { data, error } = await query;

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return [];
    }

    throw error;
  }

  const permissions = (data ?? []) as DelegatedPermission[];
  const userIds = Array.from(new Set(permissions.map((item) => item.user_id)));
  const membersResult = userIds.length
    ? await supabase
        .from("tenant_members")
        .select("user_id,role")
        .eq("tenant_id", tenantId)
        .in("user_id", userIds)
    : { data: [], error: null };

  if (membersResult.error) {
    throw membersResult.error;
  }

  const profilesResult = userIds.length
    ? await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", userIds)
    : { data: [], error: null };

  if (profilesResult.error) {
    throw profilesResult.error;
  }

  const roleByUser = new Map(
    (membersResult.data ?? []).map((member) => [
      member.user_id as string,
      member.role as MemberRole,
    ]),
  );
  const profileByUser = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id as string,
      {
        email: (profile.email as string | null) ?? null,
        full_name: (profile.full_name as string | null) ?? null,
      },
    ]),
  );

  return permissions.map((permission) => ({
    ...permission,
    user: {
      email: profileByUser.get(permission.user_id)?.email ?? null,
      full_name: profileByUser.get(permission.user_id)?.full_name ?? null,
      role: roleByUser.get(permission.user_id) ?? null,
    },
  })) satisfies DelegatedPermissionWithUser[];
}

export async function getUserDelegatedPermissions(
  tenantId: string,
  userId?: string | null,
) {
  const currentUser = await getCurrentUser();
  const targetUserId = userId ?? currentUser.id;

  if (targetUserId !== currentUser.id) {
    const role = await getMemberRoleForTenant(tenantId, currentUser.id);

    if (role !== "owner" && role !== "admin") {
      throw new Error("You can only view your own delegated permissions.");
    }
  }

  return getPermissionRowsForUser(tenantId, targetUserId);
}

export async function createDelegatedPermission(
  input: CreateDelegatedPermissionInput,
) {
  assertDelegatedPermissionKey(input.permissionKey);
  assertDelegatedScope(input.scopeType, input.scopeId);

  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(input.tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners and admins can request delegated permissions.");
  }

  const memberIds = await getTenantMemberUserIds(input.tenantId);

  if (!memberIds.has(input.userId)) {
    throw new Error("Delegated permissions can only target workspace members.");
  }

  const startsAt = input.startsAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? null;

  if (expiresAt && new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("Permission expiry must be after the start date.");
  }

  const status: DelegatedPermissionStatus = role === "owner" ? "active" : "pending";
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("delegated_permissions")
    .insert({
      approved_by: status === "active" ? user.id : null,
      expires_at: expiresAt,
      granted_by: user.id,
      metadata_json: input.metadata ?? {},
      permission_key: input.permissionKey,
      reason: input.reason?.trim() || null,
      scope_id: input.scopeType === "workspace" ? null : input.scopeId ?? null,
      scope_type: input.scopeType ?? "workspace",
      starts_at: startsAt,
      status,
      tenant_id: input.tenantId,
      user_id: input.userId,
    })
    .select(delegatedPermissionSelect)
    .single();

  if (error) {
    throw error;
  }

  const created = data as DelegatedPermission;
  await logActivity({
    action: "delegated_permission_created",
    description:
      status === "pending"
        ? "Requested a delegated permission pending owner approval."
        : "Granted an active delegated permission.",
    entityId: created.id,
    entityName: delegatedPermissionLabels[created.permission_key],
    entityType: "delegated_permission",
    metadata: {
      expires_at: created.expires_at,
      granted_by: user.id,
      permission_key: created.permission_key,
      scope_id: created.scope_id,
      scope_type: created.scope_type,
      target_user_id: created.user_id,
    },
    severity: status === "active" ? "warning" : "info",
    tenantId: input.tenantId,
  });

  if (status === "active") {
    await logActivity({
      action: "delegated_permission_activated",
      description: "Activated a delegated permission exception.",
      entityId: created.id,
      entityName: delegatedPermissionLabels[created.permission_key],
      entityType: "delegated_permission",
      metadata: {
        approved_by: user.id,
        permission_key: created.permission_key,
        target_user_id: created.user_id,
      },
      severity: "warning",
      tenantId: input.tenantId,
    });
  }

  return created;
}

export async function revokeDelegatedPermission(
  tenantId: string,
  permissionId: string,
) {
  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners and admins can revoke delegated permissions.");
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("delegated_permissions")
    .select(delegatedPermissionSelect)
    .eq("tenant_id", tenantId)
    .eq("id", permissionId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existing) {
    throw new Error("Delegated permission was not found.");
  }

  const permission = existing as DelegatedPermission;

  if (role === "admin" && permission.status !== "pending") {
    throw new Error("Admins can only withdraw pending delegated permission requests.");
  }

  const { data, error } = await supabase
    .from("delegated_permissions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
      status: "revoked",
    })
    .eq("tenant_id", tenantId)
    .eq("id", permissionId)
    .select(delegatedPermissionSelect)
    .single();

  if (error) {
    throw error;
  }

  const revoked = data as DelegatedPermission;
  await logActivity({
    action: "delegated_permission_revoked",
    description: "Revoked a delegated permission exception.",
    entityId: revoked.id,
    entityName: delegatedPermissionLabels[revoked.permission_key],
    entityType: "delegated_permission",
    metadata: {
      permission_key: revoked.permission_key,
      revoked_by: user.id,
      scope_id: revoked.scope_id,
      scope_type: revoked.scope_type,
      target_user_id: revoked.user_id,
    },
    severity: "critical",
    tenantId,
  });

  return revoked;
}

export async function hasDelegatedPermission(input: DelegatedPermissionCheck) {
  assertDelegatedPermissionKey(input.permissionKey);
  assertDelegatedScope(input.scopeType, input.scopeId);

  const currentUser = await getCurrentUser();
  const userId = input.userId ?? currentUser.id;
  const rows = await getPermissionRowsForUser(input.tenantId, userId);
  const match = rows.find(
    (permission) =>
      permission.permission_key === input.permissionKey &&
      isNotExpired(permission) &&
      scopeMatches(permission, input.scopeType, input.scopeId),
  );

  if (match && input.logUsage) {
    await logActivity({
      action: "delegated_permission_used",
      description: "Used a delegated permission exception.",
      entityId: match.id,
      entityName: delegatedPermissionLabels[match.permission_key],
      entityType: "delegated_permission",
      metadata: {
        permission_key: match.permission_key,
        scope_id: input.scopeId ?? match.scope_id,
        scope_type: input.scopeType ?? match.scope_type,
        target_user_id: userId,
      },
      tenantId: input.tenantId,
    });
  }

  return Boolean(match);
}

export async function getEffectivePermissions(
  tenantId: string,
  userId?: string | null,
) {
  const currentUser = await getCurrentUser();
  const targetUserId = userId ?? currentUser.id;
  const role = await getMemberRoleForTenant(tenantId, targetUserId);
  const basePermissions = getRolePermissions(role).map(
    (permission) =>
      ({
        expiresAt: null,
        key: permission,
        scopeId: null,
        scopeType: "workspace",
        source: "role",
      }) satisfies EffectivePermission,
  );
  const delegated = (await getUserDelegatedPermissions(tenantId, targetUserId))
    .filter((permission) => isNotExpired(permission))
    .map(
      (permission) =>
        ({
          expiresAt: permission.expires_at,
          key: permission.permission_key,
          scopeId: permission.scope_id,
          scopeType: permission.scope_type,
          source: "delegated",
        }) satisfies EffectivePermission,
    );

  return [...basePermissions, ...delegated];
}

export async function expireDelegatedPermissions(tenantId?: string) {
  const user = await getCurrentUser();
  const supabase = getSupabaseClient();
  let query = supabase
    .from("delegated_permissions")
    .update({ status: "expired" })
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
    .select(delegatedPermissionSelect);

  if (tenantId) {
    const role = await getMemberRoleForTenant(tenantId, user.id);

    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can expire delegated permissions.");
    }

    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const expired = (data ?? []) as DelegatedPermission[];

  await Promise.all(
    expired.map((permission) =>
      logActivity({
        action: "delegated_permission_expired",
        description: "Marked an expired delegated permission inactive.",
        entityId: permission.id,
        entityName: delegatedPermissionLabels[permission.permission_key],
        entityType: "delegated_permission",
        metadata: {
          expires_at: permission.expires_at,
          permission_key: permission.permission_key,
          target_user_id: permission.user_id,
        },
        severity: "warning",
        tenantId: permission.tenant_id,
      }),
    ),
  );

  return expired.length;
}

export async function explainPermissionSource(params: {
  permission: DelegatedPermissionKey | Permission;
  scopeId?: string | null;
  scopeType?: DelegatedPermissionScopeType | null;
  tenantId: string;
  userId?: string | null;
}): Promise<PermissionExplanation> {
  const user = await getCurrentUser();
  const userId = params.userId ?? user.id;
  const role = await getMemberRoleForTenant(params.tenantId, userId);
  const basePermission =
    params.permission in delegatedToRolePermission
      ? delegatedToRolePermission[params.permission as DelegatedPermissionKey]
      : (params.permission as Permission);

  if (basePermission && getRolePermissions(role).includes(basePermission)) {
    return {
      permission: params.permission,
      role: role as MemberRole,
      source: "role",
    };
  }

  if (delegatedPermissionKeys.includes(params.permission as DelegatedPermissionKey)) {
    const rows = await getPermissionRowsForUser(params.tenantId, userId);
    const delegated = rows.find(
      (permission) =>
        permission.permission_key === params.permission &&
        isNotExpired(permission) &&
        scopeMatches(permission, params.scopeType, params.scopeId),
    );

    if (delegated) {
      return {
        delegatedPermission: delegated,
        permission: params.permission,
        source: "delegated",
      };
    }
  }

  return {
    permission: params.permission,
    source: "none",
  };
}

export async function getDelegatedPermissionCounts(tenantId: string) {
  const supabase = getSupabaseClient();
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(now.getDate() + 7);

  const [activeResult, expiringResult, broadResult] = await Promise.all([
    supabase
      .from("delegated_permissions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .lte("starts_at", now.toISOString())
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`),
    supabase
      .from("delegated_permissions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .lte("starts_at", now.toISOString())
      .gt("expires_at", now.toISOString())
      .lte("expires_at", soon.toISOString()),
    supabase
      .from("delegated_permissions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .lte("starts_at", now.toISOString())
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .or("scope_type.is.null,scope_type.eq.workspace"),
  ]);

  const recoverableCodes = new Set(["42P01", "PGRST205"]);

  for (const result of [activeResult, expiringResult, broadResult]) {
    if (result.error && !recoverableCodes.has(result.error.code ?? "")) {
      throw result.error;
    }
  }

  return {
    active: activeResult.error ? 0 : activeResult.count ?? 0,
    broadWorkspace: broadResult.error ? 0 : broadResult.count ?? 0,
    expiringSoon: expiringResult.error ? 0 : expiringResult.count ?? 0,
  };
}
