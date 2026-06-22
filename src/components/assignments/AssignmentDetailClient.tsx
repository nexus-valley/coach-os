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
import {
  canRoleManageAssignments,
  closeAssignment,
  getAssignmentById,
  publishAssignment,
  type AssignmentStatus,
  type AssignmentWithRelations,
} from "@/src/lib/assignments";
import { getUserDelegatedPermissions } from "@/src/lib/delegatedPermissions";
import { canAccessAttendance } from "@/src/lib/permissions";
import {
  getAssignmentSubmissionRoster,
  reviewSubmission,
  submitAssignment,
  type AssignmentRosterItem,
  type AssignmentSubmissionSummary,
} from "@/src/lib/submissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type AssignmentDetailClientProps = {
  assignmentId: string;
};

type SubmissionDraft = Record<
  string,
  {
    feedback: string;
    score: string;
    submissionText: string;
  }
>;

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "No due date";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: AssignmentStatus) {
  if (status === "published") {
    return "success";
  }

  if (status === "closed") {
    return "danger";
  }

  return "warning";
}

function buildDraft(roster: AssignmentRosterItem[]) {
  return roster.reduce<SubmissionDraft>((draft, item) => {
    draft[item.student.id] = {
      feedback: item.submission?.feedback ?? "",
      score: item.submission?.score?.toString() ?? "",
      submissionText: item.submission?.submission_text ?? "",
    };
    return draft;
  }, {});
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
      <p className="text-2xl font-semibold text-[#0B1F33]">{value}</p>
      <p className="mt-1 text-sm text-[#66788F]">{label}</p>
    </div>
  );
}

