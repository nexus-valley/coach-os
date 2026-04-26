import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  owner_user_id: string | null;
};

export const coachingCategories = [
  "Business Coaching",
  "Fitness Coaching",
  "Stock Market / Trading",
  "Education / Exam Prep",
  "Career Coaching",
  "Other",
] as const;

export type CoachingCategory = (typeof coachingCategories)[number];

function createTenantSlug(name: string) {
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);

  return `${baseSlug || "workspace"}-${suffix}`;
}

export async function getCurrentTenant() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    return null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  if (!membership) {
    return null;
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id,name,slug,category,owner_user_id")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  if (tenantError) {
    throw tenantError;
  }

  return (tenant as Tenant | null) ?? null;
}

export async function createWorkspace(params: {
  category: CoachingCategory;
  name: string;
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
    throw new Error("You must be logged in to create a workspace.");
  }

  const workspaceName = params.name.trim();

  if (!workspaceName) {
    throw new Error("Workspace name is required.");
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      category: params.category,
      name: workspaceName,
      owner_user_id: user.id,
      slug: createTenantSlug(workspaceName),
    })
    .select("id,name,slug,category,owner_user_id")
    .single();

  if (tenantError) {
    throw tenantError;
  }

  const { error: membershipError } = await supabase
    .from("tenant_members")
    .insert({
      role: "owner",
      tenant_id: tenant.id,
      user_id: user.id,
    });

  if (membershipError) {
    throw membershipError;
  }

  return tenant as Tenant;
}
