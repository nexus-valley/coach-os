import { NextResponse } from "next/server";

import {
  normalizeEmail,
  normalizePurpose,
  verifyOtp,
} from "@/src/lib/server/authOtp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      otp?: unknown;
      purpose?: unknown;
    };
    const email = normalizeEmail(body.email);
    const purpose = normalizePurpose(body.purpose);
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";
    const result = await verifyOtp({
      email,
      otp,
      purpose,
    });

    return NextResponse.json(result);
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unable to verify code.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
