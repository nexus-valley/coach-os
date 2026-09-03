import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  owner_user_id: string | null;
};

export const coachingCategories = [
  "Academic / school tutoring",
  "Competitive exam coaching",
  "Professional / career coaching",
  "Business / entrepreneurship coaching",
  "Fitness / wellness coaching",
  "Life coaching / personal development",
  "Language coaching",
  "Music / arts / creative coaching",
  "Technology / coding coaching",
  "Finance / trading coaching",
  "Spiritual / mindfulness coaching",
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

type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
  name?: string;
};

function getSupabaseErrorDetails(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as SupabaseErrorLike;

    return {
      code: candidate.code,
      details: candidate.details,
      hint: candidate.hint,
      message: candidate.message,
      name: candidate.name,
    };
  }

  return {
    code: undefined,
    details: undefined,
    hint: undefined,
    message: error instanceof Error ? error.message : undefined,
    name: error instanceof Error ? error.name : undefined,
  };
}

function logWorkspaceCreationError(stage: string, error: unknown) {
  const details = getSupabaseErrorDetails(error);

  console.error("[CoachFort onboarding] Workspace creation failed", {
    code: details.code,
    details: details.details,
    hint: details.hint,
    message: details.message,
    name: details.name,
    stage,
  });
}

function getWorkspaceCreationMessage(error: unknown, fallback: string) {
  const details = getSupabaseErrorDetails(error);
  const message = details.message ?? "";

  if (message.toLowerCase().includes("failed to fetch")) {
    return "Unable to reach Supabase while creating your workspace. Please check the Supabase URL/CORS settings and try again.";
  }

  if (details.code === "42501") {
    return "Workspace creation was blocked by Supabase security policies. Run the onboarding RLS fix SQL, then try again.";
  }

  if (details.code === "23505") {
    return "That workspace slug already exists. Please try again.";
  }

  return message || fallback;
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

  let existingTenant: Tenant | null = null;

  try {
    existingTenant = await getCurrentTenant();
  } catch (caught) {
    logWorkspaceCreationError("existing_tenant_lookup", caught);
    throw new Error(
      getWorkspaceCreationMessage(
        caught,
        "Unable to verify your existing workspace access. Please try again.",
      ),
    );
  }

  if (existingTenant) {
    return existingTenant;
  }

  const slug = createTenantSlug(workspaceName);
  let rpcTenant: unknown = null;
  let rpcError: SupabaseErrorLike | null = null;

  try {
    const result = await supabase
      .rpc("create_workspace_with_owner", {
        workspace_category: params.category,
        workspace_name: workspaceName,
        workspace_slug: slug,
      })
      .single();

    rpcTenant = result.data;
    rpcError = result.error;
  } catch (caught) {
    logWorkspaceCreationError("create_workspace_with_owner_rpc_fetch", caught);
    throw new Error(
      getWorkspaceCreationMessage(
        caught,
        "Unable to create your workspace. Please try again.",
      ),
    );
  }

  if (!rpcError && rpcTenant) {
    const tenant = rpcTenant as Tenant;

    await logActivity({
      action: "trial_started",
      description: "Started workspace trial.",
      entityId: tenant.id,
      entityName: tenant.name,
      entityType: "subscription",
      tenantId: tenant.id,
    });

    return tenant;
  }

  if (rpcError?.code !== "PGRST202") {
    logWorkspaceCreationError("create_workspace_with_owner_rpc", rpcError);
    throw new Error(
      getWorkspaceCreationMessage(
        rpcError,
        "Unable to create your workspace. Please try again.",
      ),
    );
  }

  logWorkspaceCreationError("create_workspace_with_owner_rpc_missing", rpcError);
  throw new Error(
    "Workspace setup is temporarily unavailable. Please contact support.",
  );
}
