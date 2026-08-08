import { expect, test } from "@playwright/test";

import {
  classifyStudentPortalInvitationAcceptanceError,
  classifyStudentPortalInvitationAcceptanceResult,
  getStudentPortalInvitationAcceptanceFailure,
  shouldClearStudentPortalInvitationToken,
} from "../../src/lib/studentPortalInvitationAcceptance";

test.describe("student portal invitation acceptance safety", () => {
  test("classifies only the exact wrong-identity RPC error as email mismatch", () => {
    const code = classifyStudentPortalInvitationAcceptanceError({
      code: "42501",
      details: "private provider detail",
      hint: "private provider hint",
      message: "Sign in with the email address that received this invitation.",
    });
    const failure = getStudentPortalInvitationAcceptanceFailure(code);
    const serialized = JSON.stringify(failure);

    expect(failure).toEqual({
      code: "email_mismatch",
      httpStatus: 409,
      message:
        "This invitation was sent to a different email address. Continue with the email address that received it.",
    });
    expect(serialized).not.toContain("private provider detail");
    expect(serialized).not.toContain("private provider hint");
  });

  test("fails closed for unrelated authorization and data errors", () => {
    expect(
      classifyStudentPortalInvitationAcceptanceError({
        code: "42501",
        message: "Student portal access is linked to another identity.",
      }),
    ).toBe("needs_attention");
    expect(
      classifyStudentPortalInvitationAcceptanceError({
        code: "42501",
        message: "Student email no longer matches this invitation.",
      }),
    ).toBe("needs_attention");
    expect(
      classifyStudentPortalInvitationAcceptanceError({
        code: "22023",
        message: "Unrelated internal failure.",
      }),
    ).toBe("needs_attention");
  });

  test("preserves correct acceptance and classifies terminal results", () => {
    expect(
      classifyStudentPortalInvitationAcceptanceResult({
        access_status: "access_active",
        status: "accepted",
      }),
    ).toBeNull();
    expect(
      classifyStudentPortalInvitationAcceptanceResult({
        access_status: "invitation_expired",
        status: "expired",
      }),
    ).toBe("invitation_expired");
    expect(
      classifyStudentPortalInvitationAcceptanceResult({
        access_status: "needs_attention",
        status: "revoked",
      }),
    ).toBe("invitation_unavailable");
    expect(
      classifyStudentPortalInvitationAcceptanceResult({
        access_status: "needs_attention",
        status: "sent",
      }),
    ).toBe("needs_attention");
  });

  test("retains recoverable tokens and clears terminal invitation tokens", () => {
    expect(shouldClearStudentPortalInvitationToken("email_mismatch")).toBe(false);
    expect(shouldClearStudentPortalInvitationToken("needs_attention")).toBe(false);
    expect(shouldClearStudentPortalInvitationToken("authentication_required")).toBe(
      false,
    );
    expect(shouldClearStudentPortalInvitationToken("invitation_expired")).toBe(
      true,
    );
    expect(
      shouldClearStudentPortalInvitationToken("invitation_unavailable"),
    ).toBe(true);
  });
});
