"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getAssignmentErrorKind,
  getSafeAssignmentError,
} from "@/src/lib/assignmentErrors";
import {
  buildAssignmentUpdateInput,
  changeAssignmentEditProgram,
  createAssignmentEditForm,
  getCohortsForAssignmentProgram,
  isAssignmentEditDirty,
  type AssignmentEditCapability,
  type AssignmentEditForm,
} from "@/src/lib/assignmentEditModel";
import type {
  AssignmentWithRelations,
  UpdateAssignmentInput,
} from "@/src/lib/assignments";
import { getCohortsForTenant } from "@/src/lib/cohorts";
import { getCoursesForTenant } from "@/src/lib/courses";
import type {
  DelegatedPermissionScopeType,
} from "@/src/lib/delegatedPermissions";
import type { MemberRole } from "@/src/lib/permissions";
import { getTenantMembers } from "@/src/lib/team";

type ProgramOption = { id: string; title: string };
type CohortOption = { course_id: string; id: string; name: string };
type TrainerOption = { label: string; userId: string };

type AssignmentEditDialogProps = {
  assignment: AssignmentWithRelations;
  capability: AssignmentEditCapability;
  currentRole: MemberRole;
  onCanonicalConflict: (message: string) => Promise<void>;
  onClose: () => void;
  onSave: (input: UpdateAssignmentInput) => Promise<void>;
  relationshipScope: {
    scopeId: string | null;
    scopeType: DelegatedPermissionScopeType | null;
  } | null;
};

const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10";
const textAreaClass =
  "mt-2 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10";

function trainerLabel(name: string | null, email: string | null) {
  return name?.trim() || email?.trim() || "Trainer";
}

function applyDelegatedRelationshipScope(
  role: MemberRole,
  scope: AssignmentEditDialogProps["relationshipScope"],
  programs: ProgramOption[],
  cohorts: CohortOption[],
) {
  if (role !== "staff" || !scope?.scopeType || scope.scopeType === "workspace") {
    return { cohorts, programs };
  }

  if (scope.scopeType === "course" && scope.scopeId) {
    return {
      cohorts: cohorts.filter((cohort) => cohort.course_id === scope.scopeId),
      programs: programs.filter((program) => program.id === scope.scopeId),
    };
  }

  if (scope.scopeType === "cohort" && scope.scopeId) {
    const scopedCohorts = cohorts.filter((cohort) => cohort.id === scope.scopeId);
    const courseIds = new Set(scopedCohorts.map((cohort) => cohort.course_id));
    return {
      cohorts: scopedCohorts,
      programs: programs.filter((program) => courseIds.has(program.id)),
    };
  }

  return { cohorts: [], programs: [] };
}

function readOnlyValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
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

