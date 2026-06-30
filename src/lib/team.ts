import {
  canDeleteRecords,
  canAccessAttendance,
  canManageCourses,
  canManageAttendance,
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
  canAccessAttendance,
  canDeleteRecords,
  canManageAttendance,
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
    .rpc("update_tenant_member_role_secure", {
      p_member_id: memberId,
      p_role: role,
      p_tenant_id: tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  const member = data as TenantMember;
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
  const { error } = await supabase.rpc("remove_tenant_member_secure", {
    p_member_id: memberId,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  await refreshWorkspaceUsageSnapshot(tenantId);
}
