import { logActivity } from "@/src/lib/auditLogger";
import {
  getConversationParticipants,
  getConversationThreadById,
  type ConversationThreadType,
} from "@/src/lib/conversations";
import {
  createNotificationsForUsers,
  type NotificationSeverity,
} from "@/src/lib/notifications";
import { getMemberRoleForTenant } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type ConversationMessageType = "announcement" | "system" | "text";
export type ConversationMessageStatus = "deleted" | "edited" | "sent";

export type ConversationMessage = {
  created_at: string;
  deleted_at: string | null;
  edited_at: string | null;
  id: string;
  message: string;
  message_type: ConversationMessageType;
  metadata_json: Record<string, unknown>;
  sender_student_id: string | null;
  sender_user_id: string | null;
  status: ConversationMessageStatus;
  tenant_id: string;
  thread_id: string;
};

const messageSelect =
  "id,tenant_id,thread_id,sender_user_id,sender_student_id,message,message_type,status,metadata_json,created_at,edited_at,deleted_at";

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

async function getCurrentUser(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to use messages.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!role) {
    throw new Error("You do not have access to this workspace.");
  }

  return { role, user };
}

function getNotificationCopy(threadType: ConversationThreadType) {
  const copy: Record<
    ConversationThreadType,
    { severity: NotificationSeverity; title: string }
  > = {
    announcement: {
      severity: "info",
      title: "New announcement",
    },
    cohort_discussion: {
      severity: "info",
      title: "New cohort discussion message",
    },
    course_discussion: {
      severity: "info",
      title: "New course discussion message",
    },
    direct_message: {
      severity: "info",
      title: "New direct message",
    },
    staff_note: {
      severity: "warning",
      title: "New staff note",
    },
  };

  return copy[threadType];
}

async function notifyThreadParticipants(params: {
  message: ConversationMessage;
  senderUserId: string;
  tenantId: string;
}) {
  try {
    const thread = await getConversationThreadById({
      tenantId: params.tenantId,
      threadId: params.message.thread_id,
    });

    if (!thread) {
      return;
    }

    let userIds: string[] = [];

    if (thread.thread_type === "announcement") {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", params.tenantId);

      if (error) {
        throw error;
      }

      userIds = ((data ?? []) as { user_id: string }[])
        .map((member) => member.user_id)
        .filter((userId) => userId !== params.senderUserId);
    } else {
      const participants = await getConversationParticipants({
        tenantId: params.tenantId,
        threadId: params.message.thread_id,
      });
      userIds = participants
        .map((participant) => participant.user_id)
        .filter(
          (userId): userId is string =>
            Boolean(userId) && userId !== params.senderUserId,
        );
    }

    if (userIds.length === 0) {
      return;
    }

    const copy = getNotificationCopy(thread.thread_type);

    await createNotificationsForUsers({
      actionUrl: `/app/messages/${thread.id}`,
      entityId: thread.id,
      entityType: "conversation",
      message:
        params.message.status === "deleted"
          ? "A message was updated in this conversation."
          : params.message.message.slice(0, 180),
      metadata: {
        messageId: params.message.id,
        threadId: thread.id,
        threadType: thread.thread_type,
      },
      severity: copy.severity,
      tenantId: params.tenantId,
      title: `${copy.title}: ${thread.title ?? "Conversation"}`,
      type: "communication_notice",
      userIds,
    });
  } catch {
    // Communication notifications are non-blocking.
  }
}

