import { NextResponse } from "next/server";

import {
  normalizeEmail,
  normalizePurpose,
  requestOtp,
} from "@/src/lib/server/authOtp";

export const runtime = "nodejs";

function getStatusForError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("wait before requesting")) {
    return 429;
  }

  if (message.includes("valid email") || message.includes("Unsupported")) {
    return 400;
  }

  return 500;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      purpose?: unknown;
    };
    const email = normalizeEmail(body.email);
    const purpose = normalizePurpose(body.purpose);
    const result = await requestOtp({
      email,
      purpose,
      request,
    });

    return NextResponse.json(result);
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Unable to request verification code.";

    return NextResponse.json(
      { message },
      { status: getStatusForError(caught) },
    );
  }
}