export function AssignmentEditDialog({
  assignment,
  capability,
  currentRole,
  onCanonicalConflict,
  onClose,
  onSave,
  relationshipScope,
}: AssignmentEditDialogProps) {
  const initialForm = useMemo(
    () => createAssignmentEditForm(assignment),
    [assignment],
  );
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<AssignmentEditForm>(initialForm);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectorError, setSelectorError] = useState("");
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = isAssignmentEditDirty(initialForm, form);
  const compatibleCohorts = getCohortsForAssignmentProgram(
    cohorts,
    form.courseId,
  ) as CohortOption[];

  useEffect(() => {
    dirtyRef.current = dirty;
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [dirty, onClose, saving]);

  const requestClose = useCallback(() => {
    if (savingRef.current) {
      return;
    }

    if (dirtyRef.current && !window.confirm("Discard unsaved assignment changes?")) {
      return;
    }

    onCloseRef.current();
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => titleRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [requestClose]);

  useEffect(() => {
    let active = true;

    async function loadSelectors() {
      if (!capability.canEditRelationships && !capability.canRetargetTrainer) {
        return;
      }

      setSelectorLoading(true);
      setSelectorError("");

      try {
        const [courseRows, cohortRows, memberRows] = await Promise.all([
          capability.canEditRelationships
            ? getCoursesForTenant(assignment.tenant_id)
            : Promise.resolve([]),
          capability.canEditRelationships
            ? getCohortsForTenant(assignment.tenant_id)
            : Promise.resolve([]),
          capability.canRetargetTrainer
            ? getTenantMembers(assignment.tenant_id)
            : Promise.resolve([]),
        ]);

        if (!active) {
          return;
        }

        const programMap = new Map<string, string>();
        for (const course of courseRows) {
          programMap.set(course.id, course.title);
        }
        for (const cohort of cohortRows) {
          if (cohort.course) {
            programMap.set(cohort.course.id, cohort.course.title);
          }
        }
        if (assignment.course_id && assignment.course) {
          programMap.set(assignment.course_id, assignment.course.title);
        }

        const scoped = applyDelegatedRelationshipScope(
          currentRole,
          relationshipScope,
          [...programMap].map(([id, title]) => ({ id, title })),
          cohortRows.map(({ course_id, id, name }) => ({ course_id, id, name })),
        );

        if (
          assignment.cohort_id &&
          assignment.cohort &&
          !scoped.cohorts.some((cohort) => cohort.id === assignment.cohort_id)
        ) {
          scoped.cohorts.push({
            course_id: assignment.course_id ?? "",
            id: assignment.cohort_id,
            name: assignment.cohort.name,
          });
        }

        setPrograms(
          scoped.programs.sort((left, right) =>
            left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
          ),
        );
        setCohorts(
          scoped.cohorts.sort((left, right) =>
            left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          ),
        );
        setTrainers(
          memberRows
            .filter((member) => member.role === "trainer")
            .map((member) => ({
              label: trainerLabel(member.profile?.full_name ?? null, member.profile?.email ?? null),
              userId: member.user_id,
            }))
            .sort((left, right) =>
              left.label.localeCompare(right.label) || left.userId.localeCompare(right.userId),
            ),
        );
      } catch (caught) {
        if (active) {
          setSelectorError(
            getSafeAssignmentError(
              caught,
              "Assignment options could not be loaded. Existing relationships will be preserved.",
            ),
          );
        }
      } finally {
        if (active) {
          setSelectorLoading(false);
        }
      }
    }

    void loadSelectors();
    return () => {
      active = false;
    };
  }, [
    assignment,
    capability.canEditRelationships,
    capability.canRetargetTrainer,
    currentRole,
    relationshipScope,
  ]);

  function patch(values: Partial<AssignmentEditForm>) {
    setForm((current) => ({ ...current, ...values }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!dirty || saving) {
      return;
    }

    let input: UpdateAssignmentInput;

    try {
      input = buildAssignmentUpdateInput({ assignment, capability, form });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Review the assignment fields and try again.",
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSave(input);
    } catch (caught) {
      const kind = getAssignmentErrorKind(caught);
      const safeMessage = getSafeAssignmentError(
        caught,
        "Assignment changes could not be saved.",
      );

      if (
        kind === "submission_cutoff" ||
        kind === "lifecycle_changed" ||
        kind === "relationship_frozen"
      ) {
        await onCanonicalConflict(safeMessage);
      } else {
        setError(safeMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  const relationshipsEditable =
    capability.canEditRelationships && !selectorLoading && !selectorError;
  const trainerEditable =
    capability.canRetargetTrainer && !selectorLoading && !selectorError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          requestClose();
        }
      }}
    >
      <div
        aria-describedby="assignment-edit-description"
        aria-labelledby="assignment-edit-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#CBD5E1] bg-white text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:max-h-[calc(100dvh-3rem)]"
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#D8E8F0] p-5 sm:p-6">
          <div>
            <h2 className="text-2xl font-semibold" id="assignment-edit-title">
              Edit assignment
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#526A80]" id="assignment-edit-description">
              Update the fields available for this assignment state.
            </p>
          </div>
          <button
            aria-label="Close assignment editor"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-lg font-semibold text-[#526A80] transition hover:bg-[#F1F5F9]"
            disabled={saving}
            onClick={requestClose}
            type="button"
          >
            X
          </button>
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
            {error ? <FeedbackAlert>{error}</FeedbackAlert> : null}
            {selectorError ? <FeedbackAlert tone="warning">{selectorError}</FeedbackAlert> : null}
            {selectorLoading ? (
              <p aria-live="polite" className="text-sm text-[#526A80]">
                Loading assignment options...
              </p>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">Assignment title</span>
              <input
                className={inputClass}
                maxLength={180}
                onChange={(event) => patch({ title: event.target.value })}
                ref={titleRef}
                required
                type="text"
                value={form.title}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">Description</span>
              <textarea
                className={`${textAreaClass} min-h-24`}
                maxLength={2000}
                onChange={(event) => patch({ description: event.target.value })}
                value={form.description}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">Instructions</span>
              <textarea
                className={`${textAreaClass} min-h-36`}
                maxLength={4000}
                onChange={(event) => patch({ instructions: event.target.value })}
                value={form.instructions}
              />
            </label>

            {relationshipsEditable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Program</span>
                  <select
                    className={inputClass}
                    onChange={(event) =>
                      setForm((current) =>
                        changeAssignmentEditProgram(
                          current,
                          event.target.value,
                          cohorts,
                        ),
                      )
                    }
                    value={form.courseId}
                  >
                    <option value="">Select program</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>{program.title}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Cohort</span>
                  <select
                    className={inputClass}
                    onChange={(event) => patch({ cohortId: event.target.value })}
                    value={form.cohortId}
                  >
                    <option value="">No cohort</option>
                    {compatibleCohorts.map((cohort) => (
                      <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4">
                <p className="text-sm font-semibold text-[#0B1F33]">Assignment relationships</p>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-[#66788F]">Program</dt><dd className="mt-1 font-medium">{readOnlyValue(assignment.course?.title, "No program")}</dd></div>
                  <div><dt className="text-[#66788F]">Cohort</dt><dd className="mt-1 font-medium">{readOnlyValue(assignment.cohort?.name, "No cohort")}</dd></div>
                  <div><dt className="text-[#66788F]">Trainer</dt><dd className="mt-1 font-medium">{assignment.trainer_user_id ? "Assigned trainer" : "Unassigned"}</dd></div>
                </dl>
                {assignment.status === "published" ? (
                  <p className="mt-3 text-sm leading-6 text-[#526A80]">Program, cohort, and trainer cannot be changed after publishing.</p>
                ) : null}
              </div>
            )}

            {trainerEditable && (
              !form.trainerUserId ||
              trainers.some((trainer) => trainer.userId === form.trainerUserId)
            ) ? (
              <label className="block">
                <span className="text-sm font-medium text-[#425B76]">Trainer</span>
                <select
                  className={inputClass}
                  onChange={(event) => patch({ trainerUserId: event.target.value })}
                  value={form.trainerUserId}
                >
                  <option value="">Unassigned</option>
                  {trainers.map((trainer) => (
                    <option key={trainer.userId} value={trainer.userId}>{trainer.label}</option>
                  ))}
                </select>
              </label>
            ) : capability.canRetargetTrainer && form.trainerUserId ? (
              <div className="rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4">
                <p className="text-sm font-semibold text-[#0B1F33]">Trainer</p>
                <p className="mt-2 text-sm leading-6 text-[#526A80]">The current trainer is not an active selectable option. This assignment will preserve the existing trainer.</p>
              </div>
            ) : null}

            {capability.canEditDueAndMax ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Due date</span>
                  <input
                    className={inputClass}
                    onChange={(event) => patch({ dueAt: event.target.value })}
                    step="1"
                    type="datetime-local"
                    value={form.dueAt}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#425B76]">Maximum score</span>
                  <input
                    className={inputClass}
                    min="0"
                    onChange={(event) => patch({ maxScore: event.target.value })}
                    step="0.01"
                    type="number"
                    value={form.maxScore}
                  />
                </label>
              </div>
            ) : (
              <div className="rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4">
                <p className="text-sm font-semibold text-[#0B1F33]">Due date and scoring</p>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[#66788F]">Current due date</dt>
                    <dd className="mt-1 font-medium">{formatDateTime(assignment.due_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#66788F]">Current maximum score</dt>
                    <dd className="mt-1 font-medium">{assignment.max_score ?? "Not graded"}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-sm leading-6 text-[#526A80]">Due date and maximum score can no longer be changed after submission activity.</p>
              </div>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-[#425B76]">Attachment links</legend>
              <div className="mt-3 space-y-3">
                {form.attachmentUrls.length === 0 ? (
                  <p className="text-sm text-[#66788F]">No attachment links.</p>
                ) : null}
                {form.attachmentUrls.map((url, index) => (
                  <div className="flex flex-col gap-2 sm:flex-row" key={`attachment-${index}`}>
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Attachment link {index + 1}</span>
                      <input
                        className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                        maxLength={1000}
                        onChange={(event) => {
                          const next = [...form.attachmentUrls];
                          next[index] = event.target.value;
                          patch({ attachmentUrls: next });
                        }}
                        placeholder="https://example.com/resource"
                        type="url"
                        value={url}
                      />
                    </label>
                    <Button
                      aria-label={`Remove attachment link ${index + 1}`}
                      onClick={() =>
                        patch({
                          attachmentUrls: form.attachmentUrls.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3"
                disabled={form.attachmentUrls.length >= 10}
                onClick={() => patch({ attachmentUrls: [...form.attachmentUrls, ""] })}
                size="sm"
                type="button"
                variant="secondary"
              >
                Add link
              </Button>
            </fieldset>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#D8E8F0] bg-white p-4 sm:flex-row sm:justify-end sm:p-5">
            <Button disabled={saving} onClick={requestClose} type="button" variant="secondary">
              {dirty ? "Discard changes" : "Cancel"}
            </Button>
            <Button disabled={!dirty || saving} isLoading={saving} loadingText="Saving..." type="submit">
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
