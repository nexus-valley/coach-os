"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  archiveConversationThread,
  getConversationParticipants,
  getConversationThreadById,
  lockConversationThread,
  type ConversationParticipant,
  type ConversationThreadWithMeta,
} from "@/src/lib/conversations";
import {
  editMessage,
  getThreadMessages,
  markThreadRead,
  sendMessage,
  softDeleteMessage,
  type ConversationMessage,
} from "@/src/lib/messages";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type ThreadDetailClientProps = {
  threadId: string;
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function canEditMessage(message: ConversationMessage, userId: string | null) {
  if (!userId || message.sender_user_id !== userId || message.status === "deleted") {
    return false;
  }

  return Date.now() - new Date(message.created_at).getTime() < 15 * 60_000;
}

export function ThreadDetailClient({ threadId }: ThreadDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [composer, setComposer] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [mutating, setMutating] = useState("");
  const [participants, setParticipants] = useState<ConversationParticipant[]>([]);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [thread, setThread] = useState<ConversationThreadWithMeta | null>(null);

  const readOnly = thread?.status !== "active";
  const participantLabel = useMemo(
    () =>
      `${participants.length} participant${participants.length === 1 ? "" : "s"}`,
    [participants.length],
  );

  const loadThread = useCallback(async (currentTenant: Tenant) => {
    const [threadRow, messageRows, participantRows] = await Promise.all([
      getConversationThreadById({
        tenantId: currentTenant.id,
        threadId,
      }),
      getThreadMessages({
        tenantId: currentTenant.id,
        threadId,
      }),
      getConversationParticipants({
        tenantId: currentTenant.id,
        threadId,
      }),
    ]);

    if (!threadRow) {
      setError("Conversation not found in this workspace.");
      return;
    }

    setThread(threadRow);
    setMessages(messageRows);
    setParticipants(participantRows);
    await markThreadRead(currentTenant.id, threadId);
  }, [threadId]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        setCurrentUserId(user?.id ?? null);
        setTenant(currentTenant);
        await loadThread(currentTenant);
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load conversation."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [loadThread, router]);

  async function refresh() {
    if (!tenant) {
      return;
    }

    await loadThread(tenant);
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || readOnly) {
      setActionError("This conversation is read-only.");
      return;
    }

    setMutating("send");
    setActionError("");
    setSuccess("");

    try {
      await sendMessage({
        message: composer,
        messageType: thread?.thread_type === "announcement" ? "announcement" : "text",
        tenantId: tenant.id,
        threadId,
      });
      setComposer("");
      await refresh();
      setSuccess("Message sent.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to send message."));
    } finally {
      setMutating("");
    }
  }

  async function handleEditMessage(messageId: string) {
    if (!tenant) {
      return;
    }

    setMutating(messageId);
    setActionError("");

    try {
      await editMessage({
        message: editingText,
        messageId,
        tenantId: tenant.id,
        threadId,
      });
      setEditingId(null);
      setEditingText("");
      await refresh();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to edit message."));
    } finally {
      setMutating("");
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (!tenant) {
      return;
    }

    setMutating(messageId);
    setActionError("");

    try {
      await softDeleteMessage({
        messageId,
        tenantId: tenant.id,
        threadId,
      });
      await refresh();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete message."));
    } finally {
      setMutating("");
    }
  }

  async function handleThreadStatus(nextStatus: "archived" | "locked") {
    if (!tenant) {
      return;
    }

    setMutating(nextStatus);
    setActionError("");
    setSuccess("");

    try {
      if (nextStatus === "archived") {
        await archiveConversationThread(tenant.id, threadId);
      } else {
        await lockConversationThread(tenant.id, threadId);
      }

      await refresh();
      setSuccess(`Conversation ${nextStatus}.`);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update conversation."));
    } finally {
      setMutating("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading conversation</span>
        </Card>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="mx-auto max-w-7xl">
        <FeedbackAlert onRetry={() => window.location.reload()}>
          {error || "Conversation unavailable."}
        </FeedbackAlert>
        <Button className="mt-5" href="/app/messages" variant="secondary">
          Back to messages
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-[#425B76] transition hover:text-[#0B1F33]"
        href="/app/messages"
      >
        Back to messages
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.34fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="light">{formatType(thread.thread_type)}</Badge>
                <Badge
                  tone={
                    thread.status === "active"
                      ? "success"
                      : thread.status === "locked"
                        ? "warning"
                        : "staff"
                  }
                >
                  {thread.status}
                </Badge>
              </div>
              <h2 className="mt-5 text-4xl font-semibold tracking-normal text-[#0B1F33]">
                {thread.title ?? "Conversation"}
              </h2>
              <p className="mt-3 text-sm font-semibold text-[#0E7490]">
                {thread.course?.title ||
                  thread.cohort?.name ||
                  thread.student?.full_name ||
                  "Workspace communication"}
              </p>
              {thread.description ? (
                <p className="mt-5 max-w-3xl text-sm leading-6 text-[#425B76]">
                  {thread.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={refresh} size="sm" type="button" variant="secondary">
                Refresh
              </Button>
              {thread.status === "active" ? (
                <>
                  <Button
                    disabled={mutating === "locked"}
                    onClick={() => handleThreadStatus("locked")}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Lock
                  </Button>
                  <Button
                    disabled={mutating === "archived"}
                    onClick={() => handleThreadStatus("archived")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Archive
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#66788F]">Thread state</p>
          <h3 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
            {participantLabel}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">
            Created {formatDate(thread.created_at)}. Messages refresh on demand
            in this foundation release.
          </p>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      <Card className="mt-6 border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
        {messages.length === 0 ? (
          <EmptyState
            description="Start the conversation with a clear update, note, or discussion prompt."
            icon="MS"
            title="No messages yet"
          />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const ownMessage = message.sender_user_id === currentUserId;
              const editable = canEditMessage(message, currentUserId);

              return (
                <div
                  className={[
                    "rounded-3xl border p-4",
                    ownMessage
                      ? "border-[#9ADDEA] bg-[#EAF8FC]"
                      : "border-[#D8E8F0] bg-[#F6FBFE]",
                  ].join(" ")}
                  key={message.id}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={ownMessage ? "admin" : "light"}>
                          {ownMessage ? "You" : "Participant"}
                        </Badge>
                        <span className="text-xs font-medium text-[#66788F]">
                          {formatDate(message.created_at)}
                        </span>
                        {message.status !== "sent" ? (
                          <Badge tone={message.status === "deleted" ? "staff" : "warning"}>
                            {message.status}
                          </Badge>
                        ) : null}
                      </div>
                      {editingId === message.id ? (
                        <textarea
                          className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                          onChange={(event) => setEditingText(event.target.value)}
                          value={editingText}
                        />
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0B1F33]">
                          {message.message}
                        </p>
                      )}
                    </div>
                    {editable ? (
                      <div className="flex flex-wrap gap-2">
                        {editingId === message.id ? (
                          <>
                            <Button
                              disabled={mutating === message.id}
                              onClick={() => handleEditMessage(message.id)}
                              size="sm"
                              type="button"
                            >
                              Save
                            </Button>
                            <Button
                              onClick={() => {
                                setEditingId(null);
                                setEditingText("");
                              }}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              onClick={() => {
                                setEditingId(message.id);
                                setEditingText(message.message);
                              }}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Edit
                            </Button>
                            <Button
                              disabled={mutating === message.id}
                              onClick={() => handleDeleteMessage(message.id)}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6 border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10">
        {readOnly ? (
          <div className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-5 text-sm text-[#425B76]">
            This conversation is {thread.status} and cannot receive new
            messages.
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSendMessage}>
            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">
                Message
              </span>
              <textarea
                className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Write an update, discussion prompt, or internal note."
                value={composer}
              />
            </label>
            <div className="flex justify-end">
              <Button disabled={mutating === "send"} type="submit">
                {mutating === "send" ? "Sending..." : "Send Message"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
