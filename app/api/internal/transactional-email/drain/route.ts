import { timingSafeEqual } from "node:crypto";

import { captureServerException } from "@/src/lib/server/monitoring";
import { drainTransactionalEmailOutbox } from "@/src/lib/server/transactionalEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function matchesWorkerSecret(request: Request) {
  const configured = process.env.COACHFORT_EMAIL_WORKER_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!configured || !supplied) {
    return false;
  }

  const configuredBuffer = Buffer.from(configured, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return (
    configuredBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(configuredBuffer, suppliedBuffer)
  );
}

export async function POST(request: Request) {
  if (!matchesWorkerSecret(request)) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  try {
    const result = await drainTransactionalEmailOutbox();
    return Response.json(result);
  } catch (error) {
    captureServerException(error, {
      operation: "transactional_email_drain",
      route: "/api/internal/transactional-email/drain",
    });
    return Response.json(
      { message: "Transactional email processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
