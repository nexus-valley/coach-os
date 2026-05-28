"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  createConversationThread,
  isConversationSystemAvailable,
  safeGetConversationThreads,
  type ConversationThreadType,
  type ConversationThreadWithMeta,
} from "@/src/lib/conversations";
import { safeGetUnreadThreadCount } from "@/src/lib/messages";
import {
  logOptionalQueryFailure,
  safeOptionalQuery,
} from "@/src/lib/optionalQuery";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { getTenantMembers, type TenantMemberWithProfile } from "@/src/lib/team";

type ThreadFormState = {
  cohortId: string;
  courseId: string;
  description: string;
  participantUserId: string;
  threadType: ConversationThreadType;
  title: string;
};

const emptyForm: ThreadFormState = {
  cohortId: "",
  courseId: "",
  description: "",
  participantUserId: "",
  threadType: "announcement",
  title: "",
};

const threadTypeOptions: { label: string; value: ConversationThreadType | "all" }[] = [
  { label: "All threads", value: "all" },
  { label: "Announcements", value: "announcement" },
  { label: "Course discussions", value: "course_discussion" },
  { label: "Cohort discussions", value: "cohort_discussion" },
  { label: "Direct messages", value: "direct_message" },
  { label: "Staff notes", value: "staff_note" },
];

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

function typeTone(type: ConversationThreadType) {
  if (type === "announcement") {
    return "admin";
  }

  if (type === "staff_note") {
    return "warning";
  }

  if (type === "direct_message") {
    return "trainer";
  }

  return "light";
}

