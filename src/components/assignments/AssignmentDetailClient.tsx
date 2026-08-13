"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getSafeAssignmentError } from "@/src/lib/assignmentErrors";
import { getAssignmentDetailLifecycleUi } from "@/src/lib/assignmentDetailLifecycle";
import {
  canRoleManageAssignments,
  closeAssignment,
  publishAssignment,
  type AssignmentStatus,
  type AssignmentWithRelations,
} from "@/src/lib/assignments";
import {
  delegatedPermissionMatchesAssignment,
  filterAssignmentReviewRoster,
  getAssignmentReviewPresentation,
  getNextAwaitingReviewStudentId,
  type AssignmentReviewFilter,
} from "@/src/lib/assignmentReviewModel";
import {
  getUserDelegatedPermissions,
  type DelegatedPermission,
} from "@/src/lib/delegatedPermissions";
import { canAccessAttendance } from "@/src/lib/permissions";
import {
  getAssignmentSubmissionRoster,
  isStaleAssignmentReviewError,
  reviewSubmission,
  staleAssignmentReviewMessage,
  submitAssignment,
  type AssignmentRosterItem,
  type AssignmentSubmissionSummary,
} from "@/src/lib/submissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type AssignmentDetailClientProps = { assignmentId: string };
type SubmissionDraft = Record<string, { feedback: string; score: string; submissionText: string }>;

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusTone(status: AssignmentStatus) {
  return status === "published" ? "success" : status === "closed" ? "danger" : "warning";
}

