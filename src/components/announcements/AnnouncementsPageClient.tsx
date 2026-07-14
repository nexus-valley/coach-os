"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  archiveAcademyAnnouncement,
  createAcademyAnnouncement,
  formatAnnouncementDate,
  getTeamAnnouncements,
  publishAcademyAnnouncement,
  updateAcademyAnnouncement,
  type AcademyAnnouncement,
  type AcademyAnnouncementStatus,
} from "@/src/lib/announcements";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";

type FilterStatus = AcademyAnnouncementStatus | "all";

type FormState = {
  body: string;
  expiresAt: string;
  title: string;
};

const emptyForm: FormState = {
  body: "",
  expiresAt: "",
  title: "",
};

const statusFilters: Array<{ label: string; value: FilterStatus }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];

function canManageAnnouncements(role: MemberRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function statusTone(status: AcademyAnnouncementStatus) {
  if (status === "published") return "success" as const;
  if (status === "archived") return "staff" as const;
  return "warning" as const;
}

function toLocalInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

  return offsetDate.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Expiry date is invalid.");
  }

  return date.toISOString();
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
}

export function AnnouncementsPageClient() {
  const initialLoadStarted = useRef(false);
  const [actionError, setActionError] = useState("");
  const [announcements, setAnnouncements] = useState<AcademyAnnouncement[]>([]);
  const [editing, setEditing] = useState<AcademyAnnouncement | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [role, setRole] = useState<MemberRole | null>(null);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canManage = canManageAnnouncements(role);
  const filteredAnnouncements = useMemo(
    () =>
      announcements.filter(
        (announcement) => filter === "all" || announcement.status === filter,
      ),
    [announcements, filter],
  );
  const stats = useMemo(
    () => ({
      archived: announcements.filter((item) => item.status === "archived").length,
      draft: announcements.filter((item) => item.status === "draft").length,
      published: announcements.filter((item) => item.status === "published").length,
      total: announcements.length,
    }),
    [announcements],
  );

  const loadAnnouncements = useCallback(async () => {
    setActionError("");
    setLoading(true);

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setTenant(null);
        setAnnouncements([]);
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

      if (!user) {
        throw new Error("You must be logged in to manage announcements.");
      }

      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

      setTenant(currentTenant);
      setRole(currentRole);

      if (!canManageAnnouncements(currentRole)) {
        setAnnouncements([]);
        return;
      }

      const nextAnnouncements = await getTeamAnnouncements(currentTenant.id);
      setAnnouncements(nextAnnouncements);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load announcements."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void loadAnnouncements();
  }, [loadAnnouncements]);

  function openCreateForm() {
    setActionError("");
    setSuccess("");
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(announcement: AcademyAnnouncement) {
    setActionError("");
    setSuccess("");
    setEditing(announcement);
    setForm({
      body: announcement.body,
      expiresAt: toLocalInputValue(announcement.expires_at),
      title: announcement.title,
    });
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    if (!isPlainText(form.title) || !isPlainText(form.body)) {
      setActionError("Announcements must use plain text without HTML.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("save");

    try {
      const expiresAt = toIsoOrNull(form.expiresAt);

      if (editing) {
        await updateAcademyAnnouncement(
          editing.id,
          form.title,
          form.body,
          expiresAt,
        );
        setSuccess("Announcement updated.");
      } else {
        await createAcademyAnnouncement(
          tenant.id,
          form.title,
          form.body,
          expiresAt,
        );
        setSuccess("Draft announcement created.");
      }

      setForm(emptyForm);
      setEditing(null);
      setFormOpen(false);
      await loadAnnouncements();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save announcement."));
    } finally {
      setMutating("");
    }
  }

  async function handlePublish(announcementId: string) {
    setActionError("");
    setSuccess("");
    setMutating(`publish-${announcementId}`);

    try {
      await publishAcademyAnnouncement(announcementId);
      setSuccess("Announcement published.");
      await loadAnnouncements();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to publish announcement."));
    } finally {
      setMutating("");
    }
  }

  async function handleArchive(announcementId: string) {
    setActionError("");
    setSuccess("");
    setMutating(`archive-${announcementId}`);

    try {
      await archiveAcademyAnnouncement(announcementId);
      setSuccess("Announcement archived.");
      await loadAnnouncements();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to archive announcement."));
    } finally {
      setMutating("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            <Button onClick={loadAnnouncements} type="button" variant="secondary">
              Refresh
            </Button>
            {canManage ? (
              <Button onClick={openCreateForm} type="button">
                New announcement
              </Button>
            ) : null}
          </>
        }
        description="Create plain-text academy announcements for all students. Students see only published, non-expired announcements."
        eyebrow="Student communication"
        metadata={
          <>
            <Badge tone="info">All students audience</Badge>
            <Badge tone="outline">No comments or reactions</Badge>
          </>
        }
        title="Academy announcements"
      />

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      {!loading && !canManage ? (
        <FeedbackAlert tone="warning">
          Only owner, admin, or staff users can manage academy announcements.
          Announcement access is enforced again by the server.
        </FeedbackAlert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Draft" value={stats.draft} />
        <StatCard label="Published" value={stats.published} />
        <StatCard label="Archived" value={stats.archived} />
      </section>

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            description="Filter drafts, published updates, and archived notices."
            title="Announcement board"
          />
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
            onChange={(event) => setFilter(event.target.value as FilterStatus)}
            value={filter}
          >
            {statusFilters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <Card className="h-64 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading announcements</span>
        </Card>
      ) : filteredAnnouncements.length === 0 ? (
        <EmptyState
          action={
            canManage
              ? {
                  label: "Create draft",
                  onClick: openCreateForm,
                }
              : undefined
          }
          description="No announcements match the selected view."
          icon="AN"
          title="No announcements yet"
        />
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {filteredAnnouncements.map((announcement) => (
            <Card
              className="border-[#D8E8F0] bg-white p-6"
              key={announcement.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(announcement.status)}>
                  {announcement.status}
                </Badge>
                <Badge tone="light">All students</Badge>
                {announcement.expires_at ? (
                  <Badge tone="outline">
                    Expires {formatAnnouncementDate(announcement.expires_at)}
                  </Badge>
                ) : null}
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
                {announcement.title}
              </h2>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                {announcement.body}
              </p>
              <div className="mt-5 grid gap-3 border-t border-[#D8E8F0] pt-4 text-xs font-medium text-[#66788F] sm:grid-cols-2">
                <p>Created {formatAnnouncementDate(announcement.created_at)}</p>
                <p>
                  Published {formatAnnouncementDate(announcement.published_at)}
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {announcement.status !== "archived" ? (
                  <Button
                    onClick={() => openEditForm(announcement)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                ) : null}
                {announcement.status === "draft" ? (
                  <Button
                    disabled={mutating === `publish-${announcement.id}`}
                    onClick={() => handlePublish(announcement.id)}
                    size="sm"
                    type="button"
                  >
                    {mutating === `publish-${announcement.id}`
                      ? "Publishing..."
                      : "Publish"}
                  </Button>
                ) : null}
                {announcement.status !== "archived" ? (
                  <Button
                    disabled={mutating === `archive-${announcement.id}`}
                    onClick={() => handleArchive(announcement.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {mutating === `archive-${announcement.id}`
                      ? "Archiving..."
                      : "Archive"}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge tone="info">
                  {editing ? "Edit announcement" : "Draft announcement"}
                </Badge>
                <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                  {editing ? "Update announcement" : "Create announcement"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#425B76]">
                  Plain text only. Students can read the announcement after it
                  is published.
                </p>
              </div>
              <Button
                onClick={() => setFormOpen(false)}
                type="button"
                variant="secondary"
              >
                Close
              </Button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <FormField
                description="Keep titles short and student-facing."
                label="Title"
                required
              >
                <input
                  className="h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={180}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Example: Schedule update for this week"
                  required
                  value={form.title}
                />
              </FormField>
              <FormField
                description="HTML, links, attachments, comments, and reactions are not part of this MVP."
                label="Body"
                required
              >
                <textarea
                  className="min-h-40 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={6000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  placeholder="Write the announcement in plain text."
                  required
                  value={form.body}
                />
              </FormField>
              <FormField
                description="Optional. Leave empty for no expiry."
                label="Expires at"
              >
                <input
                  className="h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      expiresAt: event.target.value,
                    }))
                  }
                  type="datetime-local"
                  value={form.expiresAt}
                />
              </FormField>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating === "save"} type="submit">
                  {mutating === "save"
                    ? "Saving..."
                    : editing
                      ? "Save changes"
                      : "Create draft"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