export async function getThreadMessages(params: {
  tenantId: string;
  threadId: string;
}) {
  const thread = await getConversationThreadById(params);

  if (!thread) {
    throw new Error("Conversation not found in this workspace.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_messages")
    .select(messageSelect)
    .eq("tenant_id", params.tenantId)
    .eq("thread_id", params.threadId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as ConversationMessage[]).map((message) => ({
    ...message,
    metadata_json: message.metadata_json ?? {},
  }));
}

export async function sendMessage(input: {
  message: string;
  messageType?: ConversationMessageType;
  metadata?: Record<string, unknown>;
  tenantId: string;
  threadId: string;
}) {
  const text = input.message.trim();

  if (!text) {
    throw new Error("Message cannot be empty.");
  }

  const { user } = await getCurrentUser(input.tenantId);
  const thread = await getConversationThreadById({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });

  if (!thread) {
    throw new Error("Conversation not found in this workspace.");
  }

  if (thread.status !== "active") {
    throw new Error("This conversation is read-only.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_messages")
    .insert({
      message: text,
      message_type: input.messageType ?? "text",
      metadata_json: input.metadata ?? {},
      sender_user_id: user.id,
      status: "sent",
      tenant_id: input.tenantId,
      thread_id: input.threadId,
    })
    .select(messageSelect)
    .single();

  if (error) {
    throw error;
  }

  const message = data as ConversationMessage;

  await logActivity({
    action: "message_sent",
    description: `Sent message in ${thread.title ?? "conversation"}`,
    entityId: message.id,
    entityName: thread.title ?? "Conversation message",
    entityType: "conversation_message",
    metadata: {
      threadId: thread.id,
      threadType: thread.thread_type,
    },
    tenantId: input.tenantId,
  });
  await markThreadRead(input.tenantId, input.threadId);
  await notifyThreadParticipants({
    message,
    senderUserId: user.id,
    tenantId: input.tenantId,
  });

  return message;
}

async function updateOwnMessage(input: {
  action: "message_deleted" | "message_edited";
  messageId: string;
  patch: Partial<ConversationMessage>;
  tenantId: string;
  threadId: string;
}) {
  const { role, user } = await getCurrentUser(input.tenantId);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("conversation_messages")
    .update(input.patch)
    .eq("tenant_id", input.tenantId)
    .eq("thread_id", input.threadId)
    .eq("id", input.messageId);

  if (role !== "owner" && role !== "admin") {
    query = query.eq("sender_user_id", user.id);
  }

  const { data, error } = await query.select(messageSelect).single();

  if (error) {
    throw error;
  }

  const message = data as ConversationMessage;

  await logActivity({
    action: input.action,
    description:
      input.action === "message_edited"
        ? "Edited conversation message"
        : "Deleted conversation message",
    entityId: message.id,
    entityName: "Conversation message",
    entityType: "conversation_message",
    metadata: { threadId: input.threadId },
    severity: input.action === "message_deleted" ? "warning" : "info",
    tenantId: input.tenantId,
  });

  return message;
}

export async function editMessage(input: {
  message: string;
  messageId: string;
  tenantId: string;
  threadId: string;
}) {
  const text = input.message.trim();

  if (!text) {
    throw new Error("Message cannot be empty.");
  }

  return updateOwnMessage({
    action: "message_edited",
    messageId: input.messageId,
    patch: {
      edited_at: new Date().toISOString(),
      message: text,
      status: "edited",
    } as Partial<ConversationMessage>,
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
}

export async function softDeleteMessage(input: {
  messageId: string;
  tenantId: string;
  threadId: string;
}) {
  return updateOwnMessage({
    action: "message_deleted",
    messageId: input.messageId,
    patch: {
      deleted_at: new Date().toISOString(),
      message: "This message was deleted.",
      status: "deleted",
    } as Partial<ConversationMessage>,
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
}

export async function markThreadRead(tenantId: string, threadId: string) {
  const { user } = await getCurrentUser(tenantId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("thread_id", threadId)
    .eq("user_id", user.id);

  if (error && !isMissingTableError(error)) {
    throw error;
  }
}

export async function getUnreadThreadCount(tenantId: string) {
  const { user } = await getCurrentUser(tenantId);
  const supabase = getSupabaseClient();
  const participantsResult = await supabase
    .from("conversation_participants")
    .select("thread_id,last_read_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id);

  if (participantsResult.error) {
    if (isMissingTableError(participantsResult.error)) {
      return 0;
    }

    throw participantsResult.error;
  }

  const participants = (participantsResult.data ?? []) as {
    last_read_at: string | null;
    thread_id: string;
  }[];

  if (participants.length === 0) {
    return 0;
  }

  const threadIds = participants.map((participant) => participant.thread_id);
  const messagesResult = await supabase
    .from("conversation_messages")
    .select("thread_id,created_at,sender_user_id,status")
    .eq("tenant_id", tenantId)
    .in("thread_id", threadIds)
    .neq("sender_user_id", user.id)
    .neq("status", "deleted");

  if (messagesResult.error) {
    throw messagesResult.error;
  }

  const lastReadByThread = new Map(
    participants.map((participant) => [
      participant.thread_id,
      participant.last_read_at,
    ]),
  );
  const unreadThreadIds = new Set<string>();

  for (const message of (messagesResult.data ?? []) as {
    created_at: string;
    sender_user_id: string | null;
    status: ConversationMessageStatus;
    thread_id: string;
  }[]) {
    const lastRead = lastReadByThread.get(message.thread_id);
    const threadId = message.thread_id;

    if (!lastRead || new Date(message.created_at) > new Date(lastRead)) {
      unreadThreadIds.add(threadId);
    }
  }

  return unreadThreadIds.size;
}
