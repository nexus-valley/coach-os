"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  EnrollmentStatusBadge,
  formatEnrollmentStatus,
} from "@/src/components/enrollments/EnrollmentStatusBadge";
import {
  emptyStudentForm,
  StudentFormFields,
  StudentStatusBadge,
  type StudentFormState,
} from "@/src/components/students/StudentsPageClient";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import {
  addStudentToCohort,
  getCohortAssignmentOptions,
  type CohortAssignmentOption,
} from "@/src/lib/cohorts";
import {
  createEnrollment,
  deleteEnrollment,
  getEnrollmentCourseOptions,
  updateEnrollmentStatus,
  type EnrollmentCourseOption,
  type EnrollmentStatus,
} from "@/src/lib/enrollments";
import {
  getStudentDetail,
} from "@/src/lib/studentDetail";
import {
  getStudentDetailEnrollmentTransitions,
  type StudentDetailCohort,
  type StudentDetailModel,
  type StudentDetailPortalState,
  type StudentDetailRelationship,
} from "@/src/lib/studentDetailModel";
import {
  deleteStudent as deleteStudentRecord,
  updateStudent,
  type Student,
} from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StudentDetailClientProps = {
  studentId: string;
};

type AttentionItem = {
  description: string;
  title: string;
  tone: "info" | "warning";
};

const portalLabels: Record<StudentDetailPortalState, string> = {
  access_active: "Portal active",
  access_unavailable: "Portal unavailable",
  invitation_expired: "Invitation expired",
  invitation_not_sent: "Invitation not sent",
  invitation_pending: "Invitation pending",
  invitation_sent: "Invitation sent",
  needs_attention: "Portal needs attention",
  status_restricted: "Portal status restricted",
  status_unavailable: "Portal status unavailable",
};

const portalTones = {
  access_active: "success",
  access_unavailable: "warning",
  invitation_expired: "warning",
  invitation_not_sent: "neutral",
  invitation_pending: "info",
  invitation_sent: "info",
  needs_attention: "warning",
  status_restricted: "outline",
  status_unavailable: "neutral",
} as const;

const programTones = {
  archived: "warning",
  draft: "neutral",
  published: "success",
} as const;

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function safeActionError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : "";

  if (/already enrolled|already in that cohort/i.test(message)) {
    return "This relationship already exists. Refresh the student and try again.";
  }

  if (/activate the student/i.test(message)) {
    return "The student must be active before this relationship can be changed.";
  }

  if (/status transition is not allowed/i.test(message)) {
    return "That enrollment change is not available from the current state.";
  }

  if (/permission|assigned teaching scope/i.test(message)) {
    return "You do not have permission to make this change.";
  }

  return fallback;
}

function createFormFromStudent(student: Student): StudentFormState {
  return {
    email: student.email ?? "",
    fullName: student.full_name,
    notes: student.notes ?? "",
    phone: student.phone ?? "",
    source: student.source ?? "",
    status: student.status,
  };
}

