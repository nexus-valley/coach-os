import { createHash, randomBytes } from "node:crypto";

import { sendCoachFortTransactionalEmail } from "@/src/lib/server/email";
import { buildStudentPortalInviteEmail } from "@/src/lib/server/emailTemplates";
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
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createStudentPortalInvitationErrorPayload,
  getSafePostgrestCode,
  type StudentPortalInvitationSendErrorCode,
} from "@/src/lib/studentPortalInvitationDiagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const invitationLifetimeDays = 7;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InvitationSummary = {
  can_resend: boolean;
  status: string;
};

type PreparedInvitation = {
  access_status: string;
  expires_at: string | null;
  invitation_id: string | null;
  reused: boolean;
  status: string;
  token_ready: boolean;
};

function captureInvitationSendDiagnostic(params: {
  errorCode: StudentPortalInvitationSendErrorCode;
  httpStatus: number;
  operation: string;
  providerError?: unknown;
}) {
  const safeProviderCode = getSafePostgrestCode(params.providerError);

  captureServerException(new Error(params.errorCode), {
    errorCategory: params.errorCode,
    httpStatus: params.httpStatus,
    operation: params.operation,
    providerCode: safeProviderCode,
    route: "/api/student-portal-invitations/send",
  });

  return safeProviderCode;
}

function jsonError(
  message: string,
  status = 400,
  errorCode: StudentPortalInvitationSendErrorCode = "invalid_request",
  providerError?: unknown,
) {
  return Response.json(
    createStudentPortalInvitationErrorPayload({
      errorCode,
      message,
      providerError,
    }),
    { status },
  );
}

function getInviteOrigin(request: Request) {
  const configuredOrigin =
    process.env.COACHFORT_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const origin = configuredOrigin || new URL(request.url).origin;

  try {
    const parsed = new URL(origin);

    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Invitation origin must use HTTPS.");
    }

    return parsed.origin;
  } catch {
    throw new Error("Student invitation delivery is not configured.");
  }
}

function buildInviteUrl(request: Request, rawToken: string) {
  return `${getInviteOrigin(request)}/invite/student#token=${encodeURIComponent(rawToken)}`;
}

function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

function hashInvitationToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function invitationExpiry() {
  return new Date(
    Date.now() + invitationLifetimeDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<{
      enrollmentRequestId?: unknown;
      tenantId?: unknown;
    }>(request);
    const enrollmentRequestId =
      typeof body.enrollmentRequestId === "string"
        ? body.enrollmentRequestId.trim()
        : "";
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

    if (!uuidPattern.test(enrollmentRequestId) || !uuidPattern.test(tenantId)) {
      return jsonError(
        "The enrollment request could not be verified.",
        400,
        "invalid_request",
      );
    }

    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const userScopedSupabase = getUserScopedSupabase(accessToken);
    const roleCheck = await userScopedSupabase.rpc("has_tenant_role", {
      allowed_roles: ["owner", "admin"],
      check_tenant_id: tenantId,
      check_user_id: user.id,
    });

    if (roleCheck.error || roleCheck.data !== true) {
      return jsonError(
        "Only workspace owners and admins can send portal invitations.",
        403,
        "forbidden",
      );
    }

    let admin: ReturnType<typeof getSupabaseAdminClient>;

    try {
      admin = getSupabaseAdminClient();
    } catch {
      captureInvitationSendDiagnostic({
        errorCode: "server_admin_not_configured",
        httpStatus: 500,
        operation: "student_portal_invitation_admin_init",
      });
      return jsonError(
        "Portal invitation delivery needs attention. Enrollment is unchanged.",
        500,
        "server_admin_not_configured",
      );
    }

    const requestResult = await admin
      .from("public_site_leads")
      .select(
        "id,tenant_id,enrollment_request_status,converted_student_id,converted_enrollment_id,interested_course_id",
      )
      .eq("id", enrollmentRequestId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (requestResult.error || !requestResult.data) {
      return jsonError("Enrolled request not found.", 404, "invalid_request");
    }

    const enrollmentRequest = requestResult.data;

    if (
      enrollmentRequest.enrollment_request_status !== "enrolled" ||
      !enrollmentRequest.converted_student_id ||
      !enrollmentRequest.converted_enrollment_id
    ) {
      return jsonError(
        "Complete enrollment before sending a portal invitation.",
        409,
        "invitation_not_sendable",
      );
    }

    const [studentResult, enrollmentResult, tenantResult] = await Promise.all([
      admin
        .from("students")
        .select("id,tenant_id,full_name,email,status,portal_enabled")
        .eq("id", enrollmentRequest.converted_student_id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("enrollments")
        .select("id,tenant_id,student_id,course_id,status")
        .eq("id", enrollmentRequest.converted_enrollment_id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    ]);

    const student = studentResult.data;
    const enrollment = enrollmentResult.data;

    if (
      studentResult.error ||
      !student ||
      student.status !== "active" ||
      student.portal_enabled !== true
    ) {
      return jsonError(
        "Student portal access needs attention before inviting.",
        409,
        "invitation_not_sendable",
      );
    }

    const normalizedEmail =
      typeof student.email === "string" ? student.email.trim().toLowerCase() : "";

    if (!normalizedEmail) {
      return jsonError(
        "Add a valid student email before sending an invitation.",
        409,
        "invitation_not_sendable",
      );
    }

    if (
      enrollmentResult.error ||
      !enrollment ||
      enrollment.student_id !== student.id ||
      enrollment.course_id !== enrollmentRequest.interested_course_id ||
      (enrollment.status !== "active" && enrollment.status !== "completed")
    ) {
      return jsonError(
        "Student enrollment needs attention before inviting.",
        409,
        "invitation_not_sendable",
      );
    }

    const summaryResult = await userScopedSupabase.rpc(
      "get_student_portal_invitation_status",
      {
        p_student_id: student.id,
        p_tenant_id: tenantId,
      },
    );

    if (summaryResult.error || !summaryResult.data) {
      return jsonError(
        "Unable to verify portal invitation status.",
        409,
        "invitation_not_sendable",
      );
    }

    const summary = summaryResult.data as InvitationSummary;

    if (summary.status === "access_active") {
      return Response.json({
        message: "Portal access is already active.",
        status: "access_active",
      });
    }

    if (
      summary.status === "invitation_pending" ||
      summary.status === "invitation_sent"
    ) {
      return Response.json({
        message:
          summary.status === "invitation_sent"
            ? "A valid portal invitation has already been sent."
            : "A portal invitation is already being prepared.",
        status: summary.status,
      });
    }

    if (summary.status === "needs_attention" && !summary.can_resend) {
      return jsonError(
        "Portal access needs support review before another invitation.",
        409,
        "invitation_not_sendable",
      );
    }

    const rawToken = createInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = invitationExpiry();
    const prepareResult = await admin.rpc(
      "prepare_student_portal_invitation_secure",
      {
        p_enrollment_id: enrollment.id,
        p_enrollment_request_id: enrollmentRequest.id,
        p_expires_at: expiresAt,
        p_invited_email: normalizedEmail,
        p_student_id: student.id,
        p_tenant_id: tenantId,
        p_token_hash: tokenHash,
      },
    );

    if (prepareResult.error || !prepareResult.data) {
      const safeProviderCode = captureInvitationSendDiagnostic({
        errorCode: "invitation_prepare_failed",
        httpStatus: 409,
        operation: "student_portal_invitation_prepare",
        providerError: prepareResult.error,
      });
      return jsonError(
        "Unable to prepare the portal invitation right now.",
        409,
        "invitation_prepare_failed",
        safeProviderCode,
      );
    }

    const prepared = prepareResult.data as PreparedInvitation;

    if (prepared.access_status === "access_active") {
      return Response.json({
        message: "Portal access is already active.",
        status: "access_active",
      });
    }

    if (prepared.token_ready !== true) {
      if (prepared.access_status === "invitation_sent") {
        return Response.json({
          message: "A valid portal invitation has already been sent.",
          status: "invitation_sent",
        });
      }

      if (prepared.access_status === "invitation_pending") {
        return Response.json({
          message: "A portal invitation is already being prepared.",
          status: "invitation_pending",
        });
      }

      return jsonError(
        "Portal access needs support review before inviting.",
        409,
        "invitation_not_sendable",
      );
    }

    if (
      prepared.access_status !== "invitation_pending" ||
      !prepared.invitation_id ||
      !prepared.expires_at
    ) {
      return jsonError(
        "Portal access needs support review before inviting.",
        409,
        "invitation_not_sendable",
      );
    }

    let delivered = false;
    let emailFailureCode: Extract<
      StudentPortalInvitationSendErrorCode,
      "email_delivery_failed" | "email_not_configured"
    > = "email_delivery_failed";

    try {
      const emailResult = await sendCoachFortTransactionalEmail({
        email: normalizedEmail,
        failureMessage: "Unable to send student portal invitation.",
        logContext: {
          invitationId: prepared.invitation_id,
          template: "student.portal_invite",
          tenantId,
        },
        template: buildStudentPortalInviteEmail({
          expiresAt: prepared.expires_at,
          inviteUrl: buildInviteUrl(request, rawToken),
          studentName: student.full_name,
          tenantName:
            typeof tenantResult.data?.name === "string"
              ? tenantResult.data.name
              : null,
        }),
      });
      delivered = emailResult.delivered;
      if (!delivered && emailResult.provider === "none") {
        emailFailureCode = "email_not_configured";
        captureInvitationSendDiagnostic({
          errorCode: emailFailureCode,
          httpStatus: 502,
          operation: "student_portal_invitation_email",
        });
      }
    } catch (caught) {
      delivered = false;
      captureInvitationSendDiagnostic({
        errorCode: emailFailureCode,
        httpStatus: 502,
        operation: "student_portal_invitation_email",
        providerError: caught,
      });
    }

    const deliveryResult = await admin.rpc(
      "record_student_portal_invitation_delivery_secure",
      {
        p_delivery_result: delivered ? "sent" : "failed",
        p_error_code: delivered ? null : "delivery_failed",
        p_invitation_id: prepared.invitation_id,
      },
    );

    if (deliveryResult.error) {
      const safeProviderCode = captureInvitationSendDiagnostic({
        errorCode: "invitation_delivery_record_failed",
        httpStatus: 500,
        operation: "student_portal_invitation_delivery_record",
        providerError: deliveryResult.error,
      });
      return jsonError(
        "Invitation delivery needs attention. Enrollment is unchanged.",
        500,
        "invitation_delivery_record_failed",
        safeProviderCode,
      );
    }

    if (!delivered) {
      return jsonError(
        "The student is enrolled, but the invitation could not be delivered. You can retry safely.",
        502,
        emailFailureCode,
      );
    }

    return Response.json({
      message: "Portal invitation sent.",
      status: "invitation_sent",
    });
  } catch (caught) {
    if (caught instanceof InvalidJsonPayloadError) {
      return jsonError(caught.message, 400, "invalid_request");
    }

    if (caught instanceof Error && caught.message === "Authentication required.") {
      return jsonError("Please sign in again to continue.", 401, "unauthorized");
    }

    captureInvitationSendDiagnostic({
      errorCode: "invitation_not_sendable",
      httpStatus: 500,
      operation: "student_portal_invitation_send_unexpected",
      providerError: caught,
    });
    return jsonError(
      "Unable to send the portal invitation right now.",
      500,
      "invitation_not_sendable",
    );
  }
}
