import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AssistantContext,
  AssistantHomePayload,
  AssistantScope,
} from "@/src/lib/ai/assistantTypes";
import type { MobileBootstrap } from "@/src/lib/mobileTypes";

export class AssistantAccessError extends Error {
  status = 403;

  constructor(message: string) {
    super(message);
    this.name = "AssistantAccessError";
  }
}

function compactHomePayload(home: AssistantHomePayload | null) {
  if (!home) {
    return null;
  }

  return {
    pending_assignments:
      "pending_assignments" in home ? home.pending_assignments?.slice(0, 5) : undefined,
    profile: "profile" in home ? home.profile : undefined,
    summary: home.summary,
    upcoming_sessions:
      "upcoming_sessions" in home ? home.upcoming_sessions?.slice(0, 5) : undefined,
  };
}

function getTenantSummary(bootstrap: MobileBootstrap) {
  if (bootstrap.mode === "none") {
    return null;
  }

  return {
    brand_name: bootstrap.tenant.brand_name,
    id: bootstrap.tenant.id,
    name: bootstrap.tenant.name,
    slug: bootstrap.tenant.slug,
  };
}

async function callRpc<T>(
  supabase: SupabaseClient,
  name: string,
  params?: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(name, params);

  if (error) {
    throw error;
  }

  return data as T;
}

export async function buildAssistantContext(
  supabase: SupabaseClient,
  scope: AssistantScope,
): Promise<AssistantContext> {
  const bootstrap = await callRpc<MobileBootstrap>(
    supabase,
    "get_mobile_bootstrap",
  );

  if (scope === "team") {
    if (bootstrap.mode !== "team") {
      throw new AssistantAccessError("Team assistant access requires a team role.");
    }

    const home =
      bootstrap.role === "trainer"
        ? await callRpc<AssistantHomePayload>(supabase, "get_mobile_trainer_home")
        : await callRpc<AssistantHomePayload>(supabase, "get_mobile_team_home");

    const context = {
      mode: bootstrap.mode,
      permissions: bootstrap.permissions,
      role: bootstrap.role,
      sections: bootstrap.sections,
      tenant: getTenantSummary(bootstrap),
      workspace: compactHomePayload(home),
    };

    return {
      bootstrap,
      context,
      contextSummary: {
        mode: bootstrap.mode,
        role: bootstrap.role,
        sections: bootstrap.sections,
        summary: home.summary,
        tenant_id: bootstrap.tenant.id,
      },
      mode: "team",
      role: bootstrap.role,
      scope,
      tenantId: bootstrap.tenant.id,
    };
  }

  if (bootstrap.mode !== "student") {
    throw new AssistantAccessError(
      "Student assistant access requires an active student portal account.",
    );
  }

  const home = await callRpc<AssistantHomePayload>(
    supabase,
    "get_mobile_student_home",
  );

  const context = {
    mode: bootstrap.mode,
    sections: bootstrap.sections,
    student: {
      full_name: bootstrap.student.full_name,
      status: bootstrap.student.status,
    },
    tenant: getTenantSummary(bootstrap),
    workspace: compactHomePayload(home),
  };

  return {
    bootstrap,
    context,
    contextSummary: {
      mode: bootstrap.mode,
      sections: bootstrap.sections,
      student_id: bootstrap.student.id,
      summary: home.summary,
      tenant_id: bootstrap.tenant.id,
    },
    mode: "student",
    scope,
    studentId: bootstrap.student.id,
    tenantId: bootstrap.tenant.id,
  };
}
