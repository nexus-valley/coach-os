import { logActivity } from "@/src/lib/auditLogger";
import { createNotificationForTenantRoles } from "@/src/lib/notifications";
import { requireTenantPermission, type MemberRole } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  enforceWorkspaceLimit,
  refreshWorkspaceUsageSnapshot,
} from "@/src/lib/usage";

export type InvitationRole = Exclude<MemberRole, "owner">;
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type TeamInvitation = {
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
  email: string;
  expires_at: string;
  id: string;
  invited_by: string | null;
  revoked_at: string | null;
  role: InvitationRole;
  status: InvitationStatus;
  tenant_id: string;
  token: string;
  updated_at: string;
};

export type TeamInvitationEmailResult = {
  delivered: boolean;
  email: string;
  invitationId: string;
  provider: "none" | "resend";
};

export type TeamInvitationPreview = Pick<
  TeamInvitation,
  "accepted_at" | "created_at" | "email" | "expires_at" | "id" | "revoked_at" | "role" | "status" | "tenant_id"
> & {
  tenant_name: string;
};

const invitationColumns =
  "id,tenant_id,email,role,token,status,invited_by,accepted_by,expires_at,accepted_at,revoked_at,created_at,updated_at";

const invitationRoles: InvitationRole[] = ["admin", "staff", "trainer"];

type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

function getRawTeamInvitationErrorMessage(caught: unknown) {
  if (caught instanceof Error && caught.message) {
    return caught.message;
  }

  if (caught && typeof caught === "object") {
    const error = caught as SupabaseErrorLike;

    return error.message || error.details || error.hint || "";
  }

  return "";
}

function isKnownSafeTeamInvitationMessage(normalizedMessage: string) {
  return (
    normalizedMessage.includes("pending invitation already exists") ||
    normalizedMessage.includes("sign in again") ||
    normalizedMessage.includes("permission to invite team members") ||
    normalizedMessage.includes("invitation has expired") ||
    normalizedMessage.includes("invitation is no longer pending") ||
    normalizedMessage.includes("invitation could not be found") ||
    normalizedMessage.includes("invited email address")
  );
}

export function getTeamInvitationErrorMessage(
  caught: unknown,
  fallback: string,
) {
  const rawMessage = getRawTeamInvitationErrorMessage(caught);
  const normalizedMessage = rawMessage.toLowerCase();

  if (!rawMessage) {
    return fallback;
  }

  if (normalizedMessage.includes("canonical subscription assignment")) {
    return "Team invites require an active workspace plan before team-seat limits can be enforced. Ask support to confirm the workspace subscription setup, then try again.";
  }

  if (
    normalizedMessage.includes("canonical team limit is not configured") ||
    normalizedMessage.includes("canonical entity limit is not configured")
  ) {
    return "Team invite limits are not configured for this workspace plan. Ask support to confirm the team-seat limits before inviting teammates.";
  }

  if (normalizedMessage.includes("only owners and admins can invite")) {
    return "Only workspace owners and admins can invite team members.";
  }

  if (
    normalizedMessage.includes("canonical team usage limit exceeded") ||
    normalizedMessage.includes("canonical entity usage limit exceeded") ||
    normalizedMessage.includes("team_members") ||
    normalizedMessage.includes("staff_trainers") ||
    normalizedMessage.includes("admins")
  ) {
    return "This workspace has reached the team-seat limit for that role. Remove an unused pending invite or ask support to adjust the workspace plan before inviting another teammate.";
  }

  if (normalizedMessage.includes("valid invitation role")) {
    return "Select a valid team role.";
  }

  if (normalizedMessage.includes("valid email")) {
    return "Enter a valid teammate email address.";
  }

  if (isKnownSafeTeamInvitationMessage(normalizedMessage)) {
    return rawMessage;
  }

  return fallback;
}