export function MessagesPageClient() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState("");
  const [conversationAvailable, setConversationAvailable] = useState(true);
  const [filter, setFilter] = useState<ConversationThreadType | "all">("all");
  const [form, setForm] = useState<ThreadFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TenantMemberWithProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [threads, setThreads] = useState<ConversationThreadWithMeta[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadWorkspace = useCallback(async (
    currentTenant: Tenant,
    nextFilter: ConversationThreadType | "all" = filter,
  ) => {
    const [available, rows, tenantCourses, tenantCohorts, tenantMembers, unread] =
      await Promise.all([
        safeOptionalQuery(
          {
            area: "messages.loadWorkspace",
            helper: "isConversationSystemAvailable",
            table: "conversation_threads",
          },
          () => isConversationSystemAvailable(currentTenant.id),
          false,
        ),
        safeOptionalQuery<ConversationThreadWithMeta[]>(
          {
            area: "messages.loadWorkspace",
            helper: "safeGetConversationThreads",
            table: "conversation_threads",
          },
          () =>
            safeGetConversationThreads(currentTenant.id, {
              threadType: nextFilter,
            }),
          [],
        ),
        safeOptionalQuery<Course[]>(
          {
            area: "messages.loadWorkspace",
            helper: "getCoursesForTenant",
            table: "courses",
          },
          () => getCoursesForTenant(currentTenant.id),
          [],
        ),
        safeOptionalQuery<CohortWithCourse[]>(
          {
            area: "messages.loadWorkspace",
            helper: "getCohortsForTenant",
            table: "cohorts",
          },
          () => getCohortsForTenant(currentTenant.id),
          [],
        ),
        safeOptionalQuery<TenantMemberWithProfile[]>(
          {
            area: "messages.loadWorkspace",
            helper: "getTenantMembers",
            table: "tenant_members",
          },
          () => getTenantMembers(currentTenant.id),
          [],
        ),
        safeOptionalQuery(
          {
            area: "messages.loadWorkspace",
            helper: "safeGetUnreadThreadCount",
            table: "conversation_messages",
          },
          () => safeGetUnreadThreadCount(currentTenant.id),
          0,
        ),
      ]);

    setConversationAvailable(available);
    setThreads(rows);
    setCourses(tenantCourses);
    setCohorts(tenantCohorts);
    setMembers(tenantMembers);
    setUnreadCount(unread);
  }, [filter]);

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

        setTenant(currentTenant);
        await loadWorkspace(currentTenant);
      } catch (caught) {
        if (active) {
          logOptionalQueryFailure(
            {
              area: "messages.pageLoad",
              helper: "load",
              table: "workspace/messages",
            },
            caught,
          );
          setError(getErrorMessage(caught, "Unable to load messages."));
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
  }, [loadWorkspace, router]);

  const filteredMembers = useMemo(
    () =>
      members.map((member) => ({
        label:
          member.profile?.full_name ||
          member.profile?.email ||
          `${formatType(member.role)} user`,
        value: member.user_id,
      })),
    [members],
  );

  async function refresh(nextFilter = filter) {
    if (!tenant) {
      return;
    }

    await loadWorkspace(tenant, nextFilter);
  }

  async function handleFilterChange(nextFilter: ConversationThreadType | "all") {
    setFilter(nextFilter);
    await refresh(nextFilter);
  }

  async function handleCreateThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const thread = await createConversationThread({
        cohortId: form.cohortId || null,
        courseId: form.courseId || null,
        description: form.description,
        participantUserIds: form.participantUserId
          ? [form.participantUserId]
          : [],
        tenantId: tenant.id,
        threadType: form.threadType,
        title: form.title,
      });

      setForm(emptyForm);
      setFormOpen(false);
      await refresh();
      setSuccess("Conversation created.");
      router.push(`/app/messages/${thread.id}`);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to create conversation."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Communication center
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Messages
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
            Tenant-scoped announcements, discussions, direct messages, and
            internal notes without real-time dependencies.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={unreadCount > 0 ? "warning" : "light"}>
            {unreadCount} unread
          </Badge>
          {conversationAvailable ? (
            <Button onClick={() => setFormOpen(true)}>New Conversation</Button>
          ) : null}
        </div>
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 shadow-2xl shadow-[#0B2A3D]/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[#425B76]">Workspace</p>
            <p className="mt-1 text-xl font-semibold text-[#0B1F33]">
              {tenant?.name ?? "Current workspace"}
            </p>
          </div>
          <label className="block sm:w-72">
            <span className="text-sm font-medium text-[#425B76]">Type</span>
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
              onChange={(event) =>
                handleFilterChange(event.target.value as ConversationThreadType | "all")
              }
              value={filter}
            >
              {threadTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => refresh()}>{error}</FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <Card className="mt-6 h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading messages</span>
        </Card>
      ) : !conversationAvailable ? (
        <EmptyState
          description="Message infrastructure is not available yet. Run the Module 36 chat SQL migration to enable conversations."
          icon="MS"
          title="Messages are not configured"
        />
      ) : threads.length === 0 ? (
        <EmptyState
          action={{
            label: "New Conversation",
            onClick: () => setFormOpen(true),
          }}
          description="Create an announcement, course discussion, cohort discussion, direct message, or internal staff note."
          icon="MS"
          title="No conversations yet"
        />
      ) : (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {threads.map((thread) => (
            <Link href={`/app/messages/${thread.id}`} key={thread.id}>
              <Card className="h-full border-[#D8E8F0] bg-white p-6 shadow-lg shadow-[#0B2A3D]/5 transition hover:-translate-y-0.5 hover:shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={typeTone(thread.thread_type)}>
                      {formatType(thread.thread_type)}
                    </Badge>
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
                  {thread.unreadCount > 0 ? (
                    <Badge tone="warning">{thread.unreadCount} unread</Badge>
                  ) : null}
                </div>
                <h3 className="mt-5 text-2xl font-semibold text-[#0B1F33]">
                  {thread.title ?? "Untitled conversation"}
                </h3>
                <p className="mt-2 text-sm font-semibold text-[#0E7490]">
                  {thread.course?.title ||
                    thread.cohort?.name ||
                    thread.student?.full_name ||
                    "Workspace thread"}
                </p>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-[#425B76]">
                  {thread.recentMessage?.message ||
                    thread.description ||
                    "No messages yet."}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#D8E8F0] pt-4 text-xs font-medium text-[#66788F]">
                  <span>{thread.participantCount} participants</span>
                  <span>Updated {formatDate(thread.updated_at)}</span>
                </div>
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
                  Communication
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[#0B1F33]">
                  New Conversation
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8E8F0] text-sm font-semibold text-[#66788F] transition hover:bg-[#F3FAFD] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateThread}>
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">Title</span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Weekly cohort announcement"
                  required
                  value={form.title}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Type</span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        threadType: event.target.value as ConversationThreadType,
                      }))
                    }
                    value={form.threadType}
                  >
                    {threadTypeOptions
                      .filter((option) => option.value !== "all")
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">
                    Direct participant
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        participantUserId: event.target.value,
                      }))
                    }
                    value={form.participantUserId}
                  >
                    <option value="">No direct participant</option>
                    {filteredMembers.map((member) => (
                      <option key={member.value} value={member.value}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Course</span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, courseId: event.target.value }))
                    }
                    value={form.courseId}
                  >
                    <option value="">No course</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Cohort</span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) => {
                      const cohort = cohorts.find(
                        (item) => item.id === event.target.value,
                      );
                      setForm((current) => ({
                        ...current,
                        cohortId: event.target.value,
                        courseId: cohort?.course_id ?? current.courseId,
                      }));
                    }}
                    value={form.cohortId}
                  >
                    <option value="">No cohort</option>
                    {cohorts.map((cohort) => (
                      <option key={cohort.id} value={cohort.id}>
                        {cohort.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Context for this thread."
                  value={form.description}
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
                  {saving ? "Creating..." : "Create Conversation"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
