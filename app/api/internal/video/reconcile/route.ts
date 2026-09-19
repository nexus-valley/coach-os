import { handleNativeVideoReconciliationRequest } from "@/src/lib/server/video/nativeVideoReconciliationRoute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleNativeVideoReconciliationRequest(request, {
    configuredSecret: process.env.CRON_SECRET,
  });
}
