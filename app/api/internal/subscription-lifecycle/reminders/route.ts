import { handleSubscriptionLifecycleReminderRequest } from "@/src/lib/server/subscriptionLifecycleReminders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Scheduler activation is intentionally deferred to UX-8G3B.
export async function GET(request: Request) {
  return handleSubscriptionLifecycleReminderRequest(request);
}
