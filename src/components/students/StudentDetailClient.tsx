"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  EnrollmentStatusBadge,
  formatEnrollmentStatus,
} from "@/src/components/enrollments/EnrollmentStatusBadge";
import { PaymentStatusBadge } from "@/src/components/payments/PaymentStatusBadge";
import {
  emptyStudentForm,
  StudentFormFields,
  StudentStatusBadge,
  type StudentFormState,
} from "@/src/components/students/StudentsPageClient";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  addStudentToCohort,
  getCohortsForStudent,
  getCohortsForTenant,
  type CohortWithCourse,
  type StudentCohortMembership,
} from "@/src/lib/cohorts";
import {
  createEnrollment,
  deleteEnrollment,
  getEnrollmentsForStudent,
  updateEnrollmentStatus,
  type EnrollmentStatus,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import {
  getPaymentsByStudent,
  type PaymentWithRelations,
} from "@/src/lib/payments";
import {
  getPaymentLinksByStudent,
  type PaymentLinkWithRelations,
} from "@/src/lib/paymentLinks";
import { hasEffectivePermission } from "@/src/lib/permissions";
import {
  deleteStudent as deleteStudentRecord,
  getStudentById,
  updateStudent,
  type Student,
} from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canDeleteRecords,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  getTenantSettings,
  getWorkspaceBranding,
  type TenantSettings,
} from "@/src/lib/tenantSettings";
import {
  buildGeneralFollowUpMessage,
  buildPaymentReminderMessage,
  buildWhatsAppShareUrl,
} from "@/src/lib/whatsapp";

type StudentDetailClientProps = {
  studentId: string;
};

const defaultWhatsAppFollowUp =
  "Hope you are doing well. Please let us know if you need any support.";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatCurrencyForPaymentLink(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    currency,
    style: "currency",
  }).format(value);
}

function formatPaymentLinkStatus(value: string) {
  return value.replace("_", " ");
}

