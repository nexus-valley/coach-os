import { createHash } from "node:crypto";

import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tokenPattern = /^[A-Za-z0-9_-]{32,160}$/;

function jsonError(code: string, message: string, status = 400) {
  return Response.json({ code, message }, { status });
}

function mapAcceptanceError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("email") && normalized.includes("match")) {
    return jsonError(
      "email_mismatch",
      "Please sign in using the email address that received this invitation.",
      403,
    );
  }

  if (normalized.includes("expired")) {
    return jsonError(
      "invitation_expired",
      "This invitation has expired. Ask your coach to send a new one.",
      410,
    );
  }

  if (
    normalized.includes("not found") ||
    normalized.includes("invalid") ||
    normalized.includes("revoked")
  ) {
    return jsonError(
      "invitation_unavailable",
      "This invitation is no longer available. Ask your coach for a new invitation.",
      410,
    );
  }

  return jsonError(
    "needs_attention",
    "Portal access needs attention. Please contact your coach or CoachFort support.",
    409,
  );
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<{ token?: unknown }>(request);
    const rawToken = typeof body.token === "string" ? body.token.trim() : "";

    if (!tokenPattern.test(rawToken)) {
      return jsonError(
        "invitation_unavailable",
        "This invitation is not valid. Ask your coach for a new invitation.",
      );
    }

    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const tokenHash = createHash("sha256")
      .update(rawToken, "utf8")
      .digest("hex");
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.rpc(
      "accept_student_portal_invitation_secure",
      {
        p_token_hash: tokenHash,
        p_user_id: user.id,
      },
    );

    if (error) {
      return mapAcceptanceError(error.message);
    }

    const result = data as { access_status?: string } | null;

    if (result?.access_status !== "access_active") {
      return jsonError(
        "needs_attention",
        "Portal access needs attention. Please contact your coach or CoachFort support.",
        409,
      );
    }

    return Response.json({
      message: "Portal access activated.",
      status: "access_active",
    });
  } catch (caught) {
    if (caught instanceof InvalidJsonPayloadError) {
      return jsonError("invalid_request", caught.message);
    }

    if (caught instanceof Error && caught.message === "Authentication required.") {
      return jsonError("authentication_required", "Please sign in to continue.", 401);
    }

    return jsonError(
      "needs_attention",
      "Portal access needs attention. Please contact your coach or CoachFort support.",
      500,
    );
  }
}
