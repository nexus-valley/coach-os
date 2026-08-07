import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type StudentPortalInvitationStatus =
  | "access_active"
  | "invitation_expired"
  | "invitation_not_sent"
  | "invitation_pending"
  | "invitation_sent"
  | "needs_attention";

export type StudentPortalInvitationSummary = {
  accepted_at: string | null;
  attempt_count: number;
  can_resend: boolean;
  expires_at: string | null;
  sent_at: string | null;
  status: StudentPortalInvitationStatus;
};

export type StudentPortalInvitationActionResult = {
  message: string;
  status: StudentPortalInvitationStatus;
};

async function getAccessToken() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Please sign in again to continue.");
  }

  return data.session.access_token;
}

export async function getStudentPortalInvitationStatus(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_student_portal_invitation_status",
    {
      p_student_id: params.studentId,
      p_tenant_id: params.tenantId,
    },
  );

  if (error) {
    throw new Error("Unable to load portal invitation status.");
  }

  if (!data || typeof data !== "object" || !("status" in data)) {
    throw new Error("Unable to load portal invitation status.");
  }

  return data as StudentPortalInvitationSummary;
}

export async function sendStudentPortalInvitation(params: {
  enrollmentRequestId: string;
  tenantId: string;
}) {
  const accessToken = await getAccessToken();
  let response: Response;

  try {
    response = await fetch("/api/student-portal-invitations/send", {
      body: JSON.stringify({
        enrollmentRequestId: params.enrollmentRequestId,
        tenantId: params.tenantId,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new Error("Unable to send the portal invitation right now.");
  }

  const result = (await response.json().catch(() => ({}))) as Partial<
    StudentPortalInvitationActionResult
  >;

  if (!response.ok || !result.status || !result.message) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Unable to send the portal invitation right now.",
    );
  }

  return result as StudentPortalInvitationActionResult;
}

export async function acceptStudentPortalInvitation(rawToken: string) {
  const accessToken = await getAccessToken();
  let response: Response;

  try {
    response = await fetch("/api/student-portal-invitations/accept", {
      body: JSON.stringify({ token: rawToken }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new Error("Unable to activate portal access right now.");
  }

  const result = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    status?: StudentPortalInvitationStatus;
  };

  if (!response.ok || result.status !== "access_active") {
    const error = new Error(
      result.message || "Unable to activate portal access right now.",
    );
    error.name = result.code || "invitation_error";
    throw error;
  }

  return result as StudentPortalInvitationActionResult;
}

export function getStudentPortalInvitationError(
  caught: unknown,
  fallback = "Unable to continue with this portal invitation.",
) {
  const message = caught instanceof Error ? caught.message : "";

  if (
    message.startsWith("Please sign in") ||
    message.startsWith("This invitation") ||
    message.startsWith("Portal access") ||
    message.startsWith("Unable to activate")
  ) {
    return message;
  }

  return fallback;
}
