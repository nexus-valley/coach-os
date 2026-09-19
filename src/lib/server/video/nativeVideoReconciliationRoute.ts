import { captureServerException } from "@/src/lib/server/monitoring";
import { hasMatchingBearerSecret } from "@/src/lib/server/transactionalEmailDrain";
import {
  runNativeVideoReconciliation,
  type NativeVideoReconciliationSummary,
} from "@/src/lib/server/video/nativeVideoReconciliation";

type Reconcile = () => Promise<NativeVideoReconciliationSummary>;

export async function handleNativeVideoReconciliationRequest(
  request: Request,
  options: {
    configuredSecret?: string;
    reconcile?: Reconcile;
  } = {},
) {
  if (
    !hasMatchingBearerSecret(
      request,
      options.configuredSecret ?? process.env.CRON_SECRET,
      32,
    )
  ) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  try {
    return Response.json(
      await (options.reconcile ?? runNativeVideoReconciliation)(),
    );
  } catch (error) {
    captureServerException(error, {
      operation: "native_video_reconciliation",
      route: "/api/internal/video/reconcile",
    });
    return Response.json(
      { message: "Video reconciliation is temporarily unavailable." },
      { status: 503 },
    );
  }
}
