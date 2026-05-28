import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type MemberRole = "owner" | "admin" | "staff" | "trainer";

export type Permission =
  | "access_activity"
  | "access_attendance"
  | "access_operations"
  | "access_payments"
  | "access_settings"
  | "access_subscription"
  | "delete_records"
  | "invite_team"
  | "manage_attendance"
  | "manage_automations"
  | "manage_courses"
  | "manage_payments"
  | "manage_students"
  | "manage_team"
  | "manage_workspace";

const rolePermissions: Record<MemberRole, Permission[]> = {
  admin: [
    "access_activity",
    "access_attendance",
    "access_operations",
    "access_payments",
    "access_settings",
    "access_subscription",
    "delete_records",
    "invite_team",
    "manage_attendance",
    "manage_automations",
    "manage_courses",
    "manage_payments",
    "manage_students",
    "manage_workspace",
  ],
  owner: [
    "access_activity",
    "access_attendance",
    "access_operations",
    "access_payments",
    "access_settings",
    "access_subscription",
    "delete_records",
    "invite_team",
    "manage_attendance",
    "manage_automations",
    "manage_courses",
    "manage_payments",
    "manage_students",
    "manage_team",
    "manage_workspace",
  ],
  staff: ["access_attendance", "access_payments", "manage_students"],
  trainer: ["access_attendance", "manage_attendance", "manage_students"],
};

const navAccess: Record<string, (role: MemberRole | null | undefined) => boolean> =
  {
    Activity: canAccessActivity,
    Operations: canAccessOperations,
    Sessions: canAccessAttendance,
    Automations: canManageAutomations,
    Payments: canAccessPayments,
    "Payment Links": canManagePayments,
    Settings: canAccessSettings,
    Subscription: canAccessSubscription,
  };

function hasPermission(role: MemberRole | null | undefined, permission: Permission) {
  return role ? rolePermissions[role]?.includes(permission) ?? false : false;
}

export function canAccessActivity(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_activity");
}

export function canAccessOperations(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_operations");
}

export function canAccessPayments(role: MemberRole | null | undefined) {
  return hasPermission(role, "access_payments");
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