function StudentDetailDialog({
  children,
  description,
  disabled = false,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `student-dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabled) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [disabled, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !disabled) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby={`${titleId}-description`}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:max-h-[calc(100dvh-3rem)] sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold" id={titleId}>
              {title}
            </h2>
            <p
              className="mt-2 text-sm leading-6 text-[#526A80]"
              id={`${titleId}-description`}
            >
              {description}
            </p>
          </div>
          <button
            aria-label={`Close ${title}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-sm font-semibold text-[#526A80] transition hover:bg-[#F1F5F9]"
            disabled={disabled}
            onClick={onClose}
            title="Close"
            type="button"
          >
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CohortList({ cohorts }: { cohorts: StudentDetailCohort[] }) {
  if (cohorts.length === 0) {
    return <p className="text-sm text-[#64748B]">No cohort assigned</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {cohorts.map((membership) =>
        membership.cohort && membership.canOpenCohort ? (
          <Link
            aria-label={`Open cohort ${membership.cohort.name}`}
            className="inline-flex min-h-9 items-center rounded-lg border border-[#BFD7E6] bg-[#F6FBFE] px-3 text-sm font-semibold text-[#145DA0] hover:border-[#145DA0]/45 hover:bg-white"
            href={`/app/cohorts/${membership.cohort.id}`}
            key={membership.id}
          >
            {membership.cohort.name}
          </Link>
        ) : (
          <span
            className="inline-flex min-h-9 items-center rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] px-3 text-sm font-semibold text-[#334155]"
            key={membership.id}
          >
            {membership.cohort?.name ?? "Cohort unavailable"}
          </span>
        ),
      )}
    </div>
  );
}

function RelationshipGroup({
  emptyCopy,
  label,
  onAddCohort,
  onRemove,
  onStatusChange,
  relationships,
  studentStatus,
  mutating,
}: {
  emptyCopy: string;
  label: string;
  mutating: boolean;
  onAddCohort: (relationship: StudentDetailRelationship) => void;
  onRemove: (relationship: StudentDetailRelationship) => void;
  onStatusChange: (
    relationship: StudentDetailRelationship,
    status: EnrollmentStatus,
  ) => void;
  relationships: StudentDetailRelationship[];
  studentStatus: Student["status"];
}) {
  return (
    <section aria-labelledby={`${label.toLowerCase()}-programs-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h3
          className="text-sm font-semibold uppercase text-[#526A80]"
          id={`${label.toLowerCase()}-programs-heading`}
        >
          {label}
        </h3>
        <span className="text-xs font-semibold text-[#64748B]">
          {relationships.length}
        </span>
      </div>

      {relationships.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-5 text-sm text-[#526A80]">
          {emptyCopy}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {relationships.map((relationship) => {
            const programTitle =
              relationship.program?.title ?? "Program unavailable";
            const nextStatuses = getStudentDetailEnrollmentTransitions({
              enrollmentStatus: relationship.enrollment.status,
              studentStatus,
            });

            return (
              <article
                className="rounded-lg border border-[#CBD5E1] bg-white p-4 shadow-sm shadow-slate-950/5 sm:p-5"
                key={relationship.enrollment.id}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-[#64748B]">
                      Program
                    </p>
                    {relationship.program && relationship.canViewProgram ? (
                      <Link
                        className="mt-1 block wrap-break-word text-lg font-semibold text-[#145DA0] hover:underline"
                        href={`/app/courses/${relationship.program.id}`}
                      >
                        {programTitle}
                      </Link>
                    ) : (
                      <p className="mt-1 wrap-break-word text-lg font-semibold text-[#0B1F33]">
                        {programTitle}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <EnrollmentStatusBadge
                        status={relationship.enrollment.status}
                      />
                      {relationship.program ? (
                        <Badge tone={programTones[relationship.program.status]}>
                          Program {relationship.program.status}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {relationship.canManageCohorts ? (
                      <Button
                        onClick={() => onAddCohort(relationship)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Add cohort
                      </Button>
                    ) : null}
                    {relationship.canRemoveEnrollment ? (
                      <Button
                        onClick={() => onRemove(relationship)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Remove relationship
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 border-t border-[#E2E8F0] pt-4 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold text-[#64748B]">
                      Enrollment
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#334155]">
                      Started {formatDate(relationship.enrollment.enrolled_at)}
                    </p>
                    {relationship.enrollment.completed_at ? (
                      <p className="mt-1 text-sm text-[#526A80]">
                        Completed {formatDate(relationship.enrollment.completed_at)}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#64748B]">
                      Cohorts
                    </p>
                    <div className="mt-2">
                      <CohortList cohorts={relationship.cohorts} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#64748B]">
                      Next enrollment state
                    </p>
                    {relationship.canManageEnrollment && nextStatuses.length ? (
                      <label className="mt-2 block">
                        <span className="sr-only">
                          Change enrollment state for {programTitle}
                        </span>
                        <select
                          aria-label={`Change enrollment state for ${programTitle}`}
                          className="h-10 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#334155] outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
                          disabled={mutating}
                          onChange={(event) => {
                            const nextStatus = event.target.value as EnrollmentStatus;

                            if (nextStatus !== relationship.enrollment.status) {
                              onStatusChange(relationship, nextStatus);
                            }
                          }}
                          value={relationship.enrollment.status}
                        >
                          <option value={relationship.enrollment.status}>
                            {formatEnrollmentStatus(
                              relationship.enrollment.status,
                            )}
                          </option>
                          {nextStatuses.map((status) => (
                            <option key={status} value={status}>
                              {formatEnrollmentStatus(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="mt-2 text-sm text-[#526A80]">
                        {relationship.enrollment.status === "completed"
                          ? "Completed enrollment is read-only."
                          : "No enrollment change is available for your role."}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function getAttentionItems(detail: StudentDetailModel): AttentionItem[] {
  const items: AttentionItem[] = [];
  const activeRelationships = detail.currentRelationships.filter(
    (relationship) => relationship.enrollment.status === "active",
  );

  if (detail.student.status !== "active") {
    items.push({
      description:
        "Learning and portal access remain suspended while the student is not active.",
      title: `Student state is ${detail.student.status}`,
      tone: "warning",
    });
  }

  if (detail.currentRelationships.length === 0) {
    items.push({
      description:
        detail.historyRelationships.length > 0
          ? "This student has enrollment history but no current program relationship."
          : "Enroll the student in a program when they are ready to participate.",
      title: "No current program",
      tone: "info",
    });
  }

  for (const relationship of detail.currentRelationships) {
    if (relationship.enrollment.status === "paused") {
      items.push({
        description: `${relationship.program?.title ?? "This program"} is retained, but active learning is suspended.`,
        title: "Enrollment paused",
        tone: "warning",
      });
    }
  }

  if (detail.role === "owner" || detail.role === "admin") {
    const portalAttention: Partial<
      Record<StudentDetailPortalState, AttentionItem>
    > = {
      access_unavailable: {
        description:
          "Student eligibility or portal enablement currently prevents portal access.",
        title: "Portal unavailable",
        tone: "warning",
      },
      invitation_expired: {
        description:
          "Use the existing Requests workflow if invitation recovery is required.",
        title: "Portal invitation expired",
        tone: "warning",
      },
      invitation_pending: {
        description: "Invitation preparation is still in progress.",
        title: "Portal invitation pending",
        tone: "info",
      },
      invitation_sent: {
        description: "The student has not activated portal access yet.",
        title: "Portal invitation sent",
        tone: "info",
      },
      invitation_not_sent: {
        description:
          "Use the existing Requests workflow when portal invitation is appropriate.",
        title: "Portal invitation not sent",
        tone: "info",
      },
      needs_attention: {
        description:
          "Review the existing request and invitation workflow before retrying access.",
        title: "Portal access needs attention",
        tone: "warning",
      },
      status_unavailable: {
        description: "Portal status could not be loaded safely. Try again later.",
        title: "Portal status unavailable",
        tone: "warning",
      },
    };
    const item = portalAttention[detail.portal.state];

    if (item && (activeRelationships.length > 0 || detail.portal.summary)) {
      items.push(item);
    }
  }

  if (detail.unmatchedCohorts.length > 0) {
    items.push({
      description:
        "A cohort membership has no matching program enrollment and remains visible below for review.",
      title: "Cohort relationship requires review",
      tone: "warning",
    });
  }

  return items;
}

export function StudentDetailClient({ studentId }: StudentDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [cohortOptions, setCohortOptions] = useState<CohortAssignmentOption[]>([]);
  const [cohortTarget, setCohortTarget] =
    useState<StudentDetailRelationship | null>(null);
  const [deleteEnrollmentTarget, setDeleteEnrollmentTarget] =
    useState<StudentDetailRelationship | null>(null);
  const [deleteStudentOpen, setDeleteStudentOpen] = useState(false);
  const [detail, setDetail] = useState<StudentDetailModel | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [enrollmentOptions, setEnrollmentOptions] = useState<
    EnrollmentCourseOption[]
  >([]);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentFormState>(emptyStudentForm);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const allRelationships = useMemo(
    () => [
      ...(detail?.currentRelationships ?? []),
      ...(detail?.historyRelationships ?? []),
    ],
    [detail],
  );
  const attentionItems = useMemo(
    () => (detail ? getAttentionItems(detail) : []),
    [detail],
  );

  async function refreshDetail(currentTenant: Tenant) {
    const nextDetail = await getStudentDetail({
      studentId,
      tenantId: currentTenant.id,
    });

    if (!nextDetail) {
      setDetail(null);
      setError("Student not found in this workspace.");
      return null;
    }

    setDetail(nextDetail);
    setForm(createFormFromStudent(nextDetail.student));
    return nextDetail;
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const nextDetail = await getStudentDetail({
          studentId,
          tenantId: currentTenant.id,
        });

        if (!active) {
          return;
        }

        setTenant(currentTenant);

        if (!nextDetail) {
          setError("Student not found in this workspace.");
          return;
        }

        setDetail(nextDetail);
        setForm(createFormFromStudent(nextDetail.student));
      } catch (caught) {
        console.error("Unable to load student detail", caught);

        if (active) {
          setError("Unable to load this student. Please try again.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [router, studentId]);

  async function openEnrollmentDialog() {
    if (!tenant || !detail) {
      return;
    }

    setActionError("");
    setEnrollOpen(true);
    setOptionsLoading(true);

    try {
      const options = await getEnrollmentCourseOptions(tenant.id);
      const enrolledCourseIds = new Set(
        allRelationships.map((relationship) => relationship.enrollment.course_id),
      );
      const available = options.filter(
        (option) => !enrolledCourseIds.has(option.id),
      );
      setEnrollmentOptions(available);
      setSelectedCourseId(available[0]?.id ?? "");
    } catch (caught) {
      console.error("Unable to load enrollment options", caught);
      setActionError("Unable to load available programs. Please try again.");
      setEnrollOpen(false);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function openCohortDialog(relationship: StudentDetailRelationship) {
    if (!tenant) {
      return;
    }

    setActionError("");
    setCohortTarget(relationship);
    setOptionsLoading(true);

    try {
      const options = await getCohortAssignmentOptions({
        courseId: relationship.enrollment.course_id,
        tenantId: tenant.id,
      });
      const existingIds = new Set(
        relationship.cohorts.map((membership) => membership.cohort_id),
      );
      const available = options.filter((option) => !existingIds.has(option.id));
      setCohortOptions(available);
      setSelectedCohortId(available[0]?.id ?? "");
    } catch (caught) {
      console.error("Unable to load cohort options", caught);
      setActionError("Unable to load available cohorts. Please try again.");
      setCohortTarget(null);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function handleUpdateStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !detail) {
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");

    try {
      await updateStudent({
        ...form,
        studentId,
        tenantId: tenant.id,
      });
      await refreshDetail(tenant);
      setEditOpen(false);
      setActionMessage(
        detail.role === "trainer" ? "Student notes updated." : "Student updated.",
      );
    } catch (caught) {
      console.error("Unable to update student", caught);
      setActionError(safeActionError(caught, "Unable to update this student."));
    } finally {
      setMutating(false);
    }
  }

  async function handleCreateEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedCourseId) {
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");

    try {
      await createEnrollment({
        courseId: selectedCourseId,
        status: "active",
        studentId,
        tenantId: tenant.id,
      });
      await refreshDetail(tenant);
      setEnrollOpen(false);
      setActionMessage("Program enrollment created.");
    } catch (caught) {
      console.error("Unable to create enrollment", caught);
      setActionError(
        safeActionError(caught, "Unable to enroll this student right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleAddCohort(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedCohortId) {
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");

    try {
      await addStudentToCohort({
        cohortId: selectedCohortId,
        studentId,
        tenantId: tenant.id,
      });
      await refreshDetail(tenant);
      setCohortTarget(null);
      setActionMessage("Cohort relationship added.");
    } catch (caught) {
      console.error("Unable to add cohort relationship", caught);
      setActionError(
        safeActionError(caught, "Unable to add this cohort relationship."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleStatusChange(
    relationship: StudentDetailRelationship,
    status: EnrollmentStatus,
  ) {
    if (!tenant) {
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");

    try {
      await updateEnrollmentStatus({
        enrollmentId: relationship.enrollment.id,
        status,
        tenantId: tenant.id,
      });
      await refreshDetail(tenant);
      setActionMessage(
        `${relationship.program?.title ?? "Program"} enrollment updated.`,
      );
    } catch (caught) {
      console.error("Unable to update enrollment", caught);
      setActionError(
        safeActionError(caught, "Unable to update this enrollment."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleRemoveEnrollment() {
    if (!tenant || !deleteEnrollmentTarget) {
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");

    try {
      await deleteEnrollment({
        enrollmentId: deleteEnrollmentTarget.enrollment.id,
        tenantId: tenant.id,
      });
      await refreshDetail(tenant);
      setDeleteEnrollmentTarget(null);
      setActionMessage("Enrollment relationship removed.");
    } catch (caught) {
      console.error("Unable to remove enrollment", caught);
      setActionError(
        safeActionError(caught, "Unable to remove this enrollment."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteStudent() {
    if (!tenant) {
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await deleteStudentRecord({ studentId, tenantId: tenant.id });
      router.replace("/app/students");
    } catch (caught) {
      console.error("Unable to delete student", caught);
      setActionError(
        safeActionError(caught, "Unable to delete this student."),
      );
      setMutating(false);
    }
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading student" className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <EmptyState
        action={
          <Button href="/app/students" variant="secondary">
            Back to students
          </Button>
        }
        description={error || "This student is not available in the current workspace."}
        title="Student unavailable"
      />
    );
  }

  const { student } = detail;

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-[#526A80] hover:text-[#145DA0] hover:underline"
        href="/app/students"
      >
        Back to students
      </Link>

      <PageHeader
        actions={
          <>
            {detail.capabilities.canCreateEnrollment ? (
              <Button onClick={openEnrollmentDialog} type="button">
                Enroll in program
              </Button>
            ) : null}
            {detail.capabilities.canPreviewPortal ? (
              <Button
                href={`/app/student-portal/${student.id}`}
                variant="secondary"
              >
                Preview portal experience
              </Button>
            ) : null}
            <Button
              onClick={() => setEditOpen(true)}
              type="button"
              variant="secondary"
            >
              {detail.capabilities.canEditProfile ? "Edit student" : "Edit notes"}
            </Button>
          </>
        }
        className="mt-5"
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="wrap-break-word">{student.email || "No email"}</span>
            <span>{student.phone || "No phone"}</span>
          </span>
        }
        eyebrow="Student workspace"
        metadata={
          <>
            <span className="inline-flex items-center gap-2">
              <span className="text-xs font-semibold text-[#64748B]">Student</span>
              <StudentStatusBadge status={student.status} />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-xs font-semibold text-[#64748B]">Portal</span>
              <Badge tone={portalTones[detail.portal.state]}>
                {portalLabels[detail.portal.state]}
              </Badge>
            </span>
          </>
        }
        title={student.full_name}
      />

      {actionError ? (
        <div aria-live="polite" className="mt-5">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}
      {actionMessage ? (
        <div aria-live="polite" className="mt-5">
          <FeedbackAlert tone="success">{actionMessage}</FeedbackAlert>
        </div>
      ) : null}

      {attentionItems.length > 0 ? (
        <section aria-labelledby="student-attention-heading" className="mt-6">
          <h2 className="text-lg font-semibold text-[#0B1F33]" id="student-attention-heading">
            Needs attention
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {attentionItems.map((item, index) => (
              <FeedbackAlert key={`${item.title}-${index}`} tone={item.tone}>
                <span className="font-semibold">{item.title}.</span>{" "}
                {item.description}
              </FeedbackAlert>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="program-relationships-heading" className="mt-7">
        <div className="flex flex-col gap-3 border-b border-[#D8E8F0] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#0B1F33]" id="program-relationships-heading">
              Programs &amp; enrollments
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#526A80]">
              Each program relationship keeps its enrollment state, program state,
              and cohorts separate.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#526A80]">
            {allRelationships.length}{" "}
            {allRelationships.length === 1 ? "relationship" : "relationships"}
          </p>
        </div>

        {allRelationships.length === 0 ? (
          <EmptyState
            description="No program enrollment relationship has been created for this student."
            eyebrow="Programs"
            title="No program relationships"
          />
        ) : (
          <div className="mt-5 space-y-7">
            <RelationshipGroup
              emptyCopy="No active or paused program relationships."
              label="Current"
              mutating={mutating}
              onAddCohort={openCohortDialog}
              onRemove={setDeleteEnrollmentTarget}
              onStatusChange={handleStatusChange}
              relationships={detail.currentRelationships}
              studentStatus={student.status}
            />
            <RelationshipGroup
              emptyCopy="No completed or cancelled enrollment history."
              label="History"
              mutating={mutating}
              onAddCohort={openCohortDialog}
              onRemove={setDeleteEnrollmentTarget}
              onStatusChange={handleStatusChange}
              relationships={detail.historyRelationships}
              studentStatus={student.status}
            />
          </div>
        )}

        {detail.unmatchedCohorts.length > 0 ? (
          <Card className="mt-6 border-amber-200 bg-amber-50 p-5 text-[#0B1F33]">
            <h3 className="font-semibold">Other cohort memberships</h3>
            <p className="mt-2 text-sm leading-6 text-[#526A80]">
              These memberships do not currently match a program enrollment on
              this student record.
            </p>
            <div className="mt-4">
              <CohortList cohorts={detail.unmatchedCohorts} />
            </div>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="operational-shortcuts-heading" className="mt-7">
        <h2 className="text-xl font-semibold text-[#0B1F33]" id="operational-shortcuts-heading">
          Operational shortcuts
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {detail.capabilities.canViewFinance ? (
            <Button href="/app/finance" variant="secondary">
              View in Finance Center
            </Button>
          ) : null}
          <Button href="/app/enrollments" variant="secondary">
            View enrollments
          </Button>
        </div>
      </section>

      <section aria-labelledby="profile-metadata-heading" className="mt-7">
        <Card className="border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold" id="profile-metadata-heading">
                Profile &amp; notes
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold text-[#64748B]">Source</p>
                  <p className="mt-1 text-sm font-medium text-[#334155]">
                    {student.source || "Direct"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#64748B]">Created</p>
                  <p className="mt-1 text-sm font-medium text-[#334155]">
                    {formatDate(student.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#64748B]">Portal enabled</p>
                  <p className="mt-1 text-sm font-medium text-[#334155]">
                    {student.portal_enabled ? "Yes" : "No"}
                  </p>
                </div>
              </div>
              <div className="mt-5 border-t border-[#E2E8F0] pt-4">
                <p className="text-xs font-semibold text-[#64748B]">Notes</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#334155]">
                  {student.notes || "No notes added."}
                </p>
              </div>
            </div>
            {detail.capabilities.canDeleteStudent ? (
              <Button
                onClick={() => setDeleteStudentOpen(true)}
                type="button"
                variant="ghost"
              >
                Delete student
              </Button>
            ) : null}
          </div>
        </Card>
      </section>

      {enrollOpen ? (
        <StudentDetailDialog
          description="Create one active program relationship using the existing secure enrollment workflow."
          disabled={mutating}
          onClose={() => setEnrollOpen(false)}
          title="Enroll in program"
        >
          <form className="mt-6 space-y-5" onSubmit={handleCreateEnrollment}>
            <label className="block">
              <span className="text-sm font-semibold text-[#334155]">Program</span>
              <select
                className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#334155] outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
                disabled={optionsLoading || mutating}
                onChange={(event) => setSelectedCourseId(event.target.value)}
                required
                value={selectedCourseId}
              >
                <option value="">Select a program</option>
                {enrollmentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title} ({option.status})
                  </option>
                ))}
              </select>
            </label>
            {optionsLoading ? (
              <p className="text-sm text-[#526A80]">Loading programs...</p>
            ) : enrollmentOptions.length === 0 ? (
              <FeedbackAlert tone="info">
                No additional authorized programs are available.
              </FeedbackAlert>
            ) : (
              <FeedbackAlert tone="info">
                New enrollments start active. Payment and portal access remain
                separate.
              </FeedbackAlert>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={mutating}
                onClick={() => setEnrollOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={mutating || optionsLoading || !selectedCourseId}
                isLoading={mutating}
                loadingText="Enrolling..."
                type="submit"
              >
                Enroll student
              </Button>
            </div>
          </form>
        </StudentDetailDialog>
      ) : null}

      {cohortTarget ? (
        <StudentDetailDialog
          description={`Add a cohort associated with ${cohortTarget.program?.title ?? "this program"}. Program enrollment is not changed.`}
          disabled={mutating}
          onClose={() => setCohortTarget(null)}
          title="Add cohort relationship"
        >
          <form className="mt-6 space-y-5" onSubmit={handleAddCohort}>
            <label className="block">
              <span className="text-sm font-semibold text-[#334155]">Cohort</span>
              <select
                className="mt-2 h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#334155] outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
                disabled={optionsLoading || mutating}
                onChange={(event) => setSelectedCohortId(event.target.value)}
                required
                value={selectedCohortId}
              >
                <option value="">Select a cohort</option>
                {cohortOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            {optionsLoading ? (
              <p className="text-sm text-[#526A80]">Loading cohorts...</p>
            ) : cohortOptions.length === 0 ? (
              <FeedbackAlert tone="info">
                No additional authorized cohorts are available for this program.
              </FeedbackAlert>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={mutating}
                onClick={() => setCohortTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={mutating || optionsLoading || !selectedCohortId}
                isLoading={mutating}
                loadingText="Adding..."
                type="submit"
              >
                Add cohort
              </Button>
            </div>
          </form>
        </StudentDetailDialog>
      ) : null}

      {editOpen ? (
        <StudentDetailDialog
          description={
            detail.role === "trainer"
              ? "Trainer access is limited to student notes."
              : "Update the student profile and student-level state."
          }
          disabled={mutating}
          onClose={() => {
            setForm(createFormFromStudent(student));
            setEditOpen(false);
          }}
          title={detail.role === "trainer" ? "Edit student notes" : "Edit student"}
        >
          <form className="mt-6 space-y-5" onSubmit={handleUpdateStudent}>
            <StudentFormFields
              disableProfile={!detail.capabilities.canEditProfile}
              disableStatus={!detail.capabilities.canEditProfile}
              form={form}
              setForm={setForm}
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={mutating}
                onClick={() => {
                  setForm(createFormFromStudent(student));
                  setEditOpen(false);
                }}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={mutating}
                isLoading={mutating}
                loadingText="Saving..."
                type="submit"
              >
                Save changes
              </Button>
            </div>
          </form>
        </StudentDetailDialog>
      ) : null}

      {deleteEnrollmentTarget ? (
        <StudentDetailDialog
          description="This permanently deletes the enrollment relationship record. It does not merely pause or cancel learning access."
          disabled={mutating}
          onClose={() => setDeleteEnrollmentTarget(null)}
          title={`Remove ${deleteEnrollmentTarget.program?.title ?? "program"} enrollment?`}
        >
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              disabled={mutating}
              onClick={() => setDeleteEnrollmentTarget(null)}
              type="button"
              variant="secondary"
            >
              Keep relationship
            </Button>
            <Button
              disabled={mutating}
              isLoading={mutating}
              loadingText="Removing..."
              onClick={handleRemoveEnrollment}
              type="button"
              variant="destructive"
            >
              Remove enrollment
            </Button>
          </div>
        </StudentDetailDialog>
      ) : null}

      {deleteStudentOpen ? (
        <StudentDetailDialog
          description="This permanently deletes the student record. Enrollment and cohort relationship rows configured to cascade are also removed; this is not a student-status change."
          disabled={mutating}
          onClose={() => setDeleteStudentOpen(false)}
          title={`Delete ${student.full_name}?`}
        >
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              disabled={mutating}
              onClick={() => setDeleteStudentOpen(false)}
              type="button"
              variant="secondary"
            >
              Keep student
            </Button>
            <Button
              disabled={mutating}
              isLoading={mutating}
              loadingText="Deleting..."
              onClick={handleDeleteStudent}
              type="button"
              variant="destructive"
            >
              Delete student
            </Button>
          </div>
        </StudentDetailDialog>
      ) : null}
    </div>
  );
}
