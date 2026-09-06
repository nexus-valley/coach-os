"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import {
  createStudentSupportThread,
  createChatRequestId,
  formatChatDate,
  formatChatType,
  getStudentChatThread,
  getStudentChatThreads,
  markChatThreadRead,
  sendStudentChatMessage,
  type AcademyChatMessage,
  type AcademyChatThread,
} from "@/src/lib/academyChat";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { PortalEmptyState, PortalLoadingCard } from "@/src/components/portal/StudentPortalShared";

type StudentPortalMessagesProps = {
  context: StudentPortalContext;
};

type SupportFormState = {
  initialMessage: string;
  title: string;
};

const emptySupportForm: SupportFormState = {
  initialMessage: "",
  title: "",
};

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function threadTone(type: AcademyChatThread["thread_type"]) {
  if (type === "student_support") return "warning" as const;
  if (type === "student_direct") return "trainer" as const;
  return "admin" as const;
}

function messageBubbleClass(message: AcademyChatMessage) {
  if (message.sender_type === "student") {
    return "border-[#DDD6FE] bg-[#F5F3FF]";
  }

  if (message.sender_type === "system") {
    return "border-[#FED7AA] bg-[#FFF7ED]";
  }

  return "border-[#D8E8F0] bg-white";
}

function senderLabel(message: AcademyChatMessage) {
  if (message.sender_type === "student") return "You";
  if (message.sender_type === "system") return "System";
  return "Coach team";
}

function canStudentReply(thread: AcademyChatThread | null) {
  if (!thread || thread.status !== "active" || !thread.replies_enabled) {
    return false;
  }

  return ["student_direct", "student_support"].includes(thread.thread_type);
}

