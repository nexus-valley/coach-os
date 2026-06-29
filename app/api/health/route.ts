import {
  getMonitoringEnvironment,
  getSafeReleaseId,
} from "@/src/lib/monitoring";
import { isServerMonitoringEnabled } from "@/src/lib/server/monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      environment: getMonitoringEnvironment(),
      monitoringEnabled: isServerMonitoringEnabled(),
      release: getSafeReleaseId() ?? null,
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
