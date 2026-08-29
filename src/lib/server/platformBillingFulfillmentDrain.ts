import { timingSafeEqual } from "node:crypto";

import { captureServerException } from "@/src/lib/server/monitoring";
import { drainPlatformBillingDocumentFulfillments } from "@/src/lib/server/platformBillingFulfillment";

type DrainFunction = typeof drainPlatformBillingDocumentFulfillments;

function hasMatchingBearerSecret(
  request: Request,
  configuredSecret: string | undefined,
) {
  const configured = configuredSecret?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const supplied = match?.[1] ?? "";

  if (configured.length < 32 || supplied.length !== configured.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(configured, "utf8"),
    Buffer.from(supplied, "utf8"),
  );
}

export async function handlePlatformBillingFulfillmentDrainRequest(
  request: Request,
  options?: {
    configuredSecret?: string;
    drain?: DrainFunction;
  },
) {
  if (!hasMatchingBearerSecret(request, options?.configuredSecret)) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  try {
    const result = await (options?.drain ??
      drainPlatformBillingDocumentFulfillments)();
    return Response.json(result);
  } catch (error) {
    captureServerException(error, {
      operation: "platform_billing_fulfillment_drain",
      route: "/api/internal/platform-billing/fulfillment/drain",
    });
    return Response.json(
      { message: "Billing document processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
