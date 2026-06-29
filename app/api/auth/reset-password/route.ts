import { NextResponse } from "next/server";

import {
  normalizeEmail,
  resetPasswordWithToken,
} from "@/src/lib/server/authOtp";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<{
      email?: unknown;
      newPassword?: unknown;
      resetToken?: unknown;
    }>(request);
    const email = normalizeEmail(body.email);
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    const resetToken =
      typeof body.resetToken === "string" ? body.resetToken : "";

    if (!resetToken) {
      throw new Error("Password reset verification is required.");
    }

    const result = await resetPasswordWithToken({
      email,
      newPassword,
      resetToken,
    });

    return NextResponse.json(result);
  } catch (caught) {
    if (caught instanceof InvalidJsonPayloadError) {
      return NextResponse.json({ message: caught.message }, { status: 400 });
    }

    const message =
      caught instanceof Error
        ? caught.message
        : "Unable to reset password.";

    if (
      caught instanceof Error &&
      !/password|verification|email|token|expired|invalid/i.test(caught.message)
    ) {
      captureServerException(caught, {
        operation: "auth_reset_password",
        route: "/api/auth/reset-password",
      });
    }

    return NextResponse.json({ message }, { status: 400 });
  }
}
