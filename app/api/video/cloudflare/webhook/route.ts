import { handleCloudflareStreamWebhookRequest } from "@/src/lib/server/video/cloudflareStreamWebhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCloudflareStreamWebhookRequest(request);
}
