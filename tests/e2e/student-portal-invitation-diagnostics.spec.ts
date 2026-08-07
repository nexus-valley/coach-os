import { expect, test } from "@playwright/test";

import {
  createStudentPortalInvitationErrorPayload,
  getSafePostgrestCode,
  StudentPortalInvitationActionError,
} from "../../src/lib/studentPortalInvitationDiagnostics";

test.describe("student portal invitation diagnostics", () => {
  test("retains only allowlisted Postgres and PostgREST codes", () => {
    expect(getSafePostgrestCode({ code: "42501" })).toBe("42501");
    expect(getSafePostgrestCode({ code: "pgrst202" })).toBe("PGRST202");
    expect(getSafePostgrestCode({ code: "22023" })).toBe("22023");
    expect(getSafePostgrestCode({ code: "42501: private detail" })).toBeNull();
    expect(getSafePostgrestCode({ code: "not-safe" })).toBeNull();
    expect(getSafePostgrestCode({ message: "private provider message" })).toBeNull();
  });

  test("builds a category-only prepare failure payload", () => {
    const payload = createStudentPortalInvitationErrorPayload({
      errorCode: "invitation_prepare_failed",
      message: "Unable to prepare the portal invitation right now.",
      providerError: {
        code: "42501",
        details: "raw-token-value",
        hint: "digest-value",
        message: "private database response",
      },
    });
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      error_code: "invitation_prepare_failed",
      message: "Unable to prepare the portal invitation right now.",
      safe_provider_code: "42501",
      status: "needs_attention",
    });
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("digest-value");
    expect(serialized).not.toContain("private database response");
  });

  test("preserves safe diagnostics without changing the coach message", () => {
    const error = new StudentPortalInvitationActionError({
      errorCode: "server_admin_not_configured",
      message: "Portal invitation delivery needs attention. Enrollment is unchanged.",
      safeProviderCode: "PGRST202",
    });

    expect(error.message).toBe(
      "Portal invitation delivery needs attention. Enrollment is unchanged.",
    );
    expect(error.errorCode).toBe("server_admin_not_configured");
    expect(error.safeProviderCode).toBe("PGRST202");
  });

  test("discards unapproved client diagnostic values", () => {
    const error = new StudentPortalInvitationActionError({
      errorCode: "database_message_with_private_data",
      message: "Invitation needs retry.",
      safeProviderCode: "private-detail",
    });

    expect(error.errorCode).toBeNull();
    expect(error.safeProviderCode).toBeNull();
  });
});