export function StudentPortalMessages({ context }: StudentPortalMessagesProps) {
  const [actionError, setActionError] = useState("");
  const [composer, setComposer] = useState("");
  const [detailMessages, setDetailMessages] = useState<AcademyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [selectedThread, setSelectedThread] = useState<AcademyChatThread | null>(null);
  const [supportForm, setSupportForm] = useState<SupportFormState>(emptySupportForm);
  const [supportOpen, setSupportOpen] = useState(false);
  const [success, setSuccess] = useState("");
  const [threads, setThreads] = useState<AcademyChatThread[]>([]);
  const replyRequest = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  const supportRequest = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);

  const replyAllowed = canStudentReply(selectedThread);

  const sortedThreads = useMemo(
    () =>
      [...threads].sort((first, second) => {
        const firstDate = first.recent_message_at || first.updated_at || first.created_at;
        const secondDate = second.recent_message_at || second.updated_at || second.created_at;
        return new Date(secondDate).getTime() - new Date(firstDate).getTime();
      }),
    [threads],
  );

  async function loadThreadDetail(threadId: string) {
    const detail = await getStudentChatThread(threadId);
    setSelectedThread(detail.thread);
    setDetailMessages(detail.messages);
    await markChatThreadRead(threadId).catch(() => undefined);
  }

  async function loadThreads() {
    setActionError("");
    setLoading(true);

    try {
      const nextThreads = await getStudentChatThreads();
      setThreads(nextThreads);

      const currentThreadId =
        selectedThread?.id && nextThreads.some((thread) => thread.id === selectedThread.id)
          ? selectedThread.id
          : nextThreads[0]?.id;

      if (currentThreadId) {
        await loadThreadDetail(currentThreadId);
      } else {
        setSelectedThread(null);
        setDetailMessages([]);
      }
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load messages."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialThreads() {
      try {
        const nextThreads = await getStudentChatThreads();

        if (!active) {
          return;
        }

        setThreads(nextThreads);

        const firstThreadId = nextThreads[0]?.id;

        if (!firstThreadId) {
          setSelectedThread(null);
          setDetailMessages([]);
          return;
        }

        const detail = await getStudentChatThread(firstThreadId);

        if (!active) {
          return;
        }

        setSelectedThread(detail.thread);
        setDetailMessages(detail.messages);
        await markChatThreadRead(firstThreadId).catch(() => undefined);
      } catch (caught) {
        if (active) {
          setActionError(getErrorMessage(caught, "Unable to load messages."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialThreads();

    return () => {
      active = false;
    };
  }, []);

  async function handleSelectThread(threadId: string) {
    setActionError("");
    setSuccess("");
    setMutating(`select-${threadId}`);

    try {
      await loadThreadDetail(threadId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to open this message thread."));
    } finally {
      setMutating("");
    }
  }

  async function handleCreateSupportThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setSuccess("");
    setMutating("support");

    const fingerprint = JSON.stringify([
      supportForm.title.trim(),
      supportForm.initialMessage.trim(),
    ]);
    const requestId =
      supportRequest.current?.fingerprint === fingerprint
        ? supportRequest.current.requestId
        : createChatRequestId();
    supportRequest.current = { fingerprint, requestId };

    try {
      const threadId = await createStudentSupportThread({
        initialMessage: supportForm.initialMessage,
        requestId,
        title: supportForm.title,
      });
      supportRequest.current = null;
      setSupportForm(emptySupportForm);
      setSupportOpen(false);
      setSuccess("Support request created.");
      const nextThreads = await getStudentChatThreads();
      setThreads(nextThreads);
      await loadThreadDetail(threadId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create support request."));
    } finally {
      setMutating("");
    }
  }

  async function handleSendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedThread || !replyAllowed) {
      setActionError("Replies are not enabled for this thread.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("send");

    const fingerprint = JSON.stringify([selectedThread.id, composer.trim()]);
    const requestId =
      replyRequest.current?.fingerprint === fingerprint
        ? replyRequest.current.requestId
        : createChatRequestId();
    replyRequest.current = { fingerprint, requestId };

    try {
      await sendStudentChatMessage({
        body: composer,
        requestId,
        threadId: selectedThread.id,
      });
      replyRequest.current = null;
      setComposer("");
      await loadThreadDetail(selectedThread.id);
      const nextThreads = await getStudentChatThreads();
      setThreads(nextThreads);
      setSuccess("Reply sent.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to send reply."));
    } finally {
      setMutating("");
    }
  }

  if (loading) {
    return <PortalLoadingCard label="Loading messages" />;
  }

  return (
      <div className="space-y-6">
      <PageHeader
        actions={
          <>
          <Button onClick={loadThreads} type="button" variant="secondary">
            Refresh
          </Button>
          <Button onClick={() => setSupportOpen(true)} type="button">
            New support request
          </Button>
          </>
        }
        description="Message your coach, ask for support, and keep replies in one student-safe inbox."
        eyebrow="Student communication"
        metadata={
          <>
            <Badge tone="info">{sortedThreads.length} threads</Badge>
            <Badge tone="outline">No student-to-student chat</Badge>
          </>
        }
        title="Messages"
      />

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <SectionHeader
            actions={<Badge tone="light">{sortedThreads.length}</Badge>}
            description="Support requests and coach replies are listed here."
            title="Your threads"
          />
          <div className="mt-4 space-y-3">
            {sortedThreads.length === 0 ? (
              <PortalEmptyState>
                No messages yet. Start a support request when you need help
                from your coach.
              </PortalEmptyState>
            ) : (
              sortedThreads.map((thread) => {
                const active = selectedThread?.id === thread.id;

                return (
                  <button
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      active
                        ? "border-[#2ECBEA] bg-[#EAF8FC] shadow-sm"
                        : "border-[#D8E8F0] bg-white hover:border-[#2ECBEA]/60",
                    ].join(" ")}
                    disabled={mutating === `select-${thread.id}`}
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    type="button"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={threadTone(thread.thread_type)}>
                        {formatChatType(thread.thread_type)}
                      </Badge>
                      {thread.status !== "active" ? (
                        <Badge tone="staff">{thread.status}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-3 font-semibold text-[#0B1F33]">
                      {thread.title || "Student message"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-[#425B76]">
                      {thread.recent_message || "No messages yet."}
                    </p>
                    <p className="mt-2 text-xs font-medium text-[#66788F]">
                      {formatChatDate(thread.recent_message_at || thread.updated_at)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <Card className="p-5">
          {!selectedThread ? (
            <PortalEmptyState>
              Select a thread or create a new support request.
            </PortalEmptyState>
          ) : (
            <div className="space-y-5">
              <div className="border-b border-[#D8E8F0] pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={threadTone(selectedThread.thread_type)}>
                    {formatChatType(selectedThread.thread_type)}
                  </Badge>
                  <Badge tone={selectedThread.status === "active" ? "success" : "staff"}>
                    {selectedThread.status}
                  </Badge>
                </div>
                <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                  {selectedThread.title || "Student message"}
                </h2>
                <p className="mt-1 text-sm text-[#425B76]">
                  {selectedThread.course_title ||
                    selectedThread.cohort_name ||
                    context.tenant.name}
                </p>
              </div>

              <div className="space-y-4">
                {detailMessages.length === 0 ? (
                  <PortalEmptyState>
                    No messages have been sent in this thread.
                  </PortalEmptyState>
                ) : (
                  detailMessages.map((message) => (
                    <div
                      className={[
                        "rounded-2xl border p-4",
                        messageBubbleClass(message),
                      ].join(" ")}
                      key={message.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
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
                  ))
                )}
              </div>

              <div className="border-t border-[#D8E8F0] pt-5">
                {!replyAllowed ? (
                  <FeedbackAlert tone="warning">
                    This thread is read-only or closed. Replies are not enabled.
                  </FeedbackAlert>
                ) : (
                  <form className="space-y-4" onSubmit={handleSendReply}>
                    <label className="block">
                      <span className="text-sm font-medium text-[#425B76]">
                        Reply
                      </span>
                      <textarea
                        className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                        maxLength={4000}
                        onChange={(event) => setComposer(event.target.value)}
                        placeholder="Write your reply."
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
              </div>
            </div>
          )}
        </Card>
      </div>

      {supportOpen ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge tone="warning">Support request</Badge>
                <h2 className="mt-3 text-2xl font-semibold">
                  Contact your coach
                </h2>
              </div>
              <Button
                onClick={() => setSupportOpen(false)}
                type="button"
                variant="secondary"
              >
                Close
              </Button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={handleCreateSupportThread}>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">Title</span>
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={180}
                  onChange={(event) =>
                    setSupportForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Example: Doubt about tomorrow's live class"
                  required
                  value={supportForm.title}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">
                  Message
                </span>
                <textarea
                  className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={4000}
                  onChange={(event) =>
                    setSupportForm((current) => ({
                      ...current,
                      initialMessage: event.target.value,
                    }))
                  }
                  placeholder="Write your question or support request."
                  required
                  value={supportForm.initialMessage}
                />
              </label>
              <div className="flex justify-end">
                <Button disabled={mutating === "support"} type="submit">
                  {mutating === "support" ? "Creating..." : "Create Request"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
