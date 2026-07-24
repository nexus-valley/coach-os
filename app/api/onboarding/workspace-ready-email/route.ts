import { sendCoachFortTransactionalEmail } from "@/src/lib/server/email";
import { buildWorkspaceReadyEmail } from "@/src/lib/server/emailTemplates";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  getBearerToken,
  getUserScopedSupabase,
} from "@/src/lib/server/documentStorage";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TenantEmailRow = {
  id: string;
  name: string;
  slug: string | null;
};

function jsonError(message: string, status = 400) {
  return Response.json({ message }, { status });
}

function getAppOrigin(request: Request) {
  const configuredOrigin =
    process.env.COACHFORT_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/g, "");
  }

  return new URL(request.url).origin.replace(/\/+$/g, "");
}

function buildPublicPageUrl(origin: string, tenantSlug: string | null) {
  if (!tenantSlug) {
    return null;
  }

  return `${origin}/site/${encodeURIComponent(tenantSlug)}`;
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<{ tenantId?: unknown }>(request);
    const tenantId =
      typeof body.tenantId === "string" ? body.tenantId.trim() : "";

    if (!tenantId) {
      return jsonError("Workspace id is required.");
    }

    const accessToken = getBearerToken(request);
    const supabase = getUserScopedSupabase(accessToken);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return jsonError("Authentication required.", 401);
    }

    const recipientEmail = user.email?.trim();

    if (!recipientEmail) {
      return jsonError("Authenticated user email is required.", 400);
    }

    const roleCheck = await supabase.rpc("has_tenant_role", {
      allowed_roles: ["owner", "admin"],
      check_tenant_id: tenantId,
      check_user_id: user.id,
    });

    if (roleCheck.error) {
      return jsonError(roleCheck.error.message, 403);
    }

    if (roleCheck.data !== true) {
      return jsonError(
        "Only workspace owners and admins can send workspace setup email.",
        403,
      );
    }

    const tenantResult = await supabase
      .from("tenants")
      .select("id,name,slug")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantResult.error) {
      return jsonError(tenantResult.error.message, 403);
    }

    if (!tenantResult.data) {
      return jsonError("Workspace not found.", 404);
    }

    const tenant = tenantResult.data as TenantEmailRow;
    const origin = getAppOrigin(request);
    const result = await sendCoachFortTransactionalEmail({
      email: recipientEmail,
      failureMessage: "Unable to send workspace setup email.",
      logContext: {
        tenantId: tenant.id,
        template: "coach.workspace_ready",
      },
      template: buildWorkspaceReadyEmail({
        appUrl: `${origin}/app`,
        publicPageUrl: buildPublicPageUrl(origin, tenant.slug),
        tenantName: tenant.name,
      }),
    });

    return Response.json({
      delivered: result.delivered,
      provider: result.provider,
      template: "coach.workspace_ready",
      tenantId: tenant.id,
    });
  } catch (caught) {
    if (caught instanceof InvalidJsonPayloadError) {
      return jsonError(caught.message);
    }

    const message =
      caught instanceof Error
        ? caught.message
        : "Unable to send workspace setup email.";

    if (message === "Authentication required.") {
      return jsonError(message, 401);
    }

    captureServerException(caught, {
      operation: "onboarding_workspace_ready_email",
      route: "/api/onboarding/workspace-ready-email",
    });

    return jsonError(message, 500);
  }
}