export function logTeamInvitationError(context: string, caught: unknown) {
  const error = caught as SupabaseErrorLike;

  console.error(`[CoachFort invitations] ${context}`, {
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    message: error?.message,
    raw: caught,
  });
}

function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

function assertInvitationRole(role: InvitationRole) {
  if (!invitationRoles.includes(role)) {
    throw new Error("Select a valid team role.");
  }
}

function getInvitationStatus(invitation: TeamInvitation): InvitationStatus {
  if (
    invitation.status === "pending" &&
    new Date(invitation.expires_at).getTime() <= Date.now()
  ) {
    return "expired";
  }

  return invitation.status;
}

async function notifyInvitationEvent(params: {
  actionUrl?: string;
  invitationEmail?: string;
  message: string;
  role?: InvitationRole;
  severity?: "info" | "warning";
  tenantId: string;
  title: string;
}) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: params.actionUrl ?? "/app/settings",
      entityType: "team_invitation",
      message: params.message,
      metadata: {
        role: params.role,
      },
      roles: ["owner", "admin"],
      severity: params.severity ?? "info",
      tenantId: params.tenantId,
      title: params.title,
      type: "invitation_notice",
    });
  } catch {
    // Notifications are non-blocking for invitation workflows.
  }
}

export function buildInvitationLink(token: string, baseUrl?: string) {
  const origin =
    baseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "");

  return origin ? `${origin}/invite/${token}` : `/invite/${token}`;
}

export async function sendTeamInvitationEmail(invitationId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!session?.access_token) {
    throw new Error("Sign in again to send the invitation email.");
  }

  const response = await fetch("/api/team-invitations/send-email", {
    body: JSON.stringify({ invitationId }),
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | Partial<TeamInvitationEmailResult & { message: string }>
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? "Unable to send invitation email.");
  }

  return {
    delivered: payload?.delivered === true,
    email: String(payload?.email ?? ""),
    invitationId: String(payload?.invitationId ?? invitationId),
    provider: payload?.provider === "resend" ? "resend" : "none",
  } satisfies TeamInvitationEmailResult;
}

export async function createTeamInvitation(params: {
  email: string;
  role: InvitationRole;
  tenantId: string;
}) {
  assertInvitationRole(params.role);

  const email = normalizeInviteEmail(params.email);

  if (!email) {
    throw new Error("Invite email is required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  await requireTenantPermission({
    description: "Blocked team invitation creation without invite permission.",
    permission: "invite_team",
    tenantId: params.tenantId,
  });
  const supabase = getSupabaseClient();
  const { data: existingInvitation, error: existingError } = await supabase
    .from("team_invitations")
    .select(invitationColumns)
    .eq("tenant_id", params.tenantId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingInvitation) {
    return existingInvitation as TeamInvitation;
  }

  await enforceWorkspaceLimit(params.tenantId, "team_members", {
    includePendingInvitations: true,
  });

  if (params.role === "trainer") {
    await enforceWorkspaceLimit(params.tenantId, "trainers", {
      includePendingInvitations: true,
      trainerOnly: true,
    });
  }

  const { data, error } = await supabase
    .rpc("create_team_invitation_secure", {
      p_email: email,
      p_role: params.role,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A pending invitation already exists for this email.");
    }

    throw error;
  }

  const invitation = data as TeamInvitation;

  await notifyInvitationEvent({
    invitationEmail: invitation.email,
    message: `${invitation.email} was invited as ${invitation.role}.`,
    role: invitation.role,
    tenantId: invitation.tenant_id,
    title: "Team invitation sent",
  });

  return invitation;
}

