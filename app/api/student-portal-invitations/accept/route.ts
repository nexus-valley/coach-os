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
import {
  classifyStudentPortalInvitationAcceptanceError,
  classifyStudentPortalInvitationAcceptanceResult,
  getStudentPortalInvitationAcceptanceFailure,
} from "@/src/lib/studentPortalInvitationAcceptance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tokenPattern = /^[A-Za-z0-9_-]{32,160}$/;

function jsonError(code: string, message: string, status = 400) {
  return Response.json({ code, message }, { status });
}

function acceptanceErrorResponse(
  code: Parameters<typeof getStudentPortalInvitationAcceptanceFailure>[0],
) {
  const failure = getStudentPortalInvitationAcceptanceFailure(code);
  return jsonError(failure.code, failure.message, failure.httpStatus);
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
      return acceptanceErrorResponse(
        classifyStudentPortalInvitationAcceptanceError(error),
      );
    }

    const resultError = classifyStudentPortalInvitationAcceptanceResult(data);

    if (resultError) {
      return acceptanceErrorResponse(resultError);
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