function buildDraft(roster: AssignmentRosterItem[]) {
  return roster.reduce<SubmissionDraft>((result, item) => {
    result[item.student.id] = {
      feedback: item.submission?.feedback ?? "",
      score: item.submission?.score?.toString() ?? "",
      submissionText: item.submission?.submission_text ?? "",
    };
    return result;
  }, {});
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4"><p className="text-2xl font-semibold text-[#0B1F33]">{value}</p><p className="mt-1 text-sm text-[#66788F]">{label}</p></div>;
}

export function AssignmentDetailClient({ assignmentId }: AssignmentDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [assignment, setAssignment] = useState<AssignmentWithRelations | null>(null);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [delegatedPermissions, setDelegatedPermissions] = useState<DelegatedPermission[]>([]);
  const [draft, setDraft] = useState<SubmissionDraft>({});
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<AssignmentReviewFilter>("all");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [roster, setRoster] = useState<AssignmentRosterItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState<AssignmentSubmissionSummary | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canAccessAttendance(currentRole);
  const baseCanManage = canRoleManageAssignments(currentRole);
  const lifecycleUi = getAssignmentDetailLifecycleUi(assignment?.status);
  const assignmentManageDelegation = Boolean(
    assignment && delegatedPermissions.some(
      (permission) => permission.permission_key === "manage_assignments" && delegatedPermissionMatchesAssignment(permission, assignment),
    ),
  );
  const canManage = baseCanManage || assignmentManageDelegation;
  const canPublish = canManage && lifecycleUi.canPublish;
  const canClose = canManage && lifecycleUi.canClose;
  const canCreateSubmission =
    (currentRole === "owner" || currentRole === "admin") && lifecycleUi.canCaptureSubmission;

  const loadDetail = useCallback(async (currentTenant: Tenant) => {
    const data = await getAssignmentSubmissionRoster({ assignmentId, tenantId: currentTenant.id });
    setAssignment(data.assignment);
    setRoster(data.roster);
    setSummary(data.summary);
    setDraft(buildDraft(data.roster));
    setSelectedStudentId((current) =>
      current && data.roster.some((item) => item.student.id === current)
        ? current
        : data.roster[0]?.student.id ?? null,
    );
    return data;
  }, [assignmentId]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const currentTenant = await getCurrentTenant();
        if (!active) return;
        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const supabase = getSupabaseClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const role = user ? await getCurrentMemberRole(currentTenant.id, user.id) : null;
        setTenant(currentTenant);
        setCurrentRole(role);

        if (canAccessAttendance(role)) {
          const [detail, delegated] = await Promise.all([
            loadDetail(currentTenant),
            user ? getUserDelegatedPermissions(currentTenant.id, user.id).catch(() => []) : Promise.resolve([]),
          ]);
          if (!active) return;
          setDelegatedPermissions(delegated);
          if (!detail.assignment) setError("Assignment unavailable.");
        }
      } catch (caught) {
        if (active) setError(getSafeAssignmentError(caught));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [assignmentId, loadDetail, router]);

  const visibleRoster = useMemo(
    () => filterAssignmentReviewRoster(roster, assignment?.status, filter),
    [assignment?.status, filter, roster],
  );
  const selectedItem = roster.find((item) => item.student.id === selectedStudentId) ?? null;
  const nextAwaitingId = getNextAwaitingReviewStudentId(roster, selectedStudentId);
  const submissionRate = summary?.submissionRate === null || !summary ? "No data" : `${summary.submissionRate}%`;

  function canReviewItem(item: AssignmentRosterItem) {
    if (!assignment || !lifecycleUi.canReview || !item.submission) return false;
    if (baseCanManage) return true;
    return delegatedPermissions.some(
      (permission) =>
        ["manage_assignments", "review_assignments"].includes(permission.permission_key) &&
        delegatedPermissionMatchesAssignment(permission, assignment, item.student.id),
    );
  }

  async function refresh() {
    if (!tenant) return null;
    return loadDetail(tenant);
  }

  async function updateStatus(nextStatus: "closed" | "published") {
    if (!tenant || !canManage) {
      setActionError("You do not have permission for this assignment.");
      return;
    }
    const allowed = nextStatus === "published" ? lifecycleUi.canPublish : lifecycleUi.canClose;
    if (!allowed) {
      setActionError("Assignment state changed. Reload before continuing.");
      return;
    }
    setMutating(nextStatus);
    setActionError("");
    setSuccess("");
    try {
      if (nextStatus === "published") await publishAssignment({ assignmentId, tenantId: tenant.id });
      else await closeAssignment({ assignmentId, tenantId: tenant.id });
      await refresh();
      setSuccess(nextStatus === "published" ? "Assignment published." : "Assignment closed.");
    } catch (caught) {
      setActionError(getSafeAssignmentError(caught, "Assignment state could not be changed."));
    } finally {
      setMutating("");
    }
  }

  async function recordMissingSubmission(item: AssignmentRosterItem) {
    if (!tenant || !canCreateSubmission || item.submission) {
      setActionError("A missing submission cannot be recorded for this student.");
      return;
    }
    setMutating(`submit-${item.student.id}`);
    setActionError("");
    setSuccess("");
    try {
      await submitAssignment({
        assignmentId,
        studentId: item.student.id,
        submissionText: draft[item.student.id]?.submissionText ?? "",
        tenantId: tenant.id,
      });
      await refresh();
      setSuccess("Missing submission recorded.");
    } catch (caught) {
      setActionError(getSafeAssignmentError(caught, "Submission could not be recorded."));
    } finally {
      setMutating("");
    }
  }

  async function saveReview(item: AssignmentRosterItem) {
    if (!tenant || !canReviewItem(item)) {
      setActionError("You do not have permission for this assignment.");
      return;
    }
    if (!item.submission?.updated_at) {
      setActionError("Reload this assignment before reviewing the submission.");
      return;
    }
    setMutating(`review-${item.student.id}`);
    setActionError("");
    setSuccess("");
    try {
      await reviewSubmission({
        assignmentId,
        expectedSubmissionUpdatedAt: item.submission.updated_at,
        feedback: draft[item.student.id]?.feedback ?? "",
        score: draft[item.student.id]?.score ?? null,
        studentId: item.student.id,
        tenantId: tenant.id,
      });
      await refresh();
      setSuccess("Submission reviewed.");
    } catch (caught) {
      if (isStaleAssignmentReviewError(caught)) {
        setDraft({});
        await refresh().catch(() => undefined);
        setActionError(staleAssignmentReviewMessage);
      } else {
        setActionError(getSafeAssignmentError(caught, "Review could not be saved."));
      }
    } finally {
      setMutating("");
    }
  }

  if (loading) return <div className="mx-auto max-w-7xl"><Card className="h-72 animate-pulse border-[#D8E8F0] bg-white"><span className="sr-only">Loading assignment</span></Card></div>;
  if (!currentRole || !canAccess) return <AccessDeniedCard description="You do not have permission to access assignments." />;
  if (error || !assignment) return <div className="mx-auto max-w-7xl"><Card className="border-[#D8E8F0] bg-white p-8"><p className="text-sm font-semibold text-[#66788F]">Assignment detail</p><h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">{error || "Assignment unavailable."}</h2><Button className="mt-6" href="/app/assignments">Back to assignments</Button></Card></div>;

  return (
    <div className="mx-auto max-w-7xl">
      <Link className="text-sm font-semibold text-[#425B76] hover:text-[#0B1F33]" href="/app/assignments">Back to assignments</Link>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.38fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><Badge tone={statusTone(assignment.status)}>{assignment.status}</Badge><h2 className="mt-5 text-3xl font-semibold leading-tight text-[#0B1F33] sm:text-4xl">{assignment.title}</h2><p className="mt-3 text-sm font-semibold text-[#0E7490]">{assignment.cohort?.name ?? assignment.course?.title ?? "General assignment"}</p></div>{canPublish || canClose ? <div className="flex flex-wrap gap-2">{canPublish ? <Button disabled={mutating === "published"} onClick={() => void updateStatus("published")} size="sm" variant="secondary">Publish</Button> : null}{canClose ? <Button disabled={mutating === "closed"} onClick={() => void updateStatus("closed")} size="sm" variant="ghost">Close</Button> : null}</div> : null}</div>
          <p className="mt-7 max-w-3xl text-sm leading-6 text-[#425B76]">{assignment.description || "No assignment summary added yet."}</p><p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-[#425B76]">{assignment.instructions || "No detailed instructions added yet."}</p>
          <div className="mt-8 grid gap-4 border-t border-[#D8E8F0] pt-6 sm:grid-cols-2"><div><p className="text-sm text-[#66788F]">Due</p><p className="mt-2 font-semibold text-[#0B1F33]">{assignment.due_at ? formatDateTime(assignment.due_at) : "No due date"}</p></div><div><p className="text-sm text-[#66788F]">Max score</p><p className="mt-2 font-semibold text-[#0B1F33]">{assignment.max_score ?? "Not graded"}</p></div></div>
        </Card>
        <Card className="border-[#D8E8F0] bg-white p-6"><p className="text-sm font-semibold text-[#66788F]">Submission rate</p><h3 className="mt-3 text-3xl font-semibold text-[#0B1F33]">{submissionRate}</h3><p className="mt-3 text-sm leading-6 text-[#425B76]">Persisted submissions remain visible for historical review.</p></Card>
      </section>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><SummaryCard label="Roster" value={summary?.total ?? 0} /><SummaryCard label="Submitted" value={summary?.submitted ?? 0} /><SummaryCard label="Late" value={summary?.late ?? 0} /><SummaryCard label="Reviewed" value={summary?.reviewed ?? 0} /><SummaryCard label="Avg score" value={summary?.averageScore ?? "N/A"} /></section>
      {actionError ? <div className="mt-6"><FeedbackAlert>{actionError}</FeedbackAlert></div> : null}
      {success ? <div className="mt-6"><FeedbackAlert tone="success">{success}</FeedbackAlert></div> : null}

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <Card className="border-[#D8E8F0] bg-white p-5 sm:p-6">
          <Badge tone="light">Submission review</Badge><h3 className="mt-4 text-2xl font-semibold text-[#0B1F33]">Student submissions</h3>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1"><span className="text-sm font-medium text-[#425B76]">Roster filter</span><select className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] px-3 text-sm" onChange={(event) => setFilter(event.target.value as AssignmentReviewFilter)} value={filter}><option value="all">All</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="not_submitted">Not submitted</option></select></label>
            <Button disabled={!nextAwaitingId} onClick={() => nextAwaitingId && setSelectedStudentId(nextAwaitingId)} size="sm" variant="secondary">Next awaiting review</Button>
          </div>
          <p aria-live="polite" className="mt-4 text-sm text-[#66788F]">{visibleRoster.length} {visibleRoster.length === 1 ? "student" : "students"}</p>
          {visibleRoster.length === 0 ? <EmptyState description="No students match this review filter." icon="HW" title="No matching submissions" /> : <div className="mt-4 space-y-2">{visibleRoster.map((item) => { const presentation = getAssignmentReviewPresentation(assignment.status, item.submission); return <button aria-pressed={selectedStudentId === item.student.id} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-[#D8E8F0] bg-white p-3 text-left hover:border-[#2ECBEA] aria-pressed:border-[#145DA0] aria-pressed:bg-[#F3FAFD]" key={item.student.id} onClick={() => setSelectedStudentId(item.student.id)} type="button"><span className="min-w-0"><span className="block truncate font-semibold text-[#0B1F33]">{item.student.full_name}</span><span className="mt-1 block text-xs text-[#66788F]">{item.submission ? formatDateTime(item.submission.submitted_at) : "No submission"}</span></span><Badge tone={presentation.tone}>{presentation.label}</Badge></button>; })}</div>}
        </Card>

        <Card className="min-w-0 border-[#D8E8F0] bg-white p-5 sm:p-6">
          {!selectedItem ? <EmptyState description="Select a student to inspect their current submission state." icon="RV" title="Select a student" /> : (() => {
            const presentation = getAssignmentReviewPresentation(assignment.status, selectedItem.submission);
            const current = draft[selectedItem.student.id] ?? { feedback: "", score: "", submissionText: "" };
            const canReviewSelected = canReviewItem(selectedItem);
            return <div className="min-w-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-sm text-[#66788F]">Selected student</p><h3 className="mt-1 break-words text-2xl font-semibold text-[#0B1F33]">{selectedItem.student.full_name}</h3><p className="mt-1 break-all text-sm text-[#66788F]">{selectedItem.student.email || selectedItem.student.phone || "No contact added"}</p></div><Badge tone={presentation.tone}>{presentation.label}</Badge></div>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold text-[#66788F]">Submitted</dt><dd className="mt-1 text-sm text-[#0B1F33]">{formatDateTime(selectedItem.submission?.submitted_at ?? null)}</dd></div><div><dt className="text-xs font-semibold text-[#66788F]">Reviewed</dt><dd className="mt-1 text-sm text-[#0B1F33]">{formatDateTime(selectedItem.submission?.reviewed_at ?? null)}</dd></div></dl>
              <div className="mt-5 rounded-lg bg-[#F6FBFE] p-4"><p className="text-xs font-semibold text-[#66788F]">Submission</p><p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-[#425B76]">{selectedItem.submission?.submission_text || "No submission recorded."}</p></div>
              {selectedItem.submission && canReviewSelected ? <div className="mt-5 space-y-4"><label className="block"><span className="text-sm font-medium text-[#425B76]">Score</span><input className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] px-3 text-sm" max={assignment.max_score ?? undefined} min="0" onChange={(event) => setDraft((existing) => ({ ...existing, [selectedItem.student.id]: { ...current, score: event.target.value } }))} type="number" value={current.score} /></label><label className="block"><span className="text-sm font-medium text-[#425B76]">Feedback</span><textarea className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[#D8E8F0] px-3 py-3 text-sm" onChange={(event) => setDraft((existing) => ({ ...existing, [selectedItem.student.id]: { ...current, feedback: event.target.value } }))} value={current.feedback} /></label><Button disabled={mutating === `review-${selectedItem.student.id}`} onClick={() => void saveReview(selectedItem)}>{mutating === `review-${selectedItem.student.id}` ? "Saving review…" : "Save review"}</Button></div> : null}
              {selectedItem.submission && !canReviewSelected ? <div className="mt-5 rounded-lg border border-[#D8E8F0] p-4"><p className="text-xs font-semibold text-[#66788F]">Score</p><p className="mt-1 text-sm text-[#425B76]">{selectedItem.submission.score ?? "Not scored"}</p><p className="mt-4 text-xs font-semibold text-[#66788F]">Feedback</p><p className="mt-1 break-words whitespace-pre-wrap text-sm text-[#425B76]">{selectedItem.submission.feedback || "No feedback recorded."}</p></div> : null}
              {!selectedItem.submission && canCreateSubmission ? <div className="mt-5 rounded-lg border border-[#D8E8F0] p-4"><h4 className="font-semibold text-[#0B1F33]">Record missing submission</h4><p className="mt-2 text-sm leading-6 text-[#425B76]">Record work received outside the portal on behalf of this student. This creates the missing submission and does not overwrite student-authored work.</p><label className="mt-4 block"><span className="text-sm font-medium text-[#425B76]">Submission text</span><textarea className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[#D8E8F0] px-3 py-3 text-sm" onChange={(event) => setDraft((existing) => ({ ...existing, [selectedItem.student.id]: { ...current, submissionText: event.target.value } }))} value={current.submissionText} /></label><Button className="mt-4" disabled={mutating === `submit-${selectedItem.student.id}`} onClick={() => void recordMissingSubmission(selectedItem)} variant="secondary">{mutating === `submit-${selectedItem.student.id}` ? "Recording…" : "Record missing submission"}</Button></div> : null}
            </div>;
          })()}
        </Card>
      </section>
    </div>
  );
}
