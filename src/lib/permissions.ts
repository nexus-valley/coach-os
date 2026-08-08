import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type {
  DelegatedPermissionKey,
  DelegatedPermissionScopeType,
} from "@/src/lib/delegatedPermissions";

export type MemberRole = "owner" | "admin" | "staff" | "trainer";

export type Permission =
  | "access_activity"
  | "access_approvals"
  | "access_backup"
  | "access_compliance"
  | "access_crm"
  | "access_documents"
  | "access_finance"
  | "access_marketing"
  | "access_attendance"
  | "access_operations"
  | "access_payments"
  | "access_permissions"
  | "access_settings"
  | "access_subscription"
  | "access_workflows"
  | "delete_records"
  | "invite_team"
  | "manage_attendance"
  | "manage_automations"
  | "manage_courses"
  | "manage_payments"
  | "manage_students"
  | "manage_team"
  | "manage_workflows"
  | "manage_workspace";

const rolePermissions: Record<MemberRole, Permission[]> = {
  admin: [
    "access_activity",
    "access_approvals",
    "access_backup",
    "access_compliance",
    "access_crm",
    "access_documents",
    "access_finance",
    "access_marketing",
    "access_attendance",
    "access_operations",
    "access_payments",
    "access_permissions",
    "access_settings",
    "access_subscription",
    "access_workflows",
    "delete_records",
    "invite_team",
    "manage_attendance",
    "manage_automations",
    "manage_courses",
    "manage_payments",
    "manage_students",
    "manage_workflows",
    "manage_workspace",
  ],
  owner: [
    "access_activity",
    "access_approvals",
    "access_backup",
    "access_compliance",
    "access_crm",
    "access_documents",
    "access_finance",
    "access_marketing",
    "access_attendance",
    "access_operations",
    "access_payments",
    "access_permissions",
    "access_settings",
    "access_subscription",
    "access_workflows",
    "delete_records",
    "invite_team",
    "manage_attendance",
    "manage_automations",
    "manage_courses",
    "manage_payments",
    "manage_students",
    "manage_team",
    "manage_workflows",
    "manage_workspace",
  ],
  staff: [
    "access_approvals",
    "access_attendance",
    "access_crm",
    "access_marketing",
    "access_payments",
    "access_workflows",
    "manage_students",
  ],
  trainer: [
    "access_approvals",
    "access_attendance",
    "access_crm",
    "access_marketing",
    "access_workflows",
    "manage_attendance",
    "manage_students",
  ],
};

const navAccess: Record<string, (role: MemberRole | null | undefined) => boolean> =
  {
    Activity: canAccessActivity,
    Analytics: canAccessReports,
    Announcements: canAccessMessages,
    Approvals: canAccessApprovals,
    Assignments: canAccessPrograms,
    Assistant: canAccessAssistant,
    "Backup & Recovery": canAccessBackup,
    Certificates: canAccessStudents,
    Cohorts: canAccessPrograms,
    Branding: canAccessSettings,
    Compliance: canAccessCompliance,
    Community: canAccessMessages,
    "Content Library": canAccessDocuments,
    CRM: canAccessCrm,
    Documents: canAccessDocuments,
    Enrollments: canAccessStudents,
    Finance: canAccessFinance,
    Features: canAccessSettings,
    Home: canAccessHome,
    "Live Classes": canAccessAttendance,
    Marketing: canAccessMarketing,
    Messages: canAccessMessages,
    "Mobile Readiness": canAccessMobileReadiness,
    Notifications: canAccessMessages,
    Operations: canAccessOperations,
    Permissions: canAccessPermissions,
    Portal: canAccessStudents,
    Programs: canAccessPrograms,
    Requests: canAccessRequests,
    Reminders: canAccessMessages,
    Sessions: canAccessAttendance,
    Automations: canManageAutomations,
    "Public Site": canAccessSettings,
    Sales: canAccessFinance,
    Settings: canAccessSettings,
    Students: canAccessStudents,
    Subscription: canAccessSubscription,
    "Team Operations": canAccessTeamOperations,
    Workflows: canAccessWorkflows,
  };

function hasPermission(role: MemberRole | null | undefined, permission: Permission) {
  return role ? rolePermissions[role]?.includes(permission) ?? false : false;
}

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

export type EffectivePermissionKey = DelegatedPermissionKey | Permission;

export function getRolePermissions(role: MemberRole | null | undefined) {
  return role ? [...(rolePermissions[role] ?? [])] : [];
}

export function canAccessActivity(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_activity");
}

export function canAccessApprovals(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_approvals");
}

export function canAccessAssistant(role: MemberRole | null | undefined) {
  return role === "owner" || role === "admin" || role === "staff" || role === "trainer";
}

export function canAccessBackup(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_backup");
}

export function canAccessCompliance(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_compliance");
}

export function canAccessCrm(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_crm");
}

export function canAccessHome() {
  return true;
}

export function canAccessPrograms() {
  return true;
}

export function canAccessRequests(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_courses");
}

export function canAccessStudents() {
  return true;
}

export function canAccessMessages() {
  return true;
}

export function canAccessReports() {
  return true;
}

export function canAccessDocuments(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_documents");
}

export function canAccessFinance(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_finance");
}

export function canAccessMarketing(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_marketing");
}

