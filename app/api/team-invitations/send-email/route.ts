import { buildTeamInviteEmail } from "@/src/lib/server/emailTemplates";
import { sendCoachFortTransactionalEmail } from "@/src/lib/server/email";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  getBearerToken,
  getUserScopedSupabase,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InvitationRole = "admin" | "staff" | "trainer";

type InvitationEmailRow = {
  email: string;
  expires_at: string;
  id: string;
  role: InvitationRole;
  status: string;
  tenant_id: string;
  token: string;
};

function jsonError(message: string, status = 400) {
  return Response.json({ message }, { status });
}

function getInviteOrigin(request: Request) {
  const configuredOrigin =
    process.env.COACHFORT_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/g, "");
  }

  return new URL(request.url).origin.replace(/\/+$/g, "");
}

function buildInviteUrl(request: Request, token: string) {
  return `${getInviteOrigin(request)}/invite/${encodeURIComponent(token)}`;
}

function isInvitationRole(value: string): value is InvitationRole {
  return value === "admin" || value === "staff" || value === "trainer";
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<{ invitationId?: unknown }>(request);
    const invitationId =
      typeof body.invitationId === "string" ? body.invitationId.trim() : "";

    if (!invitationId) {
      return jsonError("Invitation id is required.");
    }

    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const supabase = getUserScopedSupabase(accessToken);
    const { data, error } = await supabase
      .from("team_invitations")
      .select("id,tenant_id,email,role,token,status,expires_at")
      .eq("id", invitationId)
      .maybeSingle();

    if (error) {
      return jsonError(error.message, 403);
    }

    if (!data) {
      return jsonError("Invitation not found.", 404);
    }

    const invitation = data as InvitationEmailRow;

    if (invitation.status !== "pending") {
      return jsonError("Only pending invitations can be emailed.");
    }

    if (!isInvitationRole(invitation.role)) {
      return jsonError("Invitation role is not supported.");
    }

    const roleCheck = await supabase.rpc("has_tenant_role", {
      allowed_roles: ["owner", "admin"],
      check_tenant_id: invitation.tenant_id,
      check_user_id: user.id,
    });

    if (roleCheck.error) {
      return jsonError(roleCheck.error.message, 403);
    }

    if (roleCheck.data !== true) {
      return jsonError("Only workspace owners and admins can email invites.", 403);
    }

    const tenantResult = await supabase
      .from("tenants")
      .select("name")
      .eq("id", invitation.tenant_id)
      .maybeSingle();
    const tenantName =
      typeof tenantResult.data?.name === "string" ? tenantResult.data.name : null;
    const result = await sendCoachFortTransactionalEmail({
      email: invitation.email,
      failureMessage: "Unable to send team invitation email.",
      logContext: {
        invitationId: invitation.id,
        tenantId: invitation.tenant_id,
        template: "team_invite",
      },
      template: buildTeamInviteEmail({
        expiresAt: invitation.expires_at,
        inviteUrl: buildInviteUrl(request, invitation.token),
        recipientEmail: invitation.email,
        role: invitation.role,
        tenantName,
      }),
    });

    return Response.json({
      delivered: result.delivered,
      email: invitation.email,
      invitationId: invitation.id,
      provider: result.provider,
    });
  } catch (caught) {
    if (caught instanceof InvalidJsonPayloadError) {
      return jsonError(caught.message);
    }

    const message =
      caught instanceof Error
        ? caught.message
        : "Unable to send team invitation email.";

    if (message === "Authentication required.") {
      return jsonError(message, 401);
    }

    captureServerException(caught, {
      operation: "team_invitation_send_email",
      route: "/api/team-invitations/send-email",
    });

    return jsonError(message, 500);
  }
}
