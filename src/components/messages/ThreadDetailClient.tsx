"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import {
  closeChatThread,
  formatChatDate,
  formatChatType,
  getTeamChatThread,
  markChatThreadRead,
  sendTeamChatMessage,
  type AcademyChatMessage,
  type AcademyChatThread,
} from "@/src/lib/academyChat";

type ThreadDetailClientProps = {
  threadId: string;
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function threadTone(type: AcademyChatThread["thread_type"]) {
  if (type === "student_support") return "warning" as const;
  if (type === "student_direct") return "trainer" as const;
  return "admin" as const;
}

function statusTone(status: AcademyChatThread["status"]) {
  if (status === "active") return "success" as const;
  if (status === "locked") return "warning" as const;
  return "staff" as const;
}

function senderLabel(message: AcademyChatMessage) {
  if (message.sender_type === "student") return "Student";
  if (message.sender_type === "system") return "System";
  return "Academy";
}

function messageBubbleClass(message: AcademyChatMessage) {
  if (message.sender_type === "student") {
    return "border-[#D8E8F0] bg-white";
  }

  if (message.sender_type === "system") {
    return "border-[#FED7AA] bg-[#FFF7ED]";
  }

  return "border-[#BFDDF5] bg-[#EEF6FF]";
}

export function ThreadDetailClient({ threadId }: ThreadDetailClientProps) {
  const [actionError, setActionError] = useState("");
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<AcademyChatMessage[]>([]);
  const [mutating, setMutating] = useState("");
  const [success, setSuccess] = useState("");
  const [thread, setThread] = useState<AcademyChatThread | null>(null);

  const readOnly = thread?.status !== "active";
  const subtitle = useMemo(() => {
    if (!thread) return "";

    return (
      thread.student_name ||
      thread.course_title ||
      thread.cohort_name ||
      "Student-facing thread"
    );
  }, [thread]);

  async function loadThread() {
    setError("");
    setLoading(true);

    try {
      const detail = await getTeamChatThread(threadId);
      setThread(detail.thread);
      setMessages(detail.messages);
      await markChatThreadRead(threadId).catch(() => undefined);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load chat thread."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialThread() {
      try {
        const detail = await getTeamChatThread(threadId);

        if (!active) {
          return;
        }

        setThread(detail.thread);
        setMessages(detail.messages);
        await markChatThreadRead(threadId).catch(() => undefined);
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load chat thread."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialThread();

    return () => {
      active = false;
    };
  }, [threadId]);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (readOnly) {
      setActionError("This chat is closed or archived.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("send");

    try {
      await sendTeamChatMessage({
        body: composer,
        threadId,
      });
      setComposer("");
      await loadThread();
      setSuccess("Message sent.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to send message."));
    } finally {
      setMutating("");
    }
  }

  async function handleCloseThread() {
    setActionError("");
    setSuccess("");
    setMutating("close");

    try {
      await closeChatThread(threadId);
      await loadThread();
      setSuccess("Chat closed.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to close chat."));
    } finally {
      setMutating("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <Card className="p-8">
          <p className="text-sm font-semibold text-[#425B76]">
            Loading chat thread...
          </p>
        </Card>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <FeedbackAlert>{error || "Chat thread was not found."}</FeedbackAlert>
        <Button href="/app/messages" variant="secondary">
          Back to messages
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        actions={
          <>
          <Button href="/app/messages" size="sm" variant="secondary">
            Back to messages
          </Button>
          <Button onClick={loadThread} type="button" variant="secondary">
            Refresh
          </Button>
          {thread.status === "active" ? (
            <Button
              disabled={mutating === "close"}
              onClick={handleCloseThread}
              type="button"
              variant="outline"
            >
              {mutating === "close" ? "Closing..." : "Close chat"}
            </Button>
          ) : null}
          </>
        }
        description={subtitle}
        eyebrow="Student message thread"
        metadata={
          <>
            <Badge tone={threadTone(thread.thread_type)}>
              {formatChatType(thread.thread_type)}
            </Badge>
            <Badge tone={statusTone(thread.status)}>{thread.status}</Badge>
            {thread.replies_enabled ? (
              <Badge tone="success">Replies enabled</Badge>
            ) : (
              <Badge tone="warning">Read only</Badge>
            )}
          </>
        }
        title={thread.title || "Student chat"}
      />

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F]">
              Student
            </p>
            <p className="mt-2 text-sm font-semibold text-[#0B1F33]">
              {thread.student_name || "Not student-specific"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F]">
              Context
            </p>
            <p className="mt-2 text-sm font-semibold text-[#0B1F33]">
              {thread.course_title || thread.cohort_name || "General support"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F]">
              Updated
            </p>
            <p className="mt-2 text-sm font-semibold text-[#0B1F33]">
              {formatChatDate(thread.updated_at)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader
          description="Messages stay tenant-scoped and student-facing through the existing academy chat RPCs."
          title="Conversation"
        />
        {messages.length === 0 ? (
          <EmptyState
            description="No messages have been sent in this chat yet."
            icon="M"
            title="No messages"
          />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                className={[
                  "rounded-2xl border p-4",
                  messageBubbleClass(message),
                ].join(" ")}
                key={message.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        message.sender_type === "student"
                          ? "trainer"
                          : message.sender_type === "system"
                            ? "warning"
                            : "admin"
                      }
                    >
                      {senderLabel(message)}
                    </Badge>
                    {message.status === "deleted" ? (
                      <Badge tone="staff">Deleted</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs font-medium text-[#66788F]">
                    {formatChatDate(message.created_at)}
                  </p>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0B1F33]">
                  {message.status === "deleted"
                    ? "This message was deleted."
                    : message.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        {readOnly ? (
          <FeedbackAlert tone="warning">
            This chat is closed or archived. New replies are blocked.
          </FeedbackAlert>
        ) : (
          <form className="space-y-4" onSubmit={handleSendMessage}>
            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">
                Reply as academy
              </span>
              <textarea
                className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                maxLength={4000}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Write a plain-text reply."
                required
                value={composer}
              />
            </label>
            <div className="flex justify-end">
              <Button disabled={mutating === "send"} type="submit">
                {mutating === "send" ? "Sending..." : "Send Reply"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
