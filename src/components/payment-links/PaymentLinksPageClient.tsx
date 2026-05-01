"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  getEnrollmentsForTenant,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import {
  buildManualUpiPaymentUrl,
  convertPaymentLinkToPayment,
  createPaymentLink,
  deletePaymentLink,
  getPaymentLinksForTenant,
  updatePaymentLinkStatus,
  type PaymentLinkStatus,
  type PaymentLinkWithRelations,
} from "@/src/lib/paymentLinks";
import { getStudentsForTenant, type Student } from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";
import {
  buildPaymentReminderMessage,
  buildWhatsAppShareUrl,
} from "@/src/lib/whatsapp";

type StatusFilter = "all" | PaymentLinkStatus;

type PaymentLinkFormState = {
  amount: string;
  courseId: string;
  description: string;
  enrollmentId: string;
  expiresAt: string;
  paymentUrl: string;
  studentId: string;
};

const emptyForm: PaymentLinkFormState = {
  amount: "",
  courseId: "",
  description: "",
  enrollmentId: "",
  expiresAt: "",
  paymentUrl: "",
  studentId: "",
};

const statusFilters: StatusFilter[] = [
  "all",
  "created",
  "sent",
  "paid",
  "expired",
  "cancelled",
  "failed",
];

const statusActions: { label: string; status: PaymentLinkStatus }[] = [
  { label: "Mark sent", status: "sent" },
  { label: "Mark paid", status: "paid" },
  { label: "Expire", status: "expired" },
  { label: "Cancel", status: "cancelled" },
];

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatStatus(value: string) {
  return value.replace("_", " ");
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function getSearchText(link: PaymentLinkWithRelations) {
  return [
    link.student?.full_name,
    link.student?.email,
    link.course?.title,
    link.status,
    link.provider,
    link.description,
    link.payment_url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getAvailableStatusActions(link: PaymentLinkWithRelations) {
  if (link.status === "created") {
    return statusActions;
  }

  if (link.status === "sent") {
    return statusActions.filter((action) => action.status !== "sent");
  }

  return [];
}

function getLifecycleLabel(status: PaymentLinkStatus) {
  if (status === "expired" || status === "cancelled" || status === "failed") {
    return `${formatStatus(status)} is a terminal status.`;
  }

  return "Lifecycle: Created -> Sent -> Paid";
}

export function PaymentLinkStatusBadge({
  status,
}: {
  status: PaymentLinkStatus;
}) {
  if (status === "paid") {
    return <Badge tone="success">Paid</Badge>;
  }

  if (status === "sent" || status === "created") {
    return <Badge tone="admin">{formatStatus(status)}</Badge>;
  }

  if (status === "expired" || status === "cancelled" || status === "failed") {
    return <Badge tone="danger">{formatStatus(status)}</Badge>;
  }

  return <Badge>{formatStatus(status)}</Badge>;
}

export function PaymentLinksPageClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PaymentLinkFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [links, setLinks] = useState<PaymentLinkWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [recordPaymentNotes, setRecordPaymentNotes] =
    useState("Paid via payment link");
  const [recordPaymentTarget, setRecordPaymentTarget] =
    useState<PaymentLinkWithRelations | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const filteredLinks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return links.filter((link) => {
      const matchesStatus =
        statusFilter === "all" || link.status === statusFilter;
      const matchesSearch =
        !normalizedSearch || getSearchText(link).includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [links, search, statusFilter]);

  const formStudentEnrollments = useMemo(
    () =>
      enrollments.filter(
        (enrollment) => enrollment.student_id === form.studentId,
      ),
    [enrollments, form.studentId],
  );

  async function loadContext(currentTenant: Tenant) {
    const [tenantLinks, tenantStudents, tenantCourses, tenantEnrollments] =
      await Promise.all([
        getPaymentLinksForTenant(currentTenant.id),
        getStudentsForTenant(currentTenant.id),
        getCoursesForTenant(currentTenant.id),
        getEnrollmentsForTenant(currentTenant.id),
      ]);

    setLinks(tenantLinks);
    setStudents(tenantStudents);
    setCourses(tenantCourses);
    setEnrollments(tenantEnrollments);
  }

  useEffect(() => {
    let active = true;

    async function loadPaymentLinks() {
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
        await loadContext(currentTenant);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load payment links."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPaymentLinks();

    return () => {
      active = false;
    };
  }, [router]);

  async function refreshLinks() {
    if (!tenant) {
      return;
    }

    setLinks(await getPaymentLinksForTenant(tenant.id));
  }

  function openCreateForm() {
    setActionError("");
    setSuccess("");
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openRecordPaymentModal(link: PaymentLinkWithRelations) {
    setActionError("");
    setSuccess("");

    if (link.status === "paid" && link.paid_at) {
      setActionError("Payment has already been recorded for this link.");
      return;
    }

    setRecordPaymentNotes(link.description || "Paid via payment link");
    setRecordPaymentTarget(link);
  }

  async function handleCopy(value: string | null) {
    if (!value) {
      setActionError("This payment link does not have a URL yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setActionError("");
      setSuccess("Payment link copied.");
    } catch {
      setActionError("Unable to copy link. Select and copy it manually.");
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    const amount = Number(form.amount);

    setMutatingId("create");
    setActionError("");
    setSuccess("");

    try {
      if (!form.studentId) {
        throw new Error("Select a student.");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Amount must be greater than zero.");
      }

      await createPaymentLink({
        amount,
        course_id: form.courseId || null,
        description: form.description,
        enrollment_id: form.enrollmentId || null,
        expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        payment_url: form.paymentUrl,
        student_id: form.studentId,
        tenant_id: tenant.id,
      });

      setForm(emptyForm);
      setFormOpen(false);
      await refreshLinks();
      setSuccess("Payment link created.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create payment link."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleStatusChange(
    link: PaymentLinkWithRelations,
    status: PaymentLinkStatus,
  ) {
    if (!tenant) {
      return;
    }

    if (status === "paid") {
      openRecordPaymentModal(link);
      return;
    }

    setMutatingId(link.id);
    setActionError("");
    setSuccess("");

    try {
      await updatePaymentLinkStatus(link.id, tenant.id, status);
      await refreshLinks();
      setSuccess(`Payment link marked ${formatStatus(status)}.`);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update payment link."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleConvert(link: PaymentLinkWithRelations) {
    if (!tenant) {
      return;
    }

    setMutatingId(`convert-${link.id}`);
    setActionError("");
    setSuccess("");

    try {
      await convertPaymentLinkToPayment(link.id, tenant.id, recordPaymentNotes);
      await refreshLinks();
      setRecordPaymentTarget(null);
      setRecordPaymentNotes("Paid via payment link");
      setSuccess("Payment recorded from link.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to record payment."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleDelete(link: PaymentLinkWithRelations) {
    if (!tenant) {
      return;
    }

    const confirmed = window.confirm("Delete this payment link?");

    if (!confirmed) {
      return;
    }

    setMutatingId(link.id);
    setActionError("");
    setSuccess("");

    try {
      await deletePaymentLink(link.id, tenant.id);
      await refreshLinks();
      setSuccess("Payment link deleted.");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete payment link."));
    } finally {
      setMutatingId("");
    }
  }

  const previewUrl =
    form.paymentUrl.trim() ||
    (Number(form.amount) > 0
      ? buildManualUpiPaymentUrl(Number(form.amount))
      : "upi://pay?pa=YOUR_UPI_ID&pn=CoachOS&am=AMOUNT&cu=INR");

  function getPaymentLinkShareUrl(link: PaymentLinkWithRelations) {
    const message = buildPaymentReminderMessage({
      amount: formatCurrency(link.amount, link.currency || "INR"),
      courseName: link.course?.title,
      paymentUrl: link.payment_url,
      studentName: link.student?.full_name,
      workspaceName: tenant?.name ?? "CoachOS",
    });

    return buildWhatsAppShareUrl(link.student?.phone, message);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            UPI foundation
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Payment Links
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Create manual UPI-ready payment links, copy them for sharing, and
            record completed payments without connecting a gateway yet.
          </p>
        </div>
        <Button onClick={openCreateForm} size="lg" type="button">
          Create Payment Link
        </Button>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-medium text-slate-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Search</span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student, course, or link"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              {statusFilters.map((status) => (
                <option className="text-slate-950" key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Manual mode uses placeholder UPI ID <strong>YOUR_UPI_ID</strong>.
          Replace it before sharing real payment instructions.
          <br />
          WhatsApp opens with a pre-filled message. Sending is done manually.
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

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

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-64 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading payment link</span>
            </Card>
          ))}
        </section>
      ) : filteredLinks.length === 0 ? (
        <EmptyState
          action={{ label: "Create Payment Link", onClick: openCreateForm }}
          description="Create a manual UPI placeholder link, share it with a student, then mark it paid and record the payment."
          icon="PL"
          title="No payment links found"
        />
      ) : (
        <section className="mt-6 grid gap-4 xl:grid-cols-2">
          {filteredLinks.map((link) => (
            <Card
              className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10"
              key={link.id}
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-medium text-slate-400">
                    {link.student?.full_name ?? "Student unavailable"}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">
                    {formatCurrency(link.amount, link.currency || "INR")}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    {link.course?.title ?? "No course linked"}
                  </p>
                </div>
                <PaymentLinkStatusBadge status={link.status} />
              </div>

              <div className="mt-5 grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
                <p>
                  Provider:{" "}
                  <span className="font-semibold text-white">
                    {link.provider}
                  </span>
                </p>
                <p>
                  Created:{" "}
                  <span className="font-semibold text-white">
                    {formatDate(link.created_at)}
                  </span>
                </p>
                <p>
                  Expires:{" "}
                  <span className="font-semibold text-white">
                    {formatDate(link.expires_at)}
                  </span>
                </p>
                <p>
                  Enrollment:{" "}
                  <span className="font-semibold text-white">
                    {link.enrollment ? link.enrollment.status : "Not linked"}
                  </span>
                </p>
              </div>

              <p className="mt-4 text-xs font-semibold text-slate-400">
                {getLifecycleLabel(link.status)}
              </p>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="wrap-break-word text-sm text-slate-300">
                  {link.payment_url ?? "No payment URL"}
                </p>
              </div>

              {link.description ? (
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  {link.description}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-5">
                <Button
                  onClick={() => handleCopy(link.payment_url)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Copy
                </Button>
                <a
                  className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                  href={getPaymentLinkShareUrl(link)}
                  rel="noreferrer"
                  target="_blank"
                >
                  Share on WhatsApp
                </a>
                {getAvailableStatusActions(link).map((action) => (
                  <Button
                    disabled={mutatingId === link.id}
                    key={action.status}
                    onClick={() => handleStatusChange(link, action.status)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {action.status === "paid" ? "Mark paid" : action.label}
                  </Button>
                ))}
                {link.status === "paid" && !link.paid_at ? (
                  <Button
                    disabled={mutatingId === `convert-${link.id}`}
                    onClick={() => openRecordPaymentModal(link)}
                    size="sm"
                    type="button"
                  >
                    {mutatingId === `convert-${link.id}`
                      ? "Recording..."
                      : "Record Payment"}
                  </Button>
                ) : null}
                <Button
                  className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                  disabled={mutatingId === link.id}
                  onClick={() => handleDelete(link)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  Manual UPI foundation
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Create Payment Link
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-500 transition hover:bg-white/10 hover:text-white"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreate}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Student
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      enrollmentId: "",
                      studentId: event.target.value,
                    }))
                  }
                  required
                  value={form.studentId}
                >
                  <option className="text-slate-950" value="">
                    Select a student
                  </option>
                  {students.map((student) => (
                    <option
                      className="text-slate-950"
                      key={student.id}
                      value={student.id}
                    >
                      {student.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Course
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        courseId: event.target.value,
                      }))
                    }
                    value={form.courseId}
                  >
                    <option className="text-slate-950" value="">
                      No course
                    </option>
                    {courses.map((course) => (
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
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Enrollment
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) => {
                      const enrollment = formStudentEnrollments.find(
                        (item) => item.id === event.target.value,
                      );

                      setForm((current) => ({
                        ...current,
                        courseId: enrollment?.course_id ?? current.courseId,
                        enrollmentId: event.target.value,
                      }));
                    }}
                    value={form.enrollmentId}
                  >
                    <option className="text-slate-950" value="">
                      No enrollment
                    </option>
                    {formStudentEnrollments.map((enrollment) => (
                      <option
                        className="text-slate-950"
                        key={enrollment.id}
                        value={enrollment.id}
                      >
                        {enrollment.course?.title ?? "Course unavailable"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Amount
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    min="0.01"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    placeholder="4999"
                    required
                    step="0.01"
                    type="number"
                    value={form.amount}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Expiry date
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        expiresAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={form.expiresAt}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Payment URL
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      paymentUrl: event.target.value,
                    }))
                  }
                  placeholder="Leave empty to generate manual UPI placeholder"
                  value={form.paymentUrl}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Course fee, installment context, or manual note."
                  value={form.description}
                />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Generated preview
                </p>
                <p className="mt-2 wrap-break-word text-sm text-slate-300">
                  {previewUrl}
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-white/10"
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutatingId === "create"} type="submit">
                  {mutatingId === "create"
                    ? "Creating..."
                    : "Create Payment Link"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {recordPaymentTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  Confirm payment
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Record UPI Link payment
                </h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-500 transition hover:bg-white/10 hover:text-white"
                onClick={() => setRecordPaymentTarget(null)}
                type="button"
              >
                X
              </button>
            </div>

            <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p>
                Student:{" "}
                <span className="font-semibold text-white">
                  {recordPaymentTarget.student?.full_name ??
                    "Student unavailable"}
                </span>
              </p>
              <p>
                Course:{" "}
                <span className="font-semibold text-white">
                  {recordPaymentTarget.course?.title ?? "No course linked"}
                </span>
              </p>
              <p>
                Amount:{" "}
                <span className="font-semibold text-white">
                  {formatCurrency(
                    recordPaymentTarget.amount,
                    recordPaymentTarget.currency || "INR",
                  )}
                </span>
              </p>
              <p>
                Payment method:{" "}
                <span className="font-semibold text-white">UPI Link</span>
              </p>
            </div>

            <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm font-semibold leading-6 text-amber-100">
              This will create a completed payment record.
            </p>

            <label className="mt-5 block">
              <span className="text-sm font-medium text-slate-300">
                Payment notes
              </span>
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                onChange={(event) => setRecordPaymentNotes(event.target.value)}
                placeholder="Paid via payment link"
                value={recordPaymentNotes}
              />
            </label>

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setRecordPaymentTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  mutatingId === `convert-${recordPaymentTarget.id}`
                }
                onClick={() => handleConvert(recordPaymentTarget)}
                type="button"
              >
                {mutatingId === `convert-${recordPaymentTarget.id}`
                  ? "Recording..."
                  : "Confirm and Record Payment"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
