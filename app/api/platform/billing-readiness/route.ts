import {
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  getPlatformProviderReadiness,
  normalizePlatformBillingCurrency,
  normalizePlatformBillingReadiness,
} from "@/src/lib/server/platformBillingReadiness";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  );
}

export async function GET(request: Request) {
  let actorId: string | null = null;
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    actorId = user.id;

    const url = new URL(request.url);
    tenantId = url.searchParams.get("tenantId")?.trim() ?? null;
    const expectedCurrency = normalizePlatformBillingCurrency(
      url.searchParams.get("expectedCurrency"),
    );

    if (!tenantId || !uuidPattern.test(tenantId) || !expectedCurrency) {
      return jsonError("Billing readiness request is invalid.", 400);
    }

    const userScopedSupabase = getUserScopedSupabase(accessToken);
    const { data: platformActor, error: roleError } = await userScopedSupabase
      .from("platform_admin_users")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (roleError) {
      captureServerException(roleError, {
        actor_id: actorId,
        operation: "platform_billing_readiness_role_check",
        tenant_id: tenantId,
      });
      return jsonError("Billing readiness could not be checked.", 500);
    }

    if (platformActor?.role !== "owner" && platformActor?.role !== "admin") {
      return jsonError(
        "Billing readiness is restricted to Platform Owner and Admin roles.",
        403,
      );
    }

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      "get_platform_billing_readiness_server",
      {
        p_expected_currency: expectedCurrency,
        p_tenant_id: tenantId,
      },
    );

    if (error) {
      captureServerException(error, {
        actor_id: actorId,
        operation: "platform_billing_readiness",
        tenant_id: tenantId,
      });
      return jsonError("Billing readiness could not be checked.", 500);
    }

    return Response.json(
      normalizePlatformBillingReadiness(data, getPlatformProviderReadiness()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Authentication required." ||
        error.message === "Please sign in again to continue.")
    ) {
      return jsonError("Please sign in again to continue.", 401);
    }

    captureServerException(error, {
      actor_id: actorId,
      operation: "platform_billing_readiness",
      tenant_id: tenantId,
    });
    return jsonError("Billing readiness could not be checked.", 500);
  }
}
