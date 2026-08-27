import { timingSafeEqual } from "node:crypto";

import { captureServerException } from "@/src/lib/server/monitoring";
import { drainTransactionalEmailOutbox } from "@/src/lib/server/transactionalEmail";

type DrainOperation =
  | "transactional_email_cron_drain"
  | "transactional_email_drain";

type DrainFunction = typeof drainTransactionalEmailOutbox;

type TransactionalEmailDrainRequestOptions = {
  configuredSecret: string | undefined;
  drain?: DrainFunction;
  minimumSecretLength?: number;
  operation: DrainOperation;
};

function hasMatchingBearerSecret(
  request: Request,
  configuredSecret: string | undefined,
  minimumSecretLength: number,
) {
  const configured = configuredSecret?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const supplied = match?.[1] ?? "";

  if (
    configured.length < minimumSecretLength ||
    supplied.length !== configured.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(configured, "utf8"),
    Buffer.from(supplied, "utf8"),
  );
}

export async function handleTransactionalEmailDrainRequest(
  request: Request,
  options: TransactionalEmailDrainRequestOptions,
) {
  if (
    !hasMatchingBearerSecret(
      request,
      options.configuredSecret,
      options.minimumSecretLength ?? 1,
    )
  ) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  try {
    const result = await (options.drain ?? drainTransactionalEmailOutbox)();
    return Response.json(result);
  } catch (error) {
    captureServerException(error, {
      operation: options.operation,
      route: "/api/internal/transactional-email/drain",
    });
    return Response.json(
      { message: "Transactional email processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
