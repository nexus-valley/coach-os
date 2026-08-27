"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  archiveAcademyAnnouncementV2,
  createAcademyAnnouncementV2,
  deleteDraftAcademyAnnouncementV2,
  formatAnnouncementDate,
  getTeamAnnouncementV2,
  getTeamAnnouncementsV2,
  publishAcademyAnnouncementV2,
  updateAcademyAnnouncementV2,
  type AcademyAnnouncementStatus,
  type AnnouncementAudience,
  type AnnouncementWriteInput,
  type TeamAnnouncementDetail,
  type TeamAnnouncementSummary,
} from "@/src/lib/announcements";
import {
  buildAnnouncementCapabilities,
  buildAnnouncementWriteInput,
  canManageAnnouncementScope,
  executeAnnouncementMutation,
  getAnnouncementAudienceLabel,
  getAnnouncementErrorMessage,
  type AnnouncementCapabilities,
  type AnnouncementCapabilityContext,
} from "@/src/lib/announcementManagement";
import { getCohortsForTenant } from "@/src/lib/cohorts";
import { getCoursesForTenant } from "@/src/lib/courses";
import {
  getUserDelegatedPermissions,
  type DelegatedPermission,
} from "@/src/lib/delegatedPermissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";

type StatusFilter = AcademyAnnouncementStatus | "all";
type AudienceFilter = AnnouncementAudience | "all";
type ConfirmationAction = "archive" | "delete" | "publish";

type AnnouncementFormState = {
  audienceType: AnnouncementAudience;
  body: string;
  cohortId: string;
  courseId: string;
  expiresAt: string;
  title: string;
};

const PAGE_SIZE = 25;
const refreshFailureMessage = "The announcement action succeeded, but the latest view could not be refreshed. Refresh the page to see the current state.";
const emptyCapabilities: AnnouncementCapabilities = {
  allowedAudiences: [],
  canCreate: false,
  cohorts: [],
  programs: [],
};
const statusFilters: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];
const audienceFilters: Array<{ label: string; value: AudienceFilter }> = [
  { label: "All audiences", value: "all" },
  { label: "All students", value: "tenant" },
  { label: "Program", value: "program" },
  { label: "Cohort", value: "cohort" },
];

function statusTone(status: AcademyAnnouncementStatus) {
  if (status === "published") return "success" as const;
  if (status === "archived") return "neutral" as const;
  return "warning" as const;
}

function titleCase(value: string) {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function toLocalInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expiry date is invalid.");
  return date.toISOString();
}

function emptyForm(audienceType: AnnouncementAudience): AnnouncementFormState {
  return { audienceType, body: "", cohortId: "", courseId: "", expiresAt: "", title: "" };
}

function detailForm(detail: TeamAnnouncementDetail): AnnouncementFormState {
  return {
    audienceType: detail.audience_type,
    body: detail.body,
    cohortId: detail.cohort_id ?? "",
    courseId: detail.course_id ?? "",
    expiresAt: toLocalInputValue(detail.expires_at),
    title: detail.title,
  };
}