export function AssignmentDetailClient({
  assignmentId,
}: AssignmentDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [assignment, setAssignment] = useState<AssignmentWithRelations | null>(
    null,
  );
  const [canManageEffective, setCanManageEffective] = useState(false);
  const [canReviewEffective, setCanReviewEffective] = useState(false);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [draft, setDraft] = useState<SubmissionDraft>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [roster, setRoster] = useState<AssignmentRosterItem[]>([]);
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState<AssignmentSubmissionSummary | null>(
    null,
  );
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canAccessAttendance(currentRole);
  const canManage = canManageEffective;
  const canCreateSubmission =
    currentRole === "owner" || currentRole === "admin";
  const canReviewSubmission = canReviewEffective;

  const loadDetail = useCallback(async (currentTenant: Tenant) => {
    const data = await getAssignmentSubmissionRoster({
      assignmentId,
      tenantId: currentTenant.id,
    });
    setAssignment(data.assignment);
    setRoster(data.roster);
    setSummary(data.summary);
    setDraft(buildDraft(data.roster));
  }, [assignmentId]);

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

        const role = user
          ? await getCurrentMemberRole(currentTenant.id, user.id)
          : null;

        setTenant(currentTenant);
        setCurrentRole(role);

        if (canAccessAttendance(role)) {
          const currentAssignment = await getAssignmentById({
            assignmentId,
            tenantId: currentTenant.id,
          });

          if (!currentAssignment) {
            setError("Assignment not found in this workspace.");
            return;
          }

          const delegated = user
            ? await getUserDelegatedPermissions(currentTenant.id, user.id).catch(
                () => [],
              )
            : [];
          const hasManageDelegation = delegated.some((permission) =>
            ["manage_assignments"].includes(permission.permission_key),
          );
          const hasReviewDelegation = delegated.some((permission) =>
            ["manage_assignments", "review_assignments"].includes(
              permission.permission_key,
            ),
          );

          setCanManageEffective(
            canRoleManageAssignments(role) || hasManageDelegation,
          );
          setCanReviewEffective(
            canRoleManageAssignments(role) || hasReviewDelegation,
          );
          await loadDetail(currentTenant);
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load assignment."));
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
  }, [assignmentId, loadDetail, router]);

  const submissionRate = useMemo(() => {
    if (!summary || summary.submissionRate === null) {
      return "No data";
    }

    return `${summary.submissionRate}%`;
  }, [summary]);

  async function refresh() {
    if (!tenant) {
      return;
    }

    await loadDetail(tenant);
  }

  async function updateStatus(nextStatus: "closed" | "published") {
    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    if (!canManage) {
      setActionError("You do not have permission to manage this assignment.");
      return;
    }

    setMutating(nextStatus);
    setActionError("");
    setSuccess("");

    try {
      if (nextStatus === "published") {
        await publishAssignment({ assignmentId, tenantId: tenant.id });
        setSuccess("Assignment published.");
      } else {
        await closeAssignment({ assignmentId, tenantId: tenant.id });
        setSuccess("Assignment closed.");
      }

      await refresh();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update assignment."));
    } finally {
      setMutating("");
    }
  }

  async function saveSubmission(studentId: string) {
    if (!tenant || !canCreateSubmission) {
      setActionError("You do not have permission to manage submissions.");
      return;
    }

    setMutating(`submit-${studentId}`);
    setActionError("");
    setSuccess("");

    try {
      await submitAssignment({
        assignmentId,
        studentId,
        submissionText: draft[studentId]?.submissionText ?? "",
        tenantId: tenant.id,
      });
      await refresh();
      setSuccess("Submission saved.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save submission."));
    } finally {
      setMutating("");
    }
  }

  async function saveReview(studentId: string) {
    if (!tenant || !canReviewSubmission) {
      setActionError("You do not have permission to review submissions.");
      return;
    }

    setMutating(`review-${studentId}`);
    setActionError("");
    setSuccess("");

    try {
      await reviewSubmission({
        assignmentId,
        feedback: draft[studentId]?.feedback ?? "",
        score: draft[studentId]?.score ?? null,
        studentId,
        tenantId: tenant.id,
      });
      await refresh();
      setSuccess("Submission reviewed.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to review submission."));
    } finally {
      setMutating("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading assignment</span>
        </Card>
      </div>
    );
  }

  if (!currentRole || !canAccess) {
    return (
      <AccessDeniedCard description="You do not have permission to access assignments." />
    );
  }

  if (error || !assignment) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-[#D8E8F0] bg-white p-8 shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#66788F]">
            Assignment detail
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
            {error || "Assignment not found."}
          </h2>
          <Button className="mt-6" href="/app/assignments">
            Back to assignments
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-[#425B76] transition hover:text-[#0B1F33]"
        href="/app/assignments"
      >
        Back to assignments
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.38fr]">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge tone={statusTone(assignment.status)}>
                {assignment.status}
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33]">
                {assignment.title}
              </h2>
              <p className="mt-3 text-sm font-semibold text-[#0E7490]">
                {assignment.cohort?.name ??
                  assignment.course?.title ??
                  "General assignment"}
              </p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {assignment.status !== "published" ? (
                  <Button
                    disabled={mutating === "published"}
                    onClick={() => updateStatus("published")}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Publish
                  </Button>
                ) : null}
                {assignment.status !== "closed" ? (
                  <Button
                    className="text-red-700!"
                    disabled={mutating === "closed"}
                    onClick={() => updateStatus("closed")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Close
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="mt-7 max-w-3xl text-sm leading-6 text-[#425B76]">
            {assignment.description || "No assignment summary added yet."}
          </p>
          <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
            {assignment.instructions || "No detailed instructions added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-[#D8E8F0] pt-6 sm:grid-cols-2">
            <div>
              <p className="text-sm text-[#66788F]">Due</p>
              <p className="mt-2 font-semibold text-[#0B1F33]">
                {formatDateTime(assignment.due_at)}
              </p>
            </div>
            <div>
              <p className="text-sm text-[#66788F]">Max score</p>
              <p className="mt-2 font-semibold text-[#0B1F33]">
                {assignment.max_score ?? "Not graded"}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10">
          <p className="text-sm font-semibold text-[#66788F]">
            Submission rate
          </p>
          <h3 className="mt-3 text-3xl font-semibold text-[#0B1F33]">
            {submissionRate}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[#425B76]">
            Reviewed, submitted, and late submissions count toward completion.
          </p>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Roster" value={summary?.total ?? 0} />
        <SummaryCard label="Submitted" value={summary?.submitted ?? 0} />
        <SummaryCard label="Late" value={summary?.late ?? 0} />
        <SummaryCard label="Reviewed" value={summary?.reviewed ?? 0} />
        <SummaryCard
          label="Avg score"
          value={summary?.averageScore ?? "N/A"}
        />
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
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <Badge tone="light">Submission review</Badge>
            <h3 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
              Student submissions
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
              Record text submissions, placeholder attachments, scores, and
              trainer feedback.
            </p>
          </div>
        </div>

        {roster.length === 0 ? (
          <EmptyState
            description="Add students to the linked cohort or enroll them in the linked course before tracking homework."
            icon="HW"
            title="No students available for this assignment"
          />
        ) : (
          <div className="mt-8 divide-y divide-[#D8E8F0] overflow-hidden rounded-3xl border border-[#D8E8F0]">
            {roster.map((item) => {
              const current = draft[item.student.id] ?? {
                feedback: "",
                score: "",
                submissionText: "",
              };

              return (
                <div
                  className="grid gap-4 bg-white p-4 xl:grid-cols-[0.8fr_1.1fr_1.1fr_auto] xl:items-start"
                  key={item.student.id}
                >
                  <div>
                    <p className="font-semibold text-[#0B1F33]">
                      {item.student.full_name}
                    </p>
                    <p className="mt-1 text-sm text-[#66788F]">
                      {item.student.email ||
                        item.student.phone ||
                        "No contact added"}
                    </p>
                    <div className="mt-3">
                      <Badge
                        tone={
                          item.submission?.status === "reviewed"
                            ? "success"
                            : item.submission?.status === "late"
                              ? "warning"
                              : "light"
                        }
                      >
                        {item.submission?.status ?? "pending"}
                      </Badge>
                    </div>
                  </div>
                  <textarea
                    className="min-h-28 resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    disabled={!canCreateSubmission}
                    onChange={(event) =>
                      setDraft((existing) => ({
                        ...existing,
                        [item.student.id]: {
                          ...current,
                          submissionText: event.target.value,
                        },
                      }))
                    }
                    placeholder="Submission text"
                    value={current.submissionText}
                  />
                  <div className="space-y-3">
                    <input
                      className="h-11 w-full rounded-2xl border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                      disabled={!canReviewSubmission}
                      onChange={(event) =>
                        setDraft((existing) => ({
                          ...existing,
                          [item.student.id]: {
                            ...current,
                            score: event.target.value,
                          },
                        }))
                      }
                      placeholder="Score"
                      type="number"
                      value={current.score}
                    />
                    <textarea
                      className="min-h-20 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-3 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                      disabled={!canReviewSubmission}
                      onChange={(event) =>
                        setDraft((existing) => ({
                          ...existing,
                          [item.student.id]: {
                            ...current,
                            feedback: event.target.value,
                          },
                        }))
                      }
                      placeholder="Feedback"
                      value={current.feedback}
                    />
                  </div>
                  {canCreateSubmission || canReviewSubmission ? (
                    <div className="flex flex-wrap gap-2 xl:flex-col">
                      {canCreateSubmission ? (
                        <Button
                          disabled={mutating === `submit-${item.student.id}`}
                          onClick={() => saveSubmission(item.student.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Save
                        </Button>
                      ) : null}
                      {canReviewSubmission ? (
                        <Button
                          disabled={
                            !item.submission ||
                            mutating === `review-${item.student.id}`
                          }
                          onClick={() => saveReview(item.student.id)}
                          size="sm"
                          type="button"
                        >
                          Review
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
