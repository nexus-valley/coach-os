import { logActivity } from "@/src/lib/auditLogger";
import {
  canDeleteRecords,
  canManageCourses,
  canManagePayments,
  canManageTeam,
  getMemberRoleForTenant,
  requireTenantPermission,
  type MemberRole,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

export {
  canDeleteRecords,
  canManageCourses,
  canManagePayments,
  canManageTeam,
};
export type { MemberRole };

export type TenantMember = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
};

export type MemberProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type TenantMemberWithProfile = TenantMember & {
  profile: MemberProfile | null;
};

const tenantMemberSelect = "id,tenant_id,user_id,role,created_at";

export async function getCurrentMemberRole(tenantId: string, userId: string) {
  return getMemberRoleForTenant(tenantId, userId);
}

export async function getTenantMembers(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select(tenantMemberSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const members = (data ?? []) as TenantMember[];
  const userIds = Array.from(new Set(members.map((member) => member.user_id)));
  const profilesResult = userIds.length
    ? await supabase
        .from("profiles")
        .select("id,full_name,email,avatar_url")
        .in("id", userIds)
    : { data: [], error: null };

  if (profilesResult.error) {
    throw profilesResult.error;
  }

  const profiles = (profilesResult.data ?? []) as MemberProfile[];
  const profileById = new Map(
    profiles.map((profile) => [profile.id, profile]),
  );

  return members.map((member) => ({
    ...member,
    profile: profileById.get(member.user_id) ?? null,
  })) as TenantMemberWithProfile[];
}

export async function updateTenantMemberRole(
  tenantId: string,
  memberId: string,
  role: Exclude<MemberRole, "owner">,
) {
  await requireTenantPermission({
    description: "Blocked team role change without owner permission.",
    permission: "manage_team",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingMember, error: existingError } = await supabase
    .from("tenant_members")
    .select(tenantMemberSelect)
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .neq("role", "owner")
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (role === "trainer" && existingMember?.role !== "trainer") {
    await enforceWorkspaceLimit(tenantId, "trainers");
  }

  const { data, error } = await supabase
    .from("tenant_members")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .neq("role", "owner")
    .select(tenantMemberSelect)
    .single();

  if (error) {
    throw error;
  }

  const member = data as TenantMember;

  await logActivity({
    action: "role_changed",
    description: `Changed team member role to ${member.role}`,
    entityId: member.id,
    entityName: member.role,
    entityType: "team_member",
    metadata: { role: member.role, userId: member.user_id },
    severity: "warning",
    tenantId: member.tenant_id,
  });
  await refreshWorkspaceUsageSnapshot(member.tenant_id);

  return member;
}

export async function removeTenantMember(tenantId: string, memberId: string) {
  await requireTenantPermission({
    description: "Blocked team member removal without owner permission.",
    permission: "manage_team",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingMember, error: existingError } = await supabase
    .from("tenant_members")
    .select(tenantMemberSelect)
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .neq("role", "owner")
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("tenant_members")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .neq("role", "owner");

  if (error) {
    throw error;
  }

  if (existingMember) {
    const member = existingMember as TenantMember;
    await logActivity({
      action: "team_member_removed",
      description: "Removed team member from workspace",
      entityId: member.id,
      entityName: member.role,
      entityType: "team_member",
      metadata: { role: member.role, userId: member.user_id },
      severity: "critical",
      tenantId: member.tenant_id,
    });
  }

  await refreshWorkspaceUsageSnapshot(tenantId);
}