function getEnrollmentStatusOptions(
  currentStatus: EnrollmentStatus,
  studentIsActive: boolean,
) {
  const transitions: Record<EnrollmentStatus, EnrollmentStatus[]> = {
    active: ["active", "completed", "paused", "cancelled"],
    cancelled: ["cancelled", "active"],
    completed: ["completed"],
    paused: ["paused", "active", "cancelled"],
  };

  return transitions[currentStatus].filter(
    (status) => status !== "active" || studentIsActive,
  );
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
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

export function StudentDetailClient({ studentId }: StudentDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [cohortOpen, setCohortOpen] = useState(false);
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [deleteEnrollmentTarget, setDeleteEnrollmentTarget] =
    useState<EnrollmentWithRelations | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentFormState>(emptyStudentForm);
  const [loading, setLoading] = useState(true);
  const [canViewFinance, setCanViewFinance] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState<
    PaymentLinkWithRelations[]
  >([]);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [studentCohorts, setStudentCohorts] = useState<
    StudentCohortMembership[]
  >([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] =
    useState<TenantSettings | null>(null);
  const [whatsAppMessage, setWhatsAppMessage] = useState(
    defaultWhatsAppFollowUp,
  );
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);

  const availableCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          !enrollments.some(
            (enrollment) => enrollment.course_id === course.id,
          ),
      ),
    [courses, enrollments],
  );

  const availableCohorts = useMemo(
    () =>
      cohorts.filter(
        (cohort) =>
          !studentCohorts.some(
            (membership) => membership.cohort_id === cohort.id,
          ),
      ),
    [cohorts, studentCohorts],
  );

  const canDelete = canDeleteRecords(currentRole);
  const canAddLearningRelationship = student?.status === "active";
  function getPaymentLinkWhatsAppUrl(link: PaymentLinkWithRelations) {
    const workspaceBranding = getWorkspaceBranding(tenantSettings, tenant);
    const message = buildPaymentReminderMessage({
      amount: formatCurrencyForPaymentLink(link.amount, link.currency || "INR"),
      courseName: link.course?.title,
      paymentUrl: link.payment_url,
      studentName: student?.full_name,
      workspaceName: workspaceBranding.displayName,
    });

    return buildWhatsAppShareUrl(student?.phone, message);
  }

  function openWhatsAppFollowUp() {
    setWhatsAppMessage(defaultWhatsAppFollowUp);
    setWhatsAppOpen(true);
  }

  function handleShareStudentWhatsApp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!student) {
      return;
    }

    const workspaceBranding = getWorkspaceBranding(tenantSettings, tenant);
    const message = buildGeneralFollowUpMessage({
      message: whatsAppMessage.trim() || defaultWhatsAppFollowUp,
      studentName: student.full_name,
      workspaceName: workspaceBranding.displayName,
    });
    const shareUrl = buildWhatsAppShareUrl(student.phone, message);

    window.open(shareUrl, "_blank", "noopener,noreferrer");
    setWhatsAppOpen(false);
  }

  useEffect(() => {
    let active = true;

    async function loadStudent() {
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

        const [
          currentStudent,
          tenantCourses,
          tenantCohorts,
          studentEnrollments,
          studentCohortMemberships,
          settings,
          memberRole,
        ] =
          await Promise.all([
            getStudentById({
              studentId,
              tenantId: currentTenant.id,
            }),
            getCoursesForTenant(currentTenant.id),
            getCohortsForTenant(currentTenant.id),
            getEnrollmentsForStudent({
              studentId,
              tenantId: currentTenant.id,
            }),
            getCohortsForStudent({
              studentId,
              tenantId: currentTenant.id,
            }),
            getTenantSettings(currentTenant.id),
            user
              ? getCurrentMemberRole(currentTenant.id, user.id)
              : Promise.resolve(null),
          ]);

        const financeAllowed = Boolean(
          currentStudent &&
            user &&
            (await hasEffectivePermission({
              action: "view_student_finance",
              entityId: studentId,
              entityType: "student",
              logUsage: false,
              permission: "view_payments",
              scopeId: studentId,
              scopeType: "student",
              tenantId: currentTenant.id,
              userId: user.id,
            })),
        );
        const [studentPayments, studentPaymentLinks] = financeAllowed
          ? await Promise.all([
              getPaymentsByStudent(studentId, currentTenant.id),
              getPaymentLinksByStudent(studentId, currentTenant.id),
            ])
          : [[], []];

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setTenantSettings(settings);
        setStudent(currentStudent);
        setCurrentRole(memberRole);
        setCanViewFinance(financeAllowed);
        setCourses(tenantCourses);
        setCohorts(tenantCohorts);
        setEnrollments(currentStudent ? studentEnrollments : []);
        setStudentCohorts(currentStudent ? studentCohortMemberships : []);
        setPayments(currentStudent ? studentPayments : []);
        setPaymentLinks(currentStudent ? studentPaymentLinks : []);

        if (currentStudent) {
          setForm(createFormFromStudent(currentStudent));
          setSelectedCourseId(
            tenantCourses.find(
              (course) =>
                !studentEnrollments.some(
                  (enrollment) => enrollment.course_id === course.id,
                ),
            )?.id ?? "",
          );
          setSelectedCohortId(
            tenantCohorts.find(
              (cohort) =>
                !studentCohortMemberships.some(
                  (membership) => membership.cohort_id === cohort.id,
                ),
            )?.id ?? "",
          );
        } else {
          setError("Student not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load this student."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStudent();

    return () => {
      active = false;
    };
  }, [router, studentId]);

  async function refreshEnrollments() {
    if (!tenant) {
      return;
    }

    const [studentEnrollments, tenantCourses] = await Promise.all([
      getEnrollmentsForStudent({
        studentId,
        tenantId: tenant.id,
      }),
      getCoursesForTenant(tenant.id),
    ]);
    setEnrollments(studentEnrollments);
    setCourses(tenantCourses);
    setSelectedCourseId(
      tenantCourses.find(
        (course) =>
          !studentEnrollments.some(
            (enrollment) => enrollment.course_id === course.id,
          ),
      )?.id ?? "",
    );
  }

  async function refreshCohorts() {
    if (!tenant) {
      return;
    }

    const [tenantCohorts, studentCohortMemberships] = await Promise.all([
      getCohortsForTenant(tenant.id),
      getCohortsForStudent({
        studentId,
        tenantId: tenant.id,
      }),
    ]);
    setCohorts(tenantCohorts);
    setStudentCohorts(studentCohortMemberships);
    setSelectedCohortId(
      tenantCohorts.find(
        (cohort) =>
          !studentCohortMemberships.some(
            (membership) => membership.cohort_id === cohort.id,
          ),
      )?.id ?? "",
    );
  }

  async function openPaymentLinkPanel() {
    router.push("/app/finance");
  }

  async function openPaymentPanel() {
    router.push("/app/finance");
  }

  async function openCohortPanel() {
    setActionError("");
    setCohortOpen(true);

    if (!tenant) {
      return;
    }

    try {
      await refreshCohorts();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load cohorts."));
    }
  }

  async function openEnrollmentPanel() {
    setActionError("");
    setEnrollOpen(true);

    if (!tenant) {
      return;
    }

    try {
      await refreshEnrollments();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to load available programs."),
      );
    }
  }

  async function handleUpdateStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setMutating(true);
    setActionError("");
    setActionMessage("");
    setActionMessage("");
    setActionMessage("");
    setActionMessage("");
    setActionMessage("");
    setActionMessage("");

    try {
      const updatedStudent = await updateStudent({
        ...form,
        studentId,
        tenantId: tenant.id,
      });
      setStudent(updatedStudent);
      setForm(createFormFromStudent(updatedStudent));
      setEditOpen(false);
      setActionMessage("Student updated.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update student."));
    } finally {
      setMutating(false);
    }
  }

  async function handleCreateEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedCourseId) {
      setActionError("Select a program before enrolling this student.");
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await createEnrollment({
        courseId: selectedCourseId,
        status: "active",
        studentId,
        tenantId: tenant.id,
      });
      setEnrollOpen(false);
      await refreshEnrollments();
      setActionMessage("Student enrolled.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create enrollment."));
    } finally {
      setMutating(false);
    }
  }

  async function handleAddToCohort(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedCohortId) {
      setActionError("Select a cohort before adding this student.");
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await addStudentToCohort({
        cohortId: selectedCohortId,
        studentId,
        tenantId: tenant.id,
      });
      setCohortOpen(false);
      await refreshCohorts();
      setActionMessage("Student added to cohort.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add student to cohort."));
    } finally {
      setMutating(false);
    }
  }

  async function handleEnrollmentStatusChange(
    enrollmentId: string,
    status: EnrollmentStatus,
  ) {
    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await updateEnrollmentStatus({
        enrollmentId,
        status,
        tenantId: tenant.id,
      });
      await refreshEnrollments();
      setActionMessage("Enrollment status updated.");
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to update enrollment status."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleCopyPaymentLink(value: string | null) {
    if (!value) {
      setActionError("This payment link does not have a URL yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setActionError("");
      setActionMessage("Payment link copied.");
    } catch {
      setActionError("Unable to copy link. Select and copy it manually.");
    }
  }

  async function handleDeleteEnrollment() {
    if (!tenant || !deleteEnrollmentTarget) {
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await deleteEnrollment({
        enrollmentId: deleteEnrollmentTarget.id,
        tenantId: tenant.id,
      });
      setDeleteEnrollmentTarget(null);
      await refreshEnrollments();
      setActionMessage("Enrollment deleted.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete enrollment."));
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteStudent() {
    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await deleteStudentRecord({
        studentId,
        tenantId: tenant.id,
      });
      router.replace("/app/students");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete student."));
      setMutating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading student</span>
        </Card>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">Student profile</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Student not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black"
            href="/app/students"
          >
            Back to students
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-slate-400 transition hover:text-white"
        href="/app/students"
      >
        Back to students
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Student profile
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {student.full_name}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                href={`/app/student-portal/${student.id}`}
                size="sm"
                variant="secondary"
              >
                Preview Student Portal
              </Button>
              <StudentStatusBadge status={student.status} />
            </div>
          </div>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-slate-400">Email</p>
              <p className="mt-2 wrap-break-word font-semibold">
                {student.email || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Phone</p>
              <p className="mt-2 font-semibold">
                {student.phone || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Source</p>
              <p className="mt-2 font-semibold">
                {student.source || "Direct"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(student.created_at)}
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-[#101214] p-5">
            <p className="text-sm font-semibold text-slate-400">Notes</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white">
              {student.notes || "No notes added yet."}
            </p>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">Workspace</p>
          <h3 className="mt-3 text-2xl font-semibold">
            {getWorkspaceBranding(tenantSettings, tenant).displayName}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            This student record is scoped to the current workspace and can only
            be loaded inside that workspace.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            {canAddLearningRelationship ? (
              <>
                <Button onClick={openEnrollmentPanel} type="button">
                  Enroll in Program
                </Button>
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                  onClick={openCohortPanel}
                  type="button"
                  variant="secondary"
                >
                  Add to Cohort
                </Button>
              </>
            ) : null}
            {canViewFinance ? (
              <Button
                className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                onClick={openPaymentPanel}
                type="button"
                variant="secondary"
              >
                Open Sales
              </Button>
            ) : null}
            <Button
              onClick={openWhatsAppFollowUp}
              type="button"
              variant="secondary"
            >
              WhatsApp Student
            </Button>
            <p className="text-xs leading-5 text-slate-500">
              {student.phone
                ? "WhatsApp opens with a pre-filled message. Sending is manual."
                : "Phone number missing. Opens generic WhatsApp share."}
            </p>
            <Button onClick={() => setEditOpen(true)} type="button">
              Edit Student
            </Button>
            {canDelete ? (
              <Button
                className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                onClick={() => setDeleteOpen(true)}
                type="button"
                variant="ghost"
              >
                Delete Student
              </Button>
            ) : null}
          </div>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6">
          <FeedbackAlert>{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{actionMessage}</FeedbackAlert>
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Enrollments
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Enrolled programs</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Use this section to assign programs to this student and track
                enrollment status. Payment records and cohorts stay in their own
                sections.
              </p>
            </div>
            {canAddLearningRelationship ? (
              <Button onClick={openEnrollmentPanel} type="button">
                Enroll in Program
              </Button>
            ) : null}
          </div>

          {enrollments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                EN
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No enrollments yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Enroll this student into a program to start tracking their
                learning relationship and progress status.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {enrollments.map((enrollment) => (
                <div
                  className="grid gap-4 rounded-2xl border border-white/10 bg-[#101214] p-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center"
                  key={enrollment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {enrollment.course?.title ?? "Program unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Enrolled {formatDate(enrollment.enrolled_at)}
                      {enrollment.completed_at
                        ? ` | Completed ${formatDate(enrollment.completed_at)}`
                        : ""}
                    </p>
                  </div>
                  <EnrollmentStatusBadge status={enrollment.status} />
                  <select
                    className="h-10 rounded-full border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white outline-none"
                    disabled={mutating}
                    onChange={(event) =>
                      handleEnrollmentStatusChange(
                        enrollment.id,
                        event.target.value as EnrollmentStatus,
                      )
                    }
                    value={enrollment.status}
                  >
                    {getEnrollmentStatusOptions(
                      enrollment.status,
                      student.status === "active",
                    ).map((status) => (
                        <option
                          className="text-slate-950"
                          key={status}
                          value={status}
                        >
                          {formatEnrollmentStatus(status as EnrollmentStatus)}
                        </option>
                      ))}
                  </select>
                  {canDelete ? (
                    <Button
                      className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                      onClick={() => setDeleteEnrollmentTarget(enrollment)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Cohorts
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Student batches</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Place this student into live batches without changing program
                enrollment or payment records.
              </p>
            </div>
            {canAddLearningRelationship ? (
              <Button onClick={openCohortPanel} type="button">
                Add to Cohort
              </Button>
            ) : null}
          </div>

          {studentCohorts.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                CO
              </div>
              <h4 className="mt-5 text-xl font-semibold">No cohorts yet</h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Add this student to a cohort once a program batch is ready.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {studentCohorts.map((membership) => (
                <div
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                  key={membership.id}
                >
                  <div>
                    <p className="font-semibold">
                      {membership.cohort?.name ?? "Cohort unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {membership.cohort?.course?.title ?? "Program unavailable"}
                    </p>
                  </div>
                  <p className="text-sm text-slate-400">
                    Added {formatDate(membership.enrolled_at)}
                  </p>
                  {membership.cohort ? (
                    <Link
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                      href={`/app/cohorts/${membership.cohort.id}`}
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {canViewFinance ? (
        <>
          <section className="mt-6">
            <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Historical Link Records
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Historical payment-link records
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                New fee plans, invoices, manual payments, and receipts are
                managed in Finance Center. Existing historical link records remain
                visible here for historical reference only.
              </p>
            </div>
            <Button onClick={openPaymentLinkPanel} type="button">
              View historical link records
            </Button>
          </div>

          {paymentLinks.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-(--coachos-brand) text-sm font-bold text-black">
                PL
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No historical link records
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Current invoices, manual payments, and receipts are managed in
                Finance Center.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {paymentLinks.map((link) => (
                <div className="bg-[#101214] p-4" key={link.id}>
                  <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-start">
                    <div>
                      <p className="font-semibold">
                        {formatCurrencyForPaymentLink(
                          link.amount,
                          link.currency || "INR",
                        )}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {link.course?.title ?? "No program linked"}
                      </p>
                      <p className="mt-3 wrap-break-word rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
                        {link.payment_url ?? "No payment URL"}
                      </p>
                    </div>
                    <Badge
                      className={
                        link.status === "paid"
                          ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                          : link.status === "expired" ||
                              link.status === "cancelled" ||
                              link.status === "failed"
                            ? "border-red-400/30 bg-red-500/10 text-red-300"
                            : "border-blue-400/30 bg-blue-500/10 text-blue-300"
                      }
                    >
                      {formatPaymentLinkStatus(link.status)}
                    </Badge>
                    <p className="text-sm text-slate-400">
                      Created {formatDate(link.created_at)}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => handleCopyPaymentLink(link.payment_url)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Copy
                    </Button>
                    <a
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                      href={getPaymentLinkWhatsAppUrl(link)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Share on WhatsApp
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 md:col-span-3">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Historical Payment Records
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Historical student payments
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Historical legacy payment records are shown here. New invoices,
                manual payments, and receipts are managed in Finance Center.
              </p>
            </div>
            <Button onClick={openPaymentPanel} type="button">
              View historical payment records
            </Button>
          </div>

          {payments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                PY
              </div>
              <h4 className="mt-5 text-xl font-semibold">No payments yet</h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Current invoices, manual payments, and receipts are managed in
                Finance Center.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {payments.map((payment) => (
                <div
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center"
                  key={payment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {formatCurrency(payment.amount)}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {payment.course?.title ?? "Program unavailable"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {payment.payment_method}
                  </p>
                  <PaymentStatusBadge status={payment.status} />
                  <p className="text-sm text-slate-400">
                    {formatDate(payment.paid_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {["Activity timeline", "Support notes"].map(
          (title, index) => (
          <Card
            className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10"
            key={title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Placeholder for a future module. No logic is connected here yet.
            </p>
          </Card>
          ),
        )}
          </section>
        </>
      ) : null}

      {enrollOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Enroll in Program</h3>
            <form className="mt-7 space-y-5" onSubmit={handleCreateEnrollment}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Program
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  required
                  value={selectedCourseId}
                >
                  <option className="text-slate-950" value="">
                    Select a program
                  </option>
                  {availableCourses.map((course) => (
                    <option
                      className="text-slate-950"
                      key={course.id}
                      value={course.id}
                    >
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>
              {courses.length === 0 ? (
                <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-300">
                  Create a program before enrolling this student.
                </p>
              ) : availableCourses.length === 0 ? (
                <p className="rounded-2xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-300">
                  This student is already enrolled in every available program.
                </p>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm leading-6 text-slate-400">
                  Enrollment status starts as active. Programs already connected
                  to this student are hidden from the selector. Status is used
                  for learning administration and does not add payment or expiry
                  rules in this module.
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                  onClick={() => setEnrollOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    mutating || !selectedCourseId || availableCourses.length === 0
                  }
                  type="submit"
                >
                  {mutating ? "Enrolling..." : "Enroll Student"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {cohortOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Add to Cohort</h3>
            <form className="mt-7 space-y-5" onSubmit={handleAddToCohort}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Cohort
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) => setSelectedCohortId(event.target.value)}
                  required
                  value={selectedCohortId}
                >
                  <option className="text-slate-950" value="">
                    Select a cohort
                  </option>
                  {availableCohorts.map((cohort) => (
                    <option
                      className="text-slate-950"
                      key={cohort.id}
                      value={cohort.id}
                    >
                      {cohort.name} - {cohort.course?.title ?? "No program"}
                    </option>
                  ))}
                </select>
              </label>
              {cohorts.length === 0 ? (
                <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-300">
                  Create a cohort before assigning this student to a batch.
                </p>
              ) : availableCohorts.length === 0 ? (
                <p className="rounded-2xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-300">
                  This student is already assigned to every available cohort.
                </p>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm leading-6 text-slate-400">
                  Cohorts already connected to this student are hidden from the
                  selector.
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                  onClick={() => setCohortOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    mutating || !selectedCohortId || availableCohorts.length === 0
                  }
                  type="submit"
                >
                  {mutating ? "Adding..." : "Add to Cohort"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {whatsAppOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">WhatsApp Student</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Edit the follow-up message for {student?.full_name ?? "this student"}.
              WhatsApp opens with a pre-filled message. Sending is manual.
            </p>
            <form className="mt-7 space-y-5" onSubmit={handleShareStudentWhatsApp}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Message
                </span>
                <textarea
                  className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) => setWhatsAppMessage(event.target.value)}
                  value={whatsAppMessage}
                />
              </label>
              {!student?.phone ? (
                <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-300">
                  Phone number missing. This will open generic WhatsApp share.
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                  onClick={() => setWhatsAppOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button type="submit">Share on WhatsApp</Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Edit student</h3>
            <form className="mt-7 space-y-5" onSubmit={handleUpdateStudent}>
              <StudentFormFields
                disableProfile={currentRole === "trainer"}
                disableStatus={currentRole === "trainer"}
                form={form}
                setForm={setForm}
              />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                  onClick={() => {
                    setForm(createFormFromStudent(student));
                    setEditOpen(false);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {deleteOpen && canDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-300">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Delete {student.full_name}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              This removes the student record. Enrollment and payment modules
              are not connected in this module.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                onClick={() => setDeleteOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-500! text-white! shadow-red-950/30 hover:bg-red-600!"
                disabled={mutating}
                onClick={handleDeleteStudent}
                type="button"
              >
                {mutating ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {deleteEnrollmentTarget && canDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-300">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Remove enrollment?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              This removes {student.full_name} from{" "}
              {deleteEnrollmentTarget.course?.title ?? "this program"}.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
                onClick={() => setDeleteEnrollmentTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-500! text-white! shadow-red-950/30 hover:bg-red-600!"
                disabled={mutating}
                onClick={handleDeleteEnrollment}
                type="button"
              >
                {mutating ? "Removing..." : "Remove"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
