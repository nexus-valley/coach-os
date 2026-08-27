import { captureServerException } from "@/src/lib/server/monitoring";
import {
  verifyResendEmailWebhook,
  type VerifiedResendEmailEvent,
} from "@/src/lib/server/resendWebhook";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxWebhookBytes = 64 * 1024;

export async function POST(request: Request) {
  const signingSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const svixId = request.headers.get("svix-id")?.trim() ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const signature = request.headers.get("svix-signature")?.trim() ?? "";

  if (!signingSecret || !svixId || !svixTimestamp || !signature) {
    return Response.json({ message: "Invalid webhook." }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxWebhookBytes) {
    return Response.json({ message: "Invalid webhook." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxWebhookBytes) {
    return Response.json({ message: "Invalid webhook." }, { status: 413 });
  }
  let event: VerifiedResendEmailEvent | null;

  try {
    event = verifyResendEmailWebhook({
      rawBody,
      signature,
      signingSecret,
      svixId,
      svixTimestamp,
    });
  } catch {
    return Response.json({ message: "Invalid webhook." }, { status: 400 });
  }

  if (!event) {
    return Response.json({ received: true });
  }

  try {
    const admin = getSupabaseAdminClient();
    const { error } = await admin.rpc(
      "record_transactional_email_provider_event_server",
      {
        p_bounce_type: event.bounceType,
        p_event_type: event.eventType,
        p_occurred_at: event.createdAt,
        p_provider_event_id: svixId,
        p_provider_message_id: event.providerMessageId,
      },
    );

    if (error) {
      throw new Error("Unable to record verified email delivery event.");
    }

    return Response.json({ received: true });
  } catch (error) {
    captureServerException(error, {
      operation: "resend_transactional_email_webhook",
      route: "/api/webhooks/resend",
    });
    return Response.json(
      { message: "Webhook processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