function AccessibleDialog({ children, description, disabled = false, onClose, title }: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const onCloseRef = useRef(onClose);
  const titleId = `announcement-dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    disabledRef.current = disabled;
    onCloseRef.current = onClose;
  }, [disabled, onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabledRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("button, input, select, textarea")?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !disabled) onClose();
      }}
    >
      <div
        aria-describedby={`${titleId}-description`}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold" id={titleId}>{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#526A80]" id={`${titleId}-description`}>{description}</p>
          </div>
          <button aria-label={`Close ${title}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-sm font-semibold text-[#526A80] hover:bg-[#F1F5F9]" disabled={disabled} onClick={onClose} type="button">X</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AnnouncementMetrics({ announcement }: { announcement: TeamAnnouncementSummary | TeamAnnouncementDetail }) {
  return (
    <dl aria-label="Announcement readership" className="grid grid-cols-3 gap-2">
      {[
        ["Recipients", announcement.in_app_recipient_count],
        ["Read", announcement.read_count],
        ["Unread", announcement.unread_count],
      ].map(([label, value]) => (
        <div className="rounded-lg border border-[#D8E8F0] bg-[#F8FBFD] p-3" key={label}>
          <dt className="text-xs font-medium text-[#66788F]">{label}</dt>
          <dd className="mt-1 text-lg font-semibold text-[#0B1F33]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AnnouncementsPageClient() {
  const initialLoadStarted = useRef(false);
  const listRef = useRef<TeamAnnouncementSummary[]>([]);
  const listRequestRef = useRef(0);
  const filtersRef = useRef<{ audience: AudienceFilter; status: StatusFilter }>({ audience: "all", status: "all" });
  const successRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState("");
  const [announcements, setAnnouncements] = useState<TeamAnnouncementSummary[]>([]);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [capabilityContext, setCapabilityContext] = useState<AnnouncementCapabilityContext | null>(null);
  const [capabilityWarning, setCapabilityWarning] = useState("");
  const [confirming, setConfirming] = useState<{ action: ConfirmationAction; announcement: TeamAnnouncementSummary | TeamAnnouncementDetail } | null>(null);
  const [detail, setDetail] = useState<TeamAnnouncementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState<TeamAnnouncementDetail | null>(null);
  const [form, setForm] = useState<AnnouncementFormState>(emptyForm("tenant"));
  const [formOpen, setFormOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [refreshWarning, setRefreshWarning] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const loadList = useCallback(async (params: { append?: boolean; audience?: AudienceFilter; reportError?: boolean; status?: StatusFilter; tenantId?: string } = {}): Promise<boolean> => {
    const tenantId = params.tenantId ?? tenant?.id;
    if (!tenantId) return false;
    const status = params.status ?? filtersRef.current.status;
    const audience = params.audience ?? filtersRef.current.audience;
    const append = params.append ?? false;
    const currentRows = listRef.current;
    const last = append ? currentRows[currentRows.length - 1] : null;
    const requestId = ++listRequestRef.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoadingMore(false);
      setLoading(true);
    }
    setActionError("");
    try {
      const rows = await getTeamAnnouncementsV2({
        audienceType: audience === "all" ? null : audience,
        cursor: last ? { id: last.id, updatedAt: last.updated_at } : null,
        limit: PAGE_SIZE,
        status: status === "all" ? null : status,
        tenantId,
      });
      if (requestId !== listRequestRef.current) return false;
      const nextRows = append ? [...currentRows, ...rows] : rows;
      listRef.current = nextRows;
      setAnnouncements(nextRows);
      setHasMore(rows.length === PAGE_SIZE);
      setRefreshWarning("");
      return true;
    } catch (caught) {
      if (requestId === listRequestRef.current && params.reportError !== false) {
        setActionError(getAnnouncementErrorMessage(caught, "Unable to load announcements."));
      }
      return false;
    } finally {
      if (requestId === listRequestRef.current) {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    }
  }, [tenant?.id]);

  const loadCapabilityContext = useCallback(async (tenantId: string, currentRole: MemberRole | null) => {
    let permissions: DelegatedPermission[] = [];
    let trainerCourseIds: string[] = [];
    let trainerCohortIds: string[] = [];
    if (currentRole === "staff" || currentRole === "trainer") {
      permissions = await getUserDelegatedPermissions(tenantId);
    }
    if (currentRole === "trainer") {
      const scope = await getCurrentTrainerScope(tenantId);
      trainerCourseIds = scope?.courseIds ?? [];
      trainerCohortIds = scope?.cohortIds ?? [];
    }
    const hasPotentialAuthoring = currentRole === "owner" || currentRole === "admin" || permissions.some((permission) => permission.permission_key === "manage_messages");
    const [programs, cohorts] = hasPotentialAuthoring
      ? await Promise.all([getCoursesForTenant(tenantId), getCohortsForTenant(tenantId)])
      : [[], []];
    const context: AnnouncementCapabilityContext = { cohorts, permissions, programs, role: currentRole, trainerCohortIds, trainerCourseIds };
    setCapabilityContext(context);
    setCapabilities(buildAnnouncementCapabilities(context));
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setActionError("");
    try {
      const currentTenant = await getCurrentTenant();
      if (!currentTenant) {
        setTenant(null);
        setAnnouncements([]);
        return;
      }
      const supabase = getSupabaseClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw error ?? new Error("Authentication required.");
      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);
      setTenant(currentTenant);
      setRole(currentRole);
      await Promise.all([
        loadList({ audience: "all", status: "all", tenantId: currentTenant.id }),
        loadCapabilityContext(currentTenant.id, currentRole).catch(() => {
          const context: AnnouncementCapabilityContext = { cohorts: [], permissions: [], programs: [], role: currentRole, trainerCohortIds: [], trainerCourseIds: [] };
          setCapabilityContext(context);
          setCapabilities(currentRole === "owner" || currentRole === "admin" ? { ...emptyCapabilities, allowedAudiences: ["tenant"], canCreate: true } : emptyCapabilities);
          setCapabilityWarning("Some audience choices are unavailable. Refresh before creating or editing a scoped announcement.");
        }),
      ]);
    } catch (caught) {
      setActionError(getAnnouncementErrorMessage(caught, "Unable to load announcements."));
    } finally {
      setLoading(false);
    }
  }, [loadCapabilityContext, loadList]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void bootstrap();
  }, [bootstrap]);

  const canManage = useCallback((announcement: TeamAnnouncementSummary | TeamAnnouncementDetail) => Boolean(capabilityContext && canManageAnnouncementScope(capabilityContext, announcement.audience_type, announcement.course_id, announcement.cohort_id)), [capabilityContext]);

  async function openDetail(announcementId: string) {
    if (!tenant) return;
    setDetailLoading(true);
    setActionError("");
    try {
      const next = await getTeamAnnouncementV2(tenant.id, announcementId);
      if (!next) throw new Error("Announcement not found.");
      setDetail(next);
    } catch (caught) {
      setActionError(getAnnouncementErrorMessage(caught, "Unable to load announcement details."));
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreateForm() {
    const audience = capabilities.allowedAudiences[0];
    if (!audience) return;
    setActionError("");
    setSuccess("");
    setEditing(null);
    setForm(emptyForm(audience));
    setFormOpen(true);
  }

  async function openEditForm(announcementId: string) {
    if (!tenant) return;
    setDetailLoading(true);
    setActionError("");
    try {
      const next = await getTeamAnnouncementV2(tenant.id, announcementId);
      if (!next) throw new Error("Announcement not found.");
      if (next.status === "archived" || !canManage(next)) throw new Error("Permission changed.");
      setEditing(next);
      setForm(detailForm(next));
      setDetail(null);
      setFormOpen(true);
    } catch (caught) {
      setActionError(getAnnouncementErrorMessage(caught, "Unable to edit this announcement."));
      await loadList();
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshCanonical(announcementId?: string) {
    const listRefreshed = await loadList({ reportError: false });
    let detailRefreshed = true;

    if (announcementId && detail?.id === announcementId && tenant) {
      try {
        setDetail(await getTeamAnnouncementV2(tenant.id, announcementId));
      } catch {
        detailRefreshed = false;
      }
    }

    return listRefreshed && detailRefreshed;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant || mutating) return;
    setActionError("");
    setRefreshWarning("");
    setSuccess("");
    setMutating(true);
    let write: AnnouncementWriteInput;

    try {
      write = buildAnnouncementWriteInput({ ...form, body: form.body.trim(), cohorts: capabilities.cohorts, expiresAt: toIsoOrNull(form.expiresAt), title: form.title.trim() });
      if (!write.title || !write.body) throw new Error("Title and message are required.");
      if (/[<>]/.test(write.title) || /[<>]/.test(write.body)) throw new Error("Title and message must use plain text.");
    } catch (caught) {
      setActionError(getAnnouncementErrorMessage(caught, "Unable to save the announcement."));
      setMutating(false);
      return;
    }

    const editingId = editing?.id;
    const outcome = await executeAnnouncementMutation({
      mutate: () => editingId
        ? updateAcademyAnnouncementV2(editingId, write)
        : createAcademyAnnouncementV2(tenant.id, write),
      onMutationSuccess: () => {
        setSuccess(editingId ? "Announcement updated." : "Draft announcement created.");
        setFormOpen(false);
        setEditing(null);
      },
      refresh: () => refreshCanonical(editingId),
    });

    if (!outcome.mutationSucceeded) {
      setActionError(getAnnouncementErrorMessage(outcome.mutationError, "Unable to save the announcement."));
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating(false);
  }

  async function handleConfirmedAction() {
    if (!confirming || mutating) return;
    const { action, announcement } = confirming;
    setMutating(true);
    setActionError("");
    setRefreshWarning("");
    setSuccess("");

    const outcome = await executeAnnouncementMutation({
      mutate: () => action === "publish"
        ? publishAcademyAnnouncementV2(announcement.id)
        : action === "archive"
          ? archiveAcademyAnnouncementV2(announcement.id)
          : deleteDraftAcademyAnnouncementV2(announcement.id),
      onMutationSuccess: () => {
        setSuccess(action === "publish" ? "Announcement published." : action === "archive" ? "Announcement archived." : "Draft announcement deleted.");
        setConfirming(null);
        if (action === "delete") setDetail(null);
      },
      refresh: () => refreshCanonical(action === "delete" ? undefined : announcement.id),
    });

    if (!outcome.mutationSucceeded) {
      setActionError(getAnnouncementErrorMessage(outcome.mutationError));
      setConfirming(null);
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating(false);
  }

  function requestConfirmation(
    action: ConfirmationAction,
    announcement: TeamAnnouncementSummary | TeamAnnouncementDetail,
  ) {
    setDetail(null);
    setConfirming({ action, announcement });
  }

  const filterActive = statusFilter !== "all" || audienceFilter !== "all";
  const selectClass = "h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        actions={<div className="flex flex-wrap gap-2"><Button disabled={loading} onClick={() => void loadList()} type="button" variant="secondary">Refresh</Button>{capabilities.canCreate ? <Button onClick={openCreateForm} type="button">New announcement</Button> : null}</div>}
        description="Share focused updates with all Students, a Program, or a Cohort. Drafts stay private until published."
        eyebrow="Student communication"
        title="Announcements"
      />

      <div aria-live="polite" className="space-y-3">
        {actionError ? <FeedbackAlert onRetry={() => void loadList()}>{actionError}</FeedbackAlert> : null}
        {success ? <div ref={successRef} tabIndex={-1}><FeedbackAlert tone="success">{success}</FeedbackAlert></div> : null}
        {refreshWarning ? <FeedbackAlert tone="warning">{refreshWarning}</FeedbackAlert> : null}
        {capabilityWarning ? <FeedbackAlert tone="warning">{capabilityWarning}</FeedbackAlert> : null}
      </div>

      {!loading && (role === "staff" || role === "trainer") && !capabilities.canCreate ? <FeedbackAlert tone="info">You can browse announcements within your current scope. Creating and managing announcements requires an active messaging delegation and an applicable assignment.</FeedbackAlert> : null}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="announcement-status-filter" label="Status">
            <select className={selectClass} id="announcement-status-filter" onChange={(event) => {
              const next = event.target.value as StatusFilter;
              filtersRef.current.status = next;
              setStatusFilter(next);
              void loadList({ status: next });
            }} value={statusFilter}>{statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </FormField>
          <FormField htmlFor="announcement-audience-filter" label="Audience">
            <select className={selectClass} id="announcement-audience-filter" onChange={(event) => {
              const next = event.target.value as AudienceFilter;
              filtersRef.current.audience = next;
              setAudienceFilter(next);
              void loadList({ audience: next });
            }} value={audienceFilter}>{audienceFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </FormField>
        </div>
      </Card>

      {loading ? (
        <section aria-busy="true" aria-label="Loading announcements" className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((item) => <Card className="h-64 animate-pulse bg-[#F4F8FB]" key={item}><span className="sr-only">Loading</span></Card>)}</section>
      ) : announcements.length === 0 ? (
        <EmptyState action={capabilities.canCreate && !filterActive ? { label: "Create draft", onClick: openCreateForm } : undefined} description={filterActive ? "No announcements match the selected status and audience." : "Announcements help Coaches share important updates with Students."} icon="AN" title={filterActive ? "No matching announcements" : "No announcements yet"} />
      ) : (
        <>
          <section aria-label="Announcement list" className="grid gap-4 lg:grid-cols-2">
            {announcements.map((announcement) => {
              const manageable = canManage(announcement);
              return (
                <Card className="flex min-w-0 flex-col p-5 sm:p-6" key={announcement.id}>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(announcement.status)}>{titleCase(announcement.status)}</Badge><Badge tone="light">{getAnnouncementAudienceLabel(announcement)}</Badge>{announcement.audience_type === "cohort" && announcement.course_title ? <Badge tone="outline">Program: {announcement.course_title}</Badge> : null}</div>
                  <h2 className="mt-4 break-words text-xl font-semibold text-[#0B1F33]">{announcement.title}</h2>
                  <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-[#425B76]">{announcement.body_preview || "No message preview available."}</p>
                  <div className="mt-4 text-xs leading-5 text-[#66788F]"><p>Updated {formatAnnouncementDate(announcement.updated_at)}</p>{announcement.published_at ? <p>Published {formatAnnouncementDate(announcement.published_at)}</p> : null}{announcement.expires_at ? <p>Expires {formatAnnouncementDate(announcement.expires_at)}</p> : null}</div>
                  <div className="mt-5"><AnnouncementMetrics announcement={announcement} /></div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    <Button disabled={detailLoading} onClick={() => void openDetail(announcement.id)} size="sm" type="button" variant="secondary">View details</Button>
                    {manageable && announcement.status !== "archived" ? <Button disabled={detailLoading} onClick={() => void openEditForm(announcement.id)} size="sm" type="button" variant="outline">Edit</Button> : null}
                    {manageable && announcement.status === "draft" ? <Button onClick={() => requestConfirmation("publish", announcement)} size="sm" type="button">Publish</Button> : null}
                    {manageable && announcement.status === "published" ? <Button onClick={() => requestConfirmation("archive", announcement)} size="sm" type="button" variant="outline">Archive</Button> : null}
                    {manageable && announcement.status === "draft" ? <Button onClick={() => requestConfirmation("delete", announcement)} size="sm" type="button" variant="destructive">Delete draft</Button> : null}
                  </div>
                </Card>
              );
            })}
          </section>
          {hasMore ? <div className="flex justify-center"><Button isLoading={loadingMore} loadingText="Loading..." onClick={() => void loadList({ append: true })} type="button" variant="secondary">Load more</Button></div> : null}
        </>
      )}

      {formOpen ? (
        <AccessibleDialog description={editing?.status === "published" ? "Update the message or expiry. The published audience is locked." : "Save a private Draft. Publishing is a separate confirmed action."} disabled={mutating} onClose={() => setFormOpen(false)} title={editing ? "Edit announcement" : "Create announcement"}>
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <FormField htmlFor="announcement-title" label="Title" required><input className={selectClass} id="announcement-title" maxLength={180} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} /></FormField>
            <FormField htmlFor="announcement-message" label="Message" required><textarea className="min-h-40 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10" id="announcement-message" maxLength={6000} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} required value={form.body} /></FormField>
            <FormField description={editing?.status === "published" ? "Audience cannot change after publication." : undefined} htmlFor="announcement-audience" label="Audience" required>
              <select className={selectClass} disabled={editing?.status === "published"} id="announcement-audience" onChange={(event) => setForm((current) => ({ ...current, audienceType: event.target.value as AnnouncementAudience, cohortId: "", courseId: "" }))} value={form.audienceType}>
                {editing?.status === "published" && !capabilities.allowedAudiences.includes(form.audienceType) ? <option value={form.audienceType}>{getAnnouncementAudienceLabel(editing)}</option> : null}
                {capabilities.allowedAudiences.map((audience) => <option key={audience} value={audience}>{audience === "tenant" ? "All students" : titleCase(audience)}</option>)}
              </select>
            </FormField>
            {form.audienceType === "program" ? <FormField htmlFor="announcement-program" label="Program" required><select className={selectClass} disabled={editing?.status === "published"} id="announcement-program" onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))} required value={form.courseId}><option value="">Select a Program</option>{editing?.status === "published" && form.courseId && !capabilities.programs.some((program) => program.id === form.courseId) ? <option value={form.courseId}>{editing.course_title ?? "Selected Program"}</option> : null}{capabilities.programs.map((program) => <option key={program.id} value={program.id}>{program.label}</option>)}</select></FormField> : null}
            {form.audienceType === "cohort" ? <FormField description="Program context is shown to distinguish Cohorts with similar names." htmlFor="announcement-cohort" label="Cohort" required><select className={selectClass} disabled={editing?.status === "published"} id="announcement-cohort" onChange={(event) => setForm((current) => ({ ...current, cohortId: event.target.value }))} required value={form.cohortId}><option value="">Select a Cohort</option>{editing?.status === "published" && form.cohortId && !capabilities.cohorts.some((cohort) => cohort.id === form.cohortId) ? <option value={form.cohortId}>{editing.cohort_name ?? "Selected Cohort"} - {editing.course_title ?? "Program unavailable"}</option> : null}{capabilities.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.label} - {cohort.programLabel}</option>)}</select></FormField> : null}
            <FormField description="Optional. Students cannot see the announcement after this time." htmlFor="announcement-expiry" label="Expiry"><input className={selectClass} id="announcement-expiry" min={toLocalInputValue(new Date().toISOString())} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} type="datetime-local" value={form.expiresAt} /></FormField>
            <div className="flex flex-col-reverse gap-3 border-t border-[#D8E8F0] pt-5 sm:flex-row sm:justify-end"><Button disabled={mutating} onClick={() => setFormOpen(false)} type="button" variant="secondary">Cancel</Button><Button isLoading={mutating} loadingText="Saving..." type="submit">{editing ? "Save changes" : "Create draft"}</Button></div>
          </form>
        </AccessibleDialog>
      ) : null}

      {detail ? (
        <AccessibleDialog description="Announcement content, audience, lifecycle, and in-app readership." onClose={() => setDetail(null)} title="Announcement details">
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap gap-2"><Badge tone={statusTone(detail.status)}>{titleCase(detail.status)}</Badge><Badge tone="light">{getAnnouncementAudienceLabel(detail)}</Badge>{detail.audience_type === "cohort" && detail.course_title ? <Badge tone="outline">Program: {detail.course_title}</Badge> : null}</div>
            <div><h3 className="break-words text-xl font-semibold">{detail.title}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#334155]">{detail.body}</p></div>
            <AnnouncementMetrics announcement={detail} />
            <dl className="grid gap-3 border-t border-[#D8E8F0] pt-4 text-sm sm:grid-cols-2"><div><dt className="font-medium text-[#66788F]">Created</dt><dd>{formatAnnouncementDate(detail.created_at)}</dd></div><div><dt className="font-medium text-[#66788F]">Updated</dt><dd>{formatAnnouncementDate(detail.updated_at)}</dd></div><div><dt className="font-medium text-[#66788F]">Published</dt><dd>{formatAnnouncementDate(detail.published_at)}</dd></div><div><dt className="font-medium text-[#66788F]">Expiry</dt><dd>{formatAnnouncementDate(detail.expires_at)}</dd></div></dl>
            {canManage(detail) ? <div className="flex flex-wrap gap-2 border-t border-[#D8E8F0] pt-5">{detail.status !== "archived" ? <Button onClick={() => void openEditForm(detail.id)} size="sm" type="button" variant="secondary">Edit</Button> : null}{detail.status === "draft" ? <Button onClick={() => requestConfirmation("publish", detail)} size="sm" type="button">Publish</Button> : null}{detail.status === "published" ? <Button onClick={() => requestConfirmation("archive", detail)} size="sm" type="button" variant="outline">Archive</Button> : null}{detail.status === "draft" ? <Button onClick={() => requestConfirmation("delete", detail)} size="sm" type="button" variant="destructive">Delete draft</Button> : null}</div> : null}
          </div>
        </AccessibleDialog>
      ) : null}

      {confirming ? (
        <AccessibleDialog description={confirming.action === "publish" ? "The announcement becomes visible to its selected audience. Eligible Students may receive an in-app notification, and the audience cannot change afterward." : confirming.action === "archive" ? "Archived announcements are removed from Student visibility. Archived is a terminal state." : "This permanently deletes the Draft. Published and Archived announcements cannot be deleted here."} disabled={mutating} onClose={() => setConfirming(null)} title={confirming.action === "publish" ? "Publish announcement?" : confirming.action === "archive" ? "Archive announcement?" : "Delete Draft?"}>
          <p className="mt-5 break-words text-sm font-semibold text-[#0B1F33]">{confirming.announcement.title}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button disabled={mutating} onClick={() => setConfirming(null)} type="button" variant="secondary">Cancel</Button><Button isLoading={mutating} loadingText="Working..." onClick={() => void handleConfirmedAction()} type="button" variant={confirming.action === "delete" ? "destructive" : "primary"}>{confirming.action === "publish" ? "Publish" : confirming.action === "archive" ? "Archive" : "Delete Draft"}</Button></div>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
