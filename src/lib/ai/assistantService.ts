import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AssistantAccessError,
  buildAssistantContext,
} from "@/src/lib/ai/assistantContext";
import { generateAssistantResponse } from "@/src/lib/ai/assistantProvider";
import type {
  AssistantRequest,
  AssistantServiceResult,
} from "@/src/lib/ai/assistantTypes";

const maxMessageLength = 2000;

function normalizeMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function getPublicError(error: unknown) {
  if (error instanceof AssistantAccessError) {
    return {
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    if (
      error.message === "Assistant message is required." ||
      error.message === `Assistant message must be ${maxMessageLength} characters or less.` ||
      error.message === "Invalid assistant scope."
    ) {
      return {
        message: error.message,
        status: 400,
      };
    }

    return {
      message: "Unable to process assistant request.",
      status: 500,
    };
  }

  return {
    message: "Unable to process assistant request.",
    status: 500,
  };
}

async function recordTeamAudit(
  supabase: SupabaseClient,
  input: {
    provider: string;
    scope: string;
    status: "blocked" | "failed" | "success";
    tenantId: string;
    messageLength: number;
  },
) {
  try {
    await supabase.rpc("record_ai_assistant_audit_secure", {
      p_message_length: input.messageLength,
      p_provider: input.provider,
      p_scope: input.scope,
      p_status: input.status,
      p_tenant_id: input.tenantId,
    });
  } catch {
    // Audit failures should not block a read-only assistant response.
  }
}

async function recordAssistantExchange(
  supabase: SupabaseClient,
  input: {
    assistantMessage: string;
    contextSummary: Record<string, unknown>;
    conversationId?: string | null;
    errorCode?: string | null;
    provider: string;
    scope: string;
    status: "blocked" | "failed" | "success";
    studentId?: string | null;
    tenantId: string;
    userMessage: string;
  },
) {
  const { data, error } = await supabase.rpc("record_ai_assistant_exchange", {
    p_assistant_message: input.assistantMessage,
    p_context_summary_json: input.contextSummary,
    p_conversation_id: input.conversationId ?? null,
    p_error_code: input.errorCode ?? null,
    p_prompt_char_count: input.userMessage.length,
    p_provider: input.provider,
    p_response_char_count: input.assistantMessage.length,
    p_scope: input.scope,
    p_status: input.status,
    p_student_id: input.studentId ?? null,
    p_tenant_id: input.tenantId,
    p_user_message: input.userMessage,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function handleAssistantMessage(
  supabase: SupabaseClient,
  request: AssistantRequest,
): Promise<AssistantServiceResult> {
  const message = normalizeMessage(request.message ?? "");

  if (!message) {
    throw new Error("Assistant message is required.");
  }

  if (message.length > maxMessageLength) {
    throw new Error(`Assistant message must be ${maxMessageLength} characters or less.`);
  }

  const context = await buildAssistantContext(supabase, request.scope);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const providerResult = await generateAssistantResponse({
    context,
    message,
  });

  const conversationId = await recordAssistantExchange(supabase, {
    assistantMessage: providerResult.response,
    contextSummary: context.contextSummary,
    conversationId: request.conversationId,
    provider: providerResult.provider,
    scope: request.scope,
    status: "success",
    studentId: context.studentId,
    tenantId: context.tenantId,
    userMessage: message,
  });

  if (context.mode === "team" && user) {
    await recordTeamAudit(supabase, {
      messageLength: message.length,
      provider: providerResult.provider,
      scope: request.scope,
      status: "success",
      tenantId: context.tenantId,
    });
  }

  return {
    contextSummary: context.contextSummary,
    conversationId,
    provider: providerResult.provider,
    reply: providerResult.response,
    scope: request.scope,
  };
}

export { getPublicError };
