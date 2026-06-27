import { NextResponse } from "next/server";

import {
  normalizeEmail,
  resetPasswordWithToken,
} from "@/src/lib/server/authOtp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      newPassword?: unknown;
      resetToken?: unknown;
    };
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
    const message =
      caught instanceof Error
        ? caught.message
        : "Unable to reset password.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
