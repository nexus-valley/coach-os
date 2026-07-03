import {
  getConversationThreadById,
  isRecoverableConversationError,
} from "@/src/lib/conversations";
import { logOptionalQueryFailure } from "@/src/lib/optionalQuery";
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

function legacyConversationWriteRetired(): never {
  throw new Error(
    "Legacy conversation writes are retired. Use the Academy Chat module.",
  );
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  return isRecoverableConversationError(error);
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
  void input;
  legacyConversationWriteRetired();
}

export async function editMessage(input: {
  message: string;
  messageId: string;
  tenantId: string;
  threadId: string;
}) {
  void input;
  legacyConversationWriteRetired();
}

export async function softDeleteMessage(input: {
  messageId: string;
  tenantId: string;
  threadId: string;
}) {
  void input;
  legacyConversationWriteRetired();
}

export async function markThreadRead(tenantId: string, threadId: string) {
  void tenantId;
  void threadId;
  legacyConversationWriteRetired();
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
      logOptionalQueryFailure(
        {
          area: "messages.getUnreadThreadCount",
          helper: "participantReadState",
          table: "conversation_participants",
        },
        participantsResult.error,
      );
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
    if (isMissingTableError(messagesResult.error)) {
      logOptionalQueryFailure(
        {
          area: "messages.getUnreadThreadCount",
          helper: "unreadMessageSelect",
          table: "conversation_messages",
        },
        messagesResult.error,
      );
      return 0;
    }

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

export async function safeGetUnreadThreadCount(tenantId: string) {
  try {
    return await getUnreadThreadCount(tenantId);
  } catch (caught) {
    if (
      caught &&
      typeof caught === "object" &&
      isRecoverableConversationError(caught as { code?: string; message?: string })
    ) {
      logOptionalQueryFailure(
        {
          area: "messages.safeGetUnreadThreadCount",
          helper: "getUnreadThreadCount",
          table: "conversation_messages",
        },
        caught,
      );
      return 0;
    }

    throw caught;
  }
}
