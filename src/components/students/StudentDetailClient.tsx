"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
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
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  createEnrollment,
  deleteEnrollment,
  getEnrollmentsForStudent,
  updateEnrollmentStatus,
  type EnrollmentStatus,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import {
  createPayment,
  getPaymentsByStudent,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentWithRelations,
} from "@/src/lib/payments";
import {
  deleteStudent as deleteStudentRecord,
  getStudentById,
  updateStudent,
  type Student,
} from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StudentDetailClientProps = {
  studentId: string;
};

type PaymentFormState = {
  amount: string;
  notes: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
};

const emptyPaymentForm: PaymentFormState = {
  amount: "",
  notes: "",
  paymentMethod: "UPI",
  status: "completed",
};

const paymentMethods: PaymentMethod[] = ["UPI", "Cash", "Bank"];
const paymentStatuses: PaymentStatus[] = ["completed", "pending", "failed"];

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
  const [courses, setCourses] = useState<Course[]>([]);
  const [deleteEnrollmentTarget, setDeleteEnrollmentTarget] =
    useState<EnrollmentWithRelations | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentFormState>(emptyStudentForm);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [paymentForm, setPaymentForm] =
    useState<PaymentFormState>(emptyPaymentForm);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

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

  const selectedEnrollment = enrollments.find(
    (enrollment) => enrollment.id === selectedEnrollmentId,
  );

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

        const [
          currentStudent,
          tenantCourses,
          studentEnrollments,
          studentPayments,
        ] =
          await Promise.all([
            getStudentById({
              studentId,
              tenantId: currentTenant.id,
            }),
            getCoursesForTenant(currentTenant.id),
            getEnrollmentsForStudent({
              studentId,
              tenantId: currentTenant.id,
            }),
            getPaymentsByStudent(studentId, currentTenant.id),
          ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setStudent(currentStudent);
        setCourses(tenantCourses);
        setEnrollments(currentStudent ? studentEnrollments : []);
        setPayments(currentStudent ? studentPayments : []);

        if (currentStudent) {
          setForm(createFormFromStudent(currentStudent));
          setSelectedEnrollmentId(studentEnrollments[0]?.id ?? "");
          setSelectedCourseId(
            tenantCourses.find(
              (course) =>
                !studentEnrollments.some(
                  (enrollment) => enrollment.course_id === course.id,
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

  async function refreshPayments() {
    if (!tenant) {
      return;
    }

    setPayments(await getPaymentsByStudent(studentId, tenant.id));
  }

  async function openPaymentPanel() {
    setActionError("");
    setPaymentOpen(true);

    if (!tenant) {
      return;
    }

    try {
      const [studentEnrollments, studentPayments] = await Promise.all([
        getEnrollmentsForStudent({
          studentId,
          tenantId: tenant.id,
        }),
        getPaymentsByStudent(studentId, tenant.id),
      ]);
      setEnrollments(studentEnrollments);
      setPayments(studentPayments);
      setSelectedEnrollmentId(studentEnrollments[0]?.id ?? "");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load payment context."));
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
        getErrorMessage(caught, "Unable to load available courses."),
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

    try {
      const updatedStudent = await updateStudent({
        ...form,
        studentId,
        tenantId: tenant.id,
      });
      setStudent(updatedStudent);
      setForm(createFormFromStudent(updatedStudent));
      setEditOpen(false);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update student."));
    } finally {
      setMutating(false);
    }
  }

  async function handleCreateEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedCourseId) {
      setActionError("Select a course before enrolling this student.");
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
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create enrollment."));
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
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to update enrollment status."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedEnrollment) {
      setActionError("Select an enrollment before adding a payment.");
      return;
    }

    const amount = Number(paymentForm.amount);

    setMutating(true);
    setActionError("");

    try {
      await createPayment({
        amount,
        course_id: selectedEnrollment.course_id,
        enrollment_id: selectedEnrollment.id,
        notes: paymentForm.notes,
        payment_method: paymentForm.paymentMethod,
        status: paymentForm.status,
        student_id: studentId,
        tenant_id: tenant.id,
      });
      setPaymentForm(emptyPaymentForm);
      setPaymentOpen(false);
      await refreshPayments();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add payment."));
    } finally {
      setMutating(false);
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
        <Card className="h-72 animate-pulse border-white/10 bg-white/6">
          <span className="sr-only">Loading student</span>
        </Card>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Student profile</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Student not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white"
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
        className="text-sm font-semibold text-zinc-400 transition hover:text-white"
        href="/app/students"
      >
        Back to students
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-white/6 p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Student profile
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {student.full_name}
              </h2>
            </div>
            <StudentStatusBadge status={student.status} />
          </div>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-zinc-500">Email</p>
              <p className="mt-2 wrap-break-word font-semibold">
                {student.email || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Phone</p>
              <p className="mt-2 font-semibold">
                {student.phone || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Source</p>
              <p className="mt-2 font-semibold">
                {student.source || "Direct"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(student.created_at)}
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/35 p-5">
            <p className="text-sm font-semibold text-zinc-400">Notes</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {student.notes || "No notes added yet."}
            </p>
          </div>
        </Card>

        <Card className="border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Workspace</p>
          <h3 className="mt-3 text-2xl font-semibold">{tenant?.name}</h3>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            This CRM record is scoped to the current tenant and cannot be loaded
            without the matching workspace id.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <Button onClick={openEnrollmentPanel} type="button">
              Enroll in Course
            </Button>
            <Button onClick={openPaymentPanel} type="button" variant="secondary">
              Add Payment
            </Button>
            <Button onClick={() => setEditOpen(true)} type="button">
              Edit Student
            </Button>
            <Button
              className="text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setDeleteOpen(true)}
              type="button"
              variant="ghost"
            >
              Delete Student
            </Button>
          </div>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-white/6 p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Enrollments
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Enrolled courses</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Connect this student to course products. Payments and cohorts
                remain separate future modules.
              </p>
            </div>
            <Button
              className="bg-white text-zinc-950 hover:bg-zinc-100"
              onClick={openEnrollmentPanel}
              type="button"
            >
              Enroll in Course
            </Button>
          </div>

          {enrollments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-zinc-950/30 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
                EN
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No enrollments yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                Enroll this student into a course to start tracking learning
                access and completion status.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {enrollments.map((enrollment) => (
                <div
                  className="grid gap-4 rounded-2xl border border-white/10 bg-zinc-950/35 p-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center"
                  key={enrollment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {enrollment.course?.title ?? "Course unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
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
                    {["active", "completed", "paused", "cancelled"].map(
                      (status) => (
                        <option
                          className="text-zinc-950"
                          key={status}
                          value={status}
                        >
                          {status}
                        </option>
                      ),
                    )}
                  </select>
                  <Button
                    className="text-red-200 hover:bg-red-500/10 hover:text-red-100"
                    onClick={() => setDeleteEnrollmentTarget(enrollment)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="border-white/10 bg-white/6 p-6 text-white shadow-2xl shadow-black/10 md:col-span-3">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Payment History
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">Student payments</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Track payments connected to this student&apos;s course
                enrollments.
              </p>
            </div>
            <Button
              className="bg-white text-zinc-950 hover:bg-zinc-100"
              onClick={openPaymentPanel}
              type="button"
            >
              Add Payment
            </Button>
          </div>

          {payments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-zinc-950/30 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
                PY
              </div>
              <h4 className="mt-5 text-xl font-semibold">No payments yet</h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                Add a payment once this student has an enrollment connected to a
                course.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {payments.map((payment) => (
                <div
                  className="grid gap-4 bg-zinc-950/30 p-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center"
                  key={payment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {formatCurrency(payment.amount)}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {payment.course?.title ?? "Course unavailable"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-zinc-300">
                    {payment.payment_method}
                  </p>
                  <PaymentStatusBadge status={payment.status} />
                  <p className="text-sm text-zinc-500">
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
            className="border-white/10 bg-white/6 p-6 text-white shadow-2xl shadow-black/10"
            key={title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Placeholder for a future module. No logic is connected here yet.
            </p>
          </Card>
          ),
        )}
      </section>

      {enrollOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Enroll in Course</h3>
            <form className="mt-7 space-y-5" onSubmit={handleCreateEnrollment}>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Course
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  required
                  value={selectedCourseId}
                >
                  <option className="text-zinc-950" value="">
                    Select a course
                  </option>
                  {availableCourses.map((course) => (
                    <option
                      className="text-zinc-950"
                      key={course.id}
                      value={course.id}
                    >
                      {course.title}
                    </option>
                  ))}
                </select>
              </label>
              {courses.length === 0 ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  Create a course before enrolling this student.
                </p>
              ) : availableCourses.length === 0 ? (
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
                  This student is already enrolled in every available course.
                </p>
              ) : (
                <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-500">
                  Enrollment status starts as active. Courses already connected
                  to this student are hidden from the selector.
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
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

      {paymentOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Add Payment</h3>
            <form className="mt-7 space-y-5" onSubmit={handleCreatePayment}>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Enrollment
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setSelectedEnrollmentId(event.target.value)
                  }
                  required
                  value={selectedEnrollmentId}
                >
                  <option className="text-zinc-950" value="">
                    Select an enrollment
                  </option>
                  {enrollments.map((enrollment) => (
                    <option
                      className="text-zinc-950"
                      key={enrollment.id}
                      value={enrollment.id}
                    >
                      {enrollment.course?.title ?? "Course unavailable"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Amount
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                    min="0"
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    placeholder="499"
                    required
                    step="0.01"
                    type="number"
                    value={paymentForm.amount}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Method
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        paymentMethod: event.target.value as PaymentMethod,
                      }))
                    }
                    value={paymentForm.paymentMethod}
                  >
                    {paymentMethods.map((method) => (
                      <option className="text-zinc-950" key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Status
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        status: event.target.value as PaymentStatus,
                      }))
                    }
                    value={paymentForm.status}
                  >
                    {paymentStatuses.map((status) => (
                      <option className="text-zinc-950" key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Notes</span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) =>
                    setPaymentForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Receipt reference, installment notes, or context."
                  value={paymentForm.notes}
                />
              </label>

              {enrollments.length === 0 ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  Enroll this student in a course before adding a payment.
                </p>
              ) : (
                <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-500">
                  Course and enrollment are attached automatically from the
                  selected enrollment.
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setPaymentOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={mutating || !selectedEnrollmentId}
                  type="submit"
                >
                  {mutating ? "Adding..." : "Add Payment"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Edit student</h3>
            <form className="mt-7 space-y-5" onSubmit={handleUpdateStudent}>
              <StudentFormFields form={form} setForm={setForm} />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
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

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-600">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Delete {student.full_name}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              This removes the student CRM record. Enrollment and payment
              modules are not connected in this module.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setDeleteOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 shadow-red-600/20 hover:bg-red-700"
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

      {deleteEnrollmentTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-600">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Remove enrollment?
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              This removes {student.full_name} from{" "}
              {deleteEnrollmentTarget.course?.title ?? "this course"}.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setDeleteEnrollmentTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 shadow-red-600/20 hover:bg-red-700"
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
