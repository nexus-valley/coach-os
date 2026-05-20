import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CommunicationChannel = "email" | "in_app" | "sms" | "whatsapp";
export type CommunicationStatus = "failed" | "queued" | "sent" | "skipped";

export type CommunicationLog = {
  channel: CommunicationChannel;
  created_at: string;
  id: string;
  message: string | null;
  metadata_json: Record<string, unknown>;
  status: CommunicationStatus;
  subject: string | null;
  target: string | null;
  tenant_id: string;
  type: string;
  user_id: string | null;
};

const communicationLogSelect =
  "id,tenant_id,user_id,channel,type,status,target,subject,message,metadata_json,created_at";

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

export async function queueCommunicationLog(input: {
  channel: CommunicationChannel;
  message?: string | null;
  metadata?: Record<string, unknown>;
  status?: CommunicationStatus;
  subject?: string | null;
  target?: string | null;
  tenantId: string;
  type: string;
  userId?: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("communication_logs")
    .insert({
      channel: input.channel,
      message: input.message ?? null,
      metadata_json: input.metadata ?? {},
      status: input.status ?? "queued",
      subject: input.subject ?? null,
      target: input.target ?? null,
      tenant_id: input.tenantId,
      type: input.type,
      user_id: input.userId ?? null,
    })
    .select(communicationLogSelect)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }

  const log = {
    ...(data as CommunicationLog),
    metadata_json:
      ((data as CommunicationLog).metadata_json as Record<string, unknown>) ?? {},
  };

  await logActivity({
    action: "communication_logged",
    description: `Queued ${log.channel} communication log.`,
    entityId: log.id,
    entityName: log.subject ?? log.type,
    entityType: "communication_log",
    metadata: {
      channel: log.channel,
      status: log.status,
      type: log.type,
      userId: log.user_id,
    },
    tenantId: log.tenant_id,
  });

  return log;
}

export async function logNotificationDelivery(input: {
  message: string;
  notificationId: string;
  tenantId: string;
  title: string;
  type: string;
  userId: string;
}) {
  return queueCommunicationLog({
    channel: "in_app",
    message: input.message,
    metadata: { notificationId: input.notificationId },
    status: "sent",
    subject: input.title,
    tenantId: input.tenantId,
    type: input.type,
    userId: input.userId,
  });
}
