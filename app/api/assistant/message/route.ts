import { createClient } from "@supabase/supabase-js";

import {
  getPublicError,
  handleAssistantMessage,
} from "@/src/lib/ai/assistantService";
import type { AssistantRequest, AssistantScope } from "@/src/lib/ai/assistantTypes";

export const runtime = "nodejs";

function getSupabaseForRequest(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment is not configured.");
  }

  const authorization = request.headers.get("authorization") ?? "";

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: authorization
      ? {
          headers: {
            Authorization: authorization,
          },
        }
      : undefined,
  });
}

function isAssistantScope(value: unknown): value is AssistantScope {
  return value === "student" || value === "team";
}

async function parseRequest(request: Request): Promise<AssistantRequest> {
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!body || typeof body.message !== "string") {
    throw new Error("Assistant message is required.");
  }

  if (!isAssistantScope(body.scope)) {
    throw new Error("Invalid assistant scope.");
  }

  return {
    conversationId:
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : null,
    message: body.message,
    scope: body.scope,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseForRequest(request);
    const authorization = request.headers.get("authorization");

    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const token = authorization.slice("bearer ".length).trim();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const assistantRequest = await parseRequest(request);
    const result = await handleAssistantMessage(supabase, assistantRequest);

    return Response.json(result);
  } catch (error) {
    const publicError = getPublicError(error);
    const status = publicError.status === 500 ? 400 : publicError.status;

    return Response.json({ error: publicError.message }, { status });
  }
}