export async function listTeamInvitations(tenantId: string) {
  await requireTenantPermission({
    description: "Blocked team invitation list without invite permission.",
    permission: "invite_team",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .select(invitationColumns)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as TeamInvitation[]).map((invitation) => ({
    ...invitation,
    status: getInvitationStatus(invitation),
  }));
}

export async function revokeTeamInvitation(invitationId: string) {
  const supabase = getSupabaseClient();
  const { data: existingInvitation, error: existingError } = await supabase
    .from("team_invitations")
    .select(invitationColumns)
    .eq("id", invitationId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existingInvitation) {
    throw new Error("Invitation not found.");
  }

  const invitation = existingInvitation as TeamInvitation;
  await requireTenantPermission({
    description: "Blocked team invitation revoke without invite permission.",
    permission: "invite_team",
    tenantId: invitation.tenant_id,
  });

  if (getInvitationStatus(invitation) !== "pending") {
    throw new Error("Only pending invitations can be revoked.");
  }

  const { data, error } = await supabase
    .rpc("cancel_team_invitation_secure", {
      p_invitation_id: invitation.id,
    })
    .single();

  if (error) {
    throw error;
  }

  const revokedInvitation = data as TeamInvitation;

  await notifyInvitationEvent({
    invitationEmail: revokedInvitation.email,
    message: `Invitation revoked for ${revokedInvitation.email}.`,
    role: revokedInvitation.role,
    severity: "warning",
    tenantId: revokedInvitation.tenant_id,
    title: "Team invitation revoked",
  });

  return revokedInvitation;
}

export async function resendTeamInvitation(invitationId: string) {
  const supabase = getSupabaseClient();
  const { data: existingInvitation, error: existingError } = await supabase
    .from("team_invitations")
    .select(invitationColumns)
    .eq("id", invitationId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existingInvitation) {
    throw new Error("Invitation not found.");
  }

  const invitation = existingInvitation as TeamInvitation;
  await requireTenantPermission({
    description: "Blocked team invitation resend without invite permission.",
    permission: "invite_team",
    tenantId: invitation.tenant_id,
  });

  if (invitation.status === "accepted" || invitation.status === "revoked") {
    throw new Error("Accepted or revoked invitations cannot be resent.");
  }

  const { data, error } = await supabase
    .rpc("resend_team_invitation_secure", {
      p_invitation_id: invitation.id,
    })
    .single();

  if (error) {
    throw error;
  }

  const resentInvitation = data as TeamInvitation;

  await notifyInvitationEvent({
    invitationEmail: resentInvitation.email,
    message: `Invitation link refreshed for ${resentInvitation.email}.`,
    role: resentInvitation.role,
    tenantId: resentInvitation.tenant_id,
    title: "Team invitation resent",
  });

  return resentInvitation;
}

export async function getInvitationByToken(token: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("get_team_invitation_by_token", { invite_token: token })
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as TeamInvitationPreview | null) ?? null;
}

export async function acceptTeamInvitation(token: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("accept_team_invitation", {
    invite_token: token,
  });

  if (error) {
    logTeamInvitationError("accept_team_invitation RPC failed", error);
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    throw new Error("Invitation acceptance did not return a workspace.");
  }

  const rawResult = row as {
    accepted_role?: InvitationRole;
    accepted_tenant_id?: string;
    role?: InvitationRole;
    tenant_id?: string;
  };
  const result = {
    role: rawResult.accepted_role ?? rawResult.role,
    tenant_id: rawResult.accepted_tenant_id ?? rawResult.tenant_id,
  };

  if (!result.tenant_id || !result.role) {
    console.error("[CoachFort invitations] Unexpected accept RPC response", {
      raw: data,
    });
    throw new Error("Invitation acceptance returned an invalid response.");
  }

  await logActivity({
    action: "invitation_accepted",
    description: `Accepted team invitation as ${result.role}`,
    entityName: result.role,
    entityType: "team_invitation",
    metadata: { role: result.role },
    tenantId: result.tenant_id,
  });
  await notifyInvitationEvent({
    message: `Invitation accepted as ${result.role}.`,
    role: result.role,
    tenantId: result.tenant_id,
    title: "Team invitation accepted",
  });
  await refreshWorkspaceUsageSnapshot(result.tenant_id);

  return result;
}
