import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type AcademyChatThreadType =
  | "cohort_announcement"
  | "course_announcement"
  | "student_direct"
  | "student_support";

export type AcademyChatThreadStatus = "active" | "archived" | "locked";

export type AcademyChatThread = {
  cohort_id: string | null;
  cohort_name: string | null;
  course_id: string | null;
  course_title: string | null;
  created_at: string;
  created_by: string | null;
  description: string | null;
  id: string;
  recent_message: string | null;
  recent_message_at: string | null;
  replies_enabled: boolean;
  status: AcademyChatThreadStatus;
  student_id: string | null;
  student_name: string | null;
  tenant_id: string;
  thread_type: AcademyChatThreadType;
  title: string | null;
  updated_at: string;
};

export type AcademyChatMessage = {
  created_at: string;
  deleted_at: string | null;
  edited_at: string | null;
  id: string;
  message: string;
  message_type: "announcement" | "system" | "text";
  sender_student_id: string | null;
  sender_type: "student" | "system" | "team";
  sender_user_id: string | null;
  status: "deleted" | "edited" | "sent";
  tenant_id: string;
  thread_id: string;
};

export type AcademyChatThreadDetail = {
  messages: AcademyChatMessage[];
  thread: AcademyChatThread;
};

type ThreadListPayload = {
  threads?: AcademyChatThread[];
};

export class ChatMonthlyLimitError extends Error {
  constructor(audience: "coach" | "student") {
    super(
      audience === "coach"
        ? "You've reached your monthly messaging limit."
        : "Messaging is temporarily unavailable for this workspace. Please contact your coach.",
    );
    this.name = "ChatMonthlyLimitError";
  }
}

export function createChatRequestId() {
  return crypto.randomUUID();
}

export function isChatMonthlyLimitError(error: unknown) {
  return error instanceof ChatMonthlyLimitError;
}

function throwChatMutationError(
  error: { message?: string },
  audience: "coach" | "student",
): never {
  if (error.message?.includes("Monthly usage limit reached.")) {
    throw new ChatMonthlyLimitError(audience);
  }

  throw error;
}

function normalizeThreadList(data: unknown) {
  const payload = (data ?? {}) as ThreadListPayload;
  return Array.isArray(payload.threads) ? payload.threads : [];
}

function normalizeThreadDetail(data: unknown) {
  const payload = data as Partial<AcademyChatThreadDetail> | null;

  if (!payload?.thread) {
    throw new Error("Chat thread was not returned.");
  }

  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    thread: payload.thread,
  } satisfies AcademyChatThreadDetail;
}

export function formatChatType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatChatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function getTeamChatThreads(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_chat_threads", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeThreadList(data);
}

export async function getTeamChatThread(threadId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_chat_thread", {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }

  return normalizeThreadDetail(data);
}

export async function getStudentChatThreads() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_chat_threads");

  if (error) {
    throw error;
  }

  return normalizeThreadList(data);
}

export async function getStudentChatThread(threadId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_chat_thread", {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }

  return normalizeThreadDetail(data);
}

export async function createStudentDirectChat(input: {
  initialMessage: string;
  requestId: string;
  studentId: string;
  tenantId: string;
  title: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_student_direct_chat", {
    p_initial_message: input.initialMessage,
    p_request_id: input.requestId,
    p_student_id: input.studentId,
    p_tenant_id: input.tenantId,
    p_title: input.title,
  });

  if (error) {
    throwChatMutationError(error, "coach");
  }

  return data as string;
}

export async function createStudentSupportThread(input: {
  initialMessage: string;
  requestId: string;
  title: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_student_support_thread", {
    p_initial_message: input.initialMessage,
    p_request_id: input.requestId,
    p_title: input.title,
  });

  if (error) {
    throwChatMutationError(error, "student");
  }

  return data as string;
}

export async function sendTeamChatMessage(input: {
  body: string;
  requestId: string;
  threadId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("send_team_chat_message", {
    p_body: input.body,
    p_request_id: input.requestId,
    p_thread_id: input.threadId,
  });

  if (error) {
    throwChatMutationError(error, "coach");
  }

  return data as string;
}

export async function sendStudentChatMessage(input: {
  body: string;
  requestId: string;
  threadId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("send_student_chat_message", {
    p_body: input.body,
    p_request_id: input.requestId,
    p_thread_id: input.threadId,
  });

  if (error) {
    throwChatMutationError(error, "student");
  }

  return data as string;
}

export async function closeChatThread(threadId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("close_chat_thread", {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function markChatThreadRead(threadId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("mark_chat_thread_read", {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }
}
