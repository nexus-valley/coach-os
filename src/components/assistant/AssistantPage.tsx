"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type AssistantScope = "student" | "team";

type AssistantMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
};

type AssistantPageProps = {
  role?: MemberRole | null;
  scope: AssistantScope;
  studentName?: string;
};

const teamPrompts: Record<MemberRole, string[]> = {
  admin: [
    "Summarize today’s operations",
    "What needs my attention?",
    "Summarize pending payments and upcoming sessions",
  ],
  owner: [
    "Summarize today’s operations",
    "What should I check before publishing more courses?",
    "What needs my attention?",
  ],
  staff: [
    "What operational tasks need follow-up?",
    "Summarize today’s sessions",
    "What student follow-ups should I check?",
  ],
  trainer: [
    "What sessions do I have coming up?",
    "Which assignments need review?",
    "Summarize my trainer workload",
  ],
};

const studentPrompts = [
  "What should I focus on today?",
  "Do I have pending assignments?",
  "Summarize my upcoming sessions",
];

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getInitialMessage(scope: AssistantScope, role?: MemberRole | null) {
  if (scope === "student") {
    return "I can help summarize your courses, sessions, assignments, payments, and notifications. I cannot change records or replace your trainer’s guidance.";
  }

  if (role === "trainer") {
    return "I can summarize your assigned sessions, assignment reviews, and trainer workload. I cannot update attendance, assignments, or student records.";
  }

  return "I can summarize safe workspace context and suggest next steps. I cannot make changes, modify records, or access restricted data.";
}

export function AssistantPage({
  role,
  scope,
  studentName,
}: AssistantPageProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvedRole, setResolvedRole] = useState<MemberRole | null>(
    role ?? null,
  );
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      content: getInitialMessage(scope, role),
      id: "initial",
      role: "assistant",
    },
  ]);

  const suggestedPrompts = useMemo(() => {
    if (scope === "student") {
      return studentPrompts;
    }

    return teamPrompts[resolvedRole ?? "staff"] ?? teamPrompts.staff;
  }, [resolvedRole, scope]);

  useEffect(() => {
    if (scope !== "team" || role) {
      return;
    }

    let active = true;

    async function loadRole() {
      try {
        const supabase = getSupabaseClient();
        const [
          currentTenant,
          {
            data: { user },
          },
        ] = await Promise.all([getCurrentTenant(), supabase.auth.getUser()]);

        if (!active || !currentTenant || !user) {
          return;
        }

        const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

        if (active) {
          setResolvedRole(currentRole);
        }
      } catch {
        if (active) {
          setResolvedRole(null);
        }
      }
    }

    loadRole();

    return () => {
      active = false;
    };
  }, [role, scope]);

  async function sendMessage(messageText: string) {
    const message = messageText.trim();

    if (!message) {
      setError("Enter a question for the assistant.");
      return;
    }

    if (message.length > 2000) {
      setError("Questions must be 2,000 characters or less.");
      return;
    }

    setError(null);
    setLoading(true);
    setInput("");

    const userMessage: AssistantMessage = {
      content: message,
      id: createId(),
      role: "user",
    };

    setMessages((current) => [...current, userMessage]);

    try {
      const supabase = getSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const response = await fetch("/api/assistant/message", {
        body: JSON.stringify({
          conversationId,
          message,
          scope,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const payload = (await response.json()) as {
        conversationId?: string | null;
        error?: string;
        reply?: string;
      };

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? "Unable to get assistant response.");
      }

      setConversationId(payload.conversationId ?? conversationId);
      setMessages((current) => [
        ...current,
        {
          content: payload.reply ?? "",
          id: createId(),
          role: "assistant",
        },
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to get assistant response.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-[#0B1F33]">
                AI Assistant
              </h1>
              <Badge tone={scope === "student" ? "trainer" : "owner"}>
                {scope === "student"
                  ? "Student assistant"
                  : `${resolvedRole ?? "team"} assistant`}
              </Badge>
              <Badge tone="warning">Preview</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-[#5B7083]">
              {scope === "student" && studentName
                ? `Preview guidance for ${studentName}, based only on their own portal context.`
                : "Preview guidance based on safe workspace summaries. Responses use limited allowlisted context and may be incomplete."}
            </p>
          </div>
          <Card className="rounded-2xl bg-[#F8FCFE] p-4 text-sm text-[#425B76] lg:max-w-sm">
            AI Assistant Preview can make mistakes. It suggests next steps only,
            uses limited allowlisted summaries, and does not perform actions.
            Verify critical information before acting.
          </Card>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="flex min-h-[34rem] flex-col rounded-3xl p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.map((message) => (
              <div
                className={[
                  "max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6",
                  message.role === "user"
                    ? "ml-auto bg-[#145DA0] text-white"
                    : "bg-[#F3FAFD] text-[#0B2A3D]",
                ].join(" ")}
                key={message.id}
              >
                {message.content}
              </div>
            ))}
          </div>
          <form
            className="border-t border-[#D8E8F0] p-4"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
          >
            {error ? (
              <p className="mb-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-2 text-sm text-[#B91C1C]">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                className="min-h-24 flex-1 resize-none rounded-3xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2ECBEA]"
                maxLength={2000}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask for a safe summary or next-step suggestion..."
                value={input}
              />
              <Button className="sm:self-end" disabled={loading} type="submit">
                {loading ? "Thinking..." : "Send"}
              </Button>
            </div>
          </form>
        </Card>

        <aside className="space-y-4">
          <Card className="rounded-3xl p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
              Suggested prompts
            </h2>
            <div className="mt-4 space-y-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  className="w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-left text-sm font-semibold text-[#0B2A3D] transition hover:border-[#2ECBEA]/70 hover:bg-[#F3FAFD]"
                  disabled={loading}
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </Card>
          <Card className="rounded-3xl p-5 text-sm leading-6 text-[#425B76]">
            <h2 className="font-semibold text-[#0B1F33]">
              Preview safety boundary
            </h2>
            <p className="mt-2">
              This preview uses allowlisted summaries only. It cannot modify
              payments, attendance, courses, students, sessions, automations, or
              settings.
            </p>
          </Card>
        </aside>
      </section>
    </div>
  );
}