export function canAccessMobileReadiness(role: MemberRole | null | undefined) {
  return role === "owner" || role === "admin" || role === "staff" || role === "trainer";
}

export function canAccessOperations(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_operations");
}

export function canAccessPayments(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_payments");
}

export function canAccessPermissions(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_permissions");
}

export function canAccessAttendance(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_attendance");
}

export function canAccessSettings(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_settings");
}

export function canAccessSubscription(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_subscription");
}

export function canAccessTeamOperations(role: MemberRole | null | undefined) {
  return role === "owner" || role === "admin";
}

export function canAccessWorkflows(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_workflows");
}

export function canDeleteRecords(role: MemberRole | null | undefined) {
  return hasPermission(role, "delete_records");
}

export function canInviteTeam(role: MemberRole | null | undefined) {
  return hasPermission(role, "invite_team");
}

export function canManageAutomations(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_automations");
}

export function canManageAttendance(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_attendance");
}

export function canManageCourses(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_courses");
}

export function canManagePayments(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_payments");
}

export function canManageStudents(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_students");
}

export function canManageTeam(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_team");
}

export function canManageWorkflows(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_workflows");
}

export function canManageWorkspace(role: MemberRole | null | undefined) {
  return hasPermission(role, "manage_workspace");
}

export function canAccessNavigationItem(
  role: MemberRole | null | undefined,
  label: string,
) {
  return navAccess[label]?.(role) ?? true;
}

export function getRoleDisplayName(role: MemberRole | null | undefined) {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Unknown";
}

export function getRoleDescription(role: MemberRole) {
  const descriptions: Record<MemberRole, string> = {
    admin:
      "Manages operating modules, team invites, and audit visibility without workspace ownership controls.",
    owner:
      "Full workspace, billing, branding, team, audit, and destructive-action control.",
    staff:
      "Operational access for student and enrollment work with destructive and settings controls hidden.",
    trainer:
      "Training-focused access for course, cohort, and student workflows without billing or workspace settings.",
  };

  return descriptions[role];
}

export async function getMemberRoleForTenant(tenantId: string, userId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.role as MemberRole | undefined) ?? null;
}

export async function requireTenantPermission(params: {
  description?: string;
  permission: Permission;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to perform this action.");
  }

  const role = await getMemberRoleForTenant(params.tenantId, user.id);
  const allowed = hasPermission(role, params.permission);

  if (!allowed) {
    await logActivity({
      action: "access_denied",
      description:
        params.description ??
        `Blocked action requiring ${params.permission.replace(/_/g, " ")}.`,
      entityName: params.permission,
      entityType: "security",
      metadata: { permission: params.permission, role },
      severity: "warning",
      tenantId: params.tenantId,
    });

    throw new Error("You do not have permission to perform this action.");
  }

  return { role, user };
}

export async function hasEffectivePermission(params: {
  action?: string;
  entityId?: string | null;
  entityType?: string | null;
  logUsage?: boolean;
  permission: EffectivePermissionKey;
  scopeId?: string | null;
  scopeType?: DelegatedPermissionScopeType | null;
  tenantId: string;
  userId?: string | null;
}) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  const userId = params.userId ?? user?.id;

  if (!userId) {
    return false;
  }

  const role = await getMemberRoleForTenant(params.tenantId, userId);
  const rolePermission =
    params.permission in delegatedToRolePermission
      ? delegatedToRolePermission[params.permission as DelegatedPermissionKey]
      : (params.permission as Permission);

  if (rolePermission && hasPermission(role, rolePermission)) {
    return true;
  }

  const { delegatedPermissionKeys, hasDelegatedPermission } = await import(
    "@/src/lib/delegatedPermissions"
  );

  if (!delegatedPermissionKeys.includes(params.permission as DelegatedPermissionKey)) {
    return false;
  }

  return hasDelegatedPermission({
    logUsage: params.logUsage,
    action: params.action,
    entityId: params.entityId,
    entityType: params.entityType,
    permissionKey: params.permission as DelegatedPermissionKey,
    scopeId: params.scopeId,
    scopeType: params.scopeType,
    tenantId: params.tenantId,
    userId,
  });
}

export async function requireEffectivePermission(params: {
  action?: string;
  description?: string;
  entityId?: string | null;
  entityType?: string | null;
  permission: EffectivePermissionKey;
  scopeId?: string | null;
  scopeType?: DelegatedPermissionScopeType | null;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to perform this action.");
  }

  const role = await getMemberRoleForTenant(params.tenantId, user.id);
  const allowed = await hasEffectivePermission({
    logUsage: true,
    action: params.action,
    entityId: params.entityId,
    entityType: params.entityType,
    permission: params.permission,
    scopeId: params.scopeId,
    scopeType: params.scopeType,
    tenantId: params.tenantId,
    userId: user.id,
  });

  if (!allowed) {
    await logActivity({
      action: "access_denied",
      description:
        params.description ??
        `Blocked action requiring ${params.permission.replace(/_/g, " ")}.`,
      entityName: params.permission,
      entityType: "security",
      metadata: {
        permission: params.permission,
        role,
        scopeId: params.scopeId ?? null,
        scopeType: params.scopeType ?? null,
      },
      severity: "warning",
      tenantId: params.tenantId,
    });

    throw new Error("You do not have permission to perform this action.");
  }

  return { role, user };
}
