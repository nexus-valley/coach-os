import { handlePlatformBillingFulfillmentDrainRequest } from "@/src/lib/server/platformBillingFulfillmentDrain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handlePlatformBillingFulfillmentDrainRequest(request, {
    configuredSecret: process.env.COACHFORT_BILLING_WORKER_SECRET,
  });
}
