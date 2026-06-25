"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  createStudentDirectChat,
  formatChatDate,
  formatChatType,
  getTeamChatThreads,
  type AcademyChatThread,
  type AcademyChatThreadType,
} from "@/src/lib/academyChat";
import { getStudentsForTenant, type Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";

type ChatFormState = {
  initialMessage: string;
  studentId: string;
  title: string;
};

const emptyForm: ChatFormState = {
  initialMessage: "",
  studentId: "",
  title: "",
};

const threadFilters: Array<{ label: string; value: AcademyChatThreadType | "all" }> = [
  { label: "All student chats", value: "all" },
  { label: "Direct chats", value: "student_direct" },
  { label: "Support requests", value: "student_support" },
  { label: "Course announcements", value: "course_announcement" },
  { label: "Cohort announcements", value: "cohort_announcement" },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function threadTone(type: AcademyChatThreadType) {
  if (type === "student_support") return "warning" as const;
  if (type === "student_direct") return "trainer" as const;
  return "admin" as const;
}

function statusTone(status: AcademyChatThread["status"]) {
  if (status === "active") return "success" as const;
  if (status === "locked") return "warning" as const;
  return "staff" as const;
}

function getThreadSubtitle(thread: AcademyChatThread) {
  return (
    thread.student_name ||
    thread.course_title ||
    thread.cohort_name ||
    "Student-facing thread"
  );
}

export function MessagesPageClient() {
  const router = useRouter();
  const initialLoadStarted = useRef(false);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState<AcademyChatThreadType | "all">("all");
  const [form, setForm] = useState<ChatFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [threads, setThreads] = useState<AcademyChatThread[]>([]);

  const isOwnerAdmin = role === "owner" || role === "admin";
  const canStartChat = role === "owner" || role === "admin" || role === "trainer";

  const filteredThreads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return threads.filter((thread) => {
      const matchesType = filter === "all" || thread.thread_type === filter;
      const text = [
        thread.title,
        thread.student_name,
        thread.course_title,
        thread.cohort_name,
        thread.recent_message,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesType && (!normalizedSearch || text.includes(normalizedSearch));
    });
  }, [filter, search, threads]);

  const stats = useMemo(
    () => ({
      active: threads.filter((thread) => thread.status === "active").length,
      announcements: threads.filter((thread) =>
        ["course_announcement", "cohort_announcement"].includes(thread.thread_type),
      ).length,
      direct: threads.filter((thread) => thread.thread_type === "student_direct").length,
      support: threads.filter((thread) => thread.thread_type === "student_support").length,
      total: threads.length,
    }),
    [threads],
  );

  const loadMessages = useCallback(async () => {
    setActionError("");
    setLoading(true);

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        router.replace("/onboarding");
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be logged in to use messages.");

      const memberRole = await getCurrentMemberRole(currentTenant.id, user.id);
      const canLoadStudentPicker =
        memberRole === "owner" || memberRole === "admin" || memberRole === "trainer";
      const [chatThreads, tenantStudents] = await Promise.all([
        getTeamChatThreads(currentTenant.id),
        canLoadStudentPicker
          ? getStudentsForTenant(currentTenant.id)
          : Promise.resolve([] as Student[]),
      ]);

      setTenant(currentTenant);
      setRole(memberRole);
      setThreads(chatThreads);
      setStudents(tenantStudents.filter((student) => student.status === "active"));
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to load messages."));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMessages();
  }, [loadMessages]);

  async function handleCreateDirectChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    setActionError("");
    setSuccess("");
    setSaving(true);

    try {
      const threadId = await createStudentDirectChat({
        initialMessage: form.initialMessage,
        studentId: form.studentId,
        tenantId: tenant.id,
        title: form.title,
      });

      setForm(emptyForm);
      setFormOpen(false);
      setSuccess("Student chat created.");
      await loadMessages();
      router.push(`/app/messages/${threadId}`);
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to create student chat."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Academy-student chat
          </Badge>
          <h1 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Messages
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Manage student support requests and direct academy-student
            conversations inside CoachFort. No WhatsApp, email, SMS, or push
            provider is connected in this module.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={loadMessages} type="button" variant="secondary">
            Refresh
          </Button>
          {canStartChat ? (
            <Button onClick={() => setFormOpen(true)} type="button">
              New Student Chat
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", stats.total],
          ["Active", stats.active],
          ["Direct", stats.direct],
          ["Support", stats.support],
          ["Announcements", stats.announcements],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#66788F]">
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#0B1F33]">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
          <input
            className="h-11 rounded-2xl border border-[#D8E8F0] px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student, title, course, or latest message"
            value={search}
          />
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
            onChange={(event) =>
              setFilter(event.target.value as AcademyChatThreadType | "all")
            }
            value={filter}
          >
            {threadFilters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading messages</span>
        </Card>
      ) : filteredThreads.length === 0 ? (
        <EmptyState
          action={
            canStartChat
              ? {
                  label: "New Student Chat",
                  onClick: () => setFormOpen(true),
                }
              : undefined
          }
          description="No visible student-facing chat threads match this view."
          icon="MS"
          title="No student chats yet"
        />
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {filteredThreads.map((thread) => (
            <Link href={`/app/messages/${thread.id}`} key={thread.id}>
              <Card className="h-full border-[#D8E8F0] bg-white p-6 shadow-lg shadow-[#0B2A3D]/5 transition hover:-translate-y-0.5 hover:shadow-xl">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge tone={threadTone(thread.thread_type)}>
                    {formatChatType(thread.thread_type)}
                  </Badge>
                  <Badge tone={statusTone(thread.status)}>{thread.status}</Badge>
                  {!thread.replies_enabled ? (
                    <Badge tone="light">Read only</Badge>
                  ) : null}
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-[#0B1F33]">
                  {thread.title ?? "Student chat"}
                </h2>
                <p className="mt-2 text-sm font-semibold text-[#0E7490]">
                  {getThreadSubtitle(thread)}
                </p>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-[#425B76]">
                  {thread.recent_message || "No messages yet."}
                </p>
                <p className="mt-5 border-t border-[#D8E8F0] pt-4 text-xs font-medium text-[#66788F]">
                  Updated {formatChatDate(thread.updated_at)}
                </p>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#0B2A3D]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/30 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#66788F]">
                  Direct student chat
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                  Start a Student Conversation
                </h2>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8E8F0] text-sm font-semibold text-[#66788F] transition hover:bg-[#F3FAFD] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            {!isOwnerAdmin && role === "trainer" ? (
              <FeedbackAlert tone="warning">
                Trainers can only start chats for students in their assigned
                course or cohort scope. The server enforces this rule.
              </FeedbackAlert>
            ) : null}

            <form className="mt-6 space-y-4" onSubmit={handleCreateDirectChat}>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">Student</span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      studentId: event.target.value,
                    }))
                  }
                  required
                  value={form.studentId}
                >
                  <option value="">Select student</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">Title</span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={180}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Course follow-up"
                  required
                  value={form.title}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">
                  Initial message
                </span>
                <textarea
                  className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={4000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      initialMessage: event.target.value,
                    }))
                  }
                  placeholder="Write the first message."
                  required
                  value={form.initialMessage}
                />
              </label>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Creating..." : "Create Chat"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
