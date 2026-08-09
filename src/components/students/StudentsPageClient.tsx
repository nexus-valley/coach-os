"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { TableShell } from "@/src/components/ui/TableShell";
import {
  createStudent,
  getStudentsForTenant,
  type Student,
  type StudentStatus,
} from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

const studentStatuses: StudentStatus[] = [
  "active",
  "inactive",
  "lead",
  "blocked",
];

type StudentFormState = {
  email: string;
  fullName: string;
  notes: string;
  phone: string;
  source: string;
  status: StudentStatus;
};

type StudentFormErrors = Partial<Record<keyof StudentFormState, string>>;

const emptyForm: StudentFormState = {
  email: "",
  fullName: "",
  notes: "",
  phone: "",
  source: "",
  status: "lead",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  if (status === "active") {
    return <Badge tone="success">Active</Badge>;
  }

  if (status === "blocked") {
    return <Badge tone="danger">Blocked</Badge>;
  }

  if (status === "lead") {
    return <Badge tone="admin">Lead</Badge>;
  }

  return <Badge tone="staff">Inactive</Badge>;
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function validateStudentForm(form: StudentFormState) {
  const errors: StudentFormErrors = {};

  if (!form.fullName.trim()) {
    errors.fullName = "Full name is required.";
  }

  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

export function StudentsPageClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentFormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<StudentFormErrors>({});
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberRole, setMemberRole] = useState<MemberRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStudents() {
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

        const [tenantStudents, currentRole] = await Promise.all([
          getStudentsForTenant(currentTenant.id),
          user
            ? getCurrentMemberRole(currentTenant.id, user.id)
            : Promise.resolve(null),
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setStudents(tenantStudents);
        setMemberRole(currentRole);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load students right now."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStudents();

    return () => {
      active = false;
    };
  }, [router]);

  async function refreshStudents() {
    if (!tenant) {
      return;
    }

    setStudents(await getStudentsForTenant(tenant.id));
  }

  async function handleCreateStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    const validationErrors = validateStudentForm(form);

    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }

    setSaving(true);
    setError("");
    setFormErrors({});
    setSuccess("");

    try {
      await createStudent({
        ...form,
        tenantId: tenant.id,
      });
      setForm(emptyForm);
      setFormOpen(false);
      await refreshStudents();
      setSuccess("Student added.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to add student. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const activeStudents = students.filter((student) => student.status === "active")
    .length;
  const leadStudents = students.filter((student) => student.status === "lead")
    .length;
  const blockedStudents = students.filter((student) => student.status === "blocked")
    .length;
  const canCreateStudent = memberRole !== null && memberRole !== "trainer";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            People workflow
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Students
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Add students, keep their contact details organized, and enroll them
            into the right programs when they are ready to learn.
          </p>
        </div>
        {canCreateStudent ? (
          <Button onClick={() => setFormOpen(true)} size="lg" type="button">
            Add Student
          </Button>
        ) : null}
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-slate-400">Current workspace</p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Start with a clean student record, then enroll the student into
              one or more programs from their profile.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/10 p-4">
              <p className="text-2xl font-semibold">{students.length}</p>
              <p className="mt-1 text-sm text-slate-400">Total records</p>
            </div>
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
              <p className="text-2xl font-semibold text-emerald-200">
                {activeStudents}
              </p>
              <p className="mt-1 text-sm text-emerald-100/80">Active students</p>
            </div>
            <div className="rounded-lg border border-sky-400/20 bg-sky-400/10 p-4">
              <p className="text-2xl font-semibold text-sky-200">
                {leadStudents}
              </p>
              <p className="mt-1 text-sm text-sky-100/80">Leads to follow up</p>
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert
            onRetry={() => window.location.reload()}
            tone="error"
          >
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {success ? (
        <div className="mt-6">
          <FeedbackAlert tone="success">{success}</FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4">
          {[0, 1, 2].map((item) => (
            <Card
              className="border-white/10 bg-[#101214] p-5"
              key={item}
            >
              <span className="sr-only">Loading student</span>
              <Skeleton className="h-5 w-44 bg-white/10" />
              <Skeleton className="mt-4 h-4 w-full max-w-md bg-white/10" />
            </Card>
          ))}
        </section>
      ) : students.length === 0 ? (
        <EmptyState
          action={
            canCreateStudent
              ? { label: "Add Student", onClick: () => setFormOpen(true) }
              : undefined
          }
          description="Add a student first, then open their profile to enroll them into one or more programs."
          icon="SD"
          title="No students added yet"
        />
      ) : (
        <section className="mt-6">
          <SectionHeader
            actions={
              blockedStudents > 0 ? (
                <Badge tone="danger">{blockedStudents} blocked</Badge>
              ) : (
                <Badge className="border-white/15 bg-white/10 text-white">
                  Ready for enrollment
                </Badge>
              )
            }
            className="mb-4"
            description={
              <span className="text-slate-400">
                Review contact readiness, lead source, and status before
                enrolling students into programs.
              </span>
            }
            title={<span className="text-white">Student directory</span>}
          />
          <TableShell className="border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
            <div className="hidden grid-cols-[1.2fr_1fr_0.8fr_0.7fr_0.8fr_0.7fr] gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold text-slate-400 lg:grid">
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Status</span>
              <span>Source</span>
              <span>Created</span>
            </div>
            <div className="divide-y divide-white/10">
              {students.map((student) => (
                <Link
                  className="grid gap-4 px-5 py-5 transition hover:bg-white/10 lg:grid-cols-[1.2fr_1fr_0.8fr_0.7fr_0.8fr_0.7fr] lg:items-center"
                  href={`/app/students/${student.id}`}
                  key={student.id}
                >
                  <div>
                    <p className="font-semibold text-white">
                      {student.full_name}
                    </p>
                    <p className="mt-1 text-sm text-slate-400 lg:hidden">
                      {student.email || "No email"}
                    </p>
                  </div>
                  <p className="hidden truncate text-sm text-slate-400 lg:block">
                    {student.email || "No email"}
                  </p>
                  <p className="text-sm text-slate-400">
                    {student.phone || "No phone"}
                  </p>
                  <StudentStatusBadge status={student.status} />
                  <p className="text-sm text-slate-400">
                    {student.source || "Direct"}
                  </p>
                  <p className="text-sm text-slate-400">
                    {formatDate(student.created_at)}
                  </p>
                </Link>
              ))}
            </div>
          </TableShell>
        </section>
      )}

      {formOpen && canCreateStudent ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#475569]">New student record</p>
                <h3 className="mt-2 text-2xl font-semibold">Add Student</h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#CBD5E1] text-sm font-semibold text-[#475569] transition hover:bg-[#F8FAFC] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateStudent}>
              <StudentFormFields
                errors={formErrors}
                form={form}
                setForm={setForm}
                tone="light"
              />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Adding..." : "Add Student"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export function StudentFormFields({
  disableProfile = false,
  disableStatus = false,
  errors = {},
  form,
  setForm,
  tone = "dark",
}: {
  disableProfile?: boolean;
  disableStatus?: boolean;
  errors?: StudentFormErrors;
  form: StudentFormState;
  setForm: React.Dispatch<React.SetStateAction<StudentFormState>>;
  tone?: "dark" | "light";
}) {
  const fieldTone = tone === "dark" ? "dark" : "light";
  const controlClass =
    tone === "dark"
      ? "mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
      : "mt-2 h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10";
  const textAreaClass =
    tone === "dark"
      ? "mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
      : "mt-2 min-h-28 w-full resize-none rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10";

  return (
    <>
      <FormField
        error={errors.fullName}
        htmlFor="student-full-name"
        label="Full name"
        required
        tone={fieldTone}
      >
        <input
          id="student-full-name"
          className={controlClass}
          disabled={disableProfile}
          onChange={(event) =>
            setForm((current) => ({ ...current, fullName: event.target.value }))
          }
          placeholder="Student name"
          required
          type="text"
          value={form.fullName}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          error={errors.email}
          htmlFor="student-email"
          label="Email"
          tone={fieldTone}
        >
          <input
            id="student-email"
            className={controlClass}
            disabled={disableProfile}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="student@example.com"
            type="email"
            value={form.email}
          />
        </FormField>
        <FormField htmlFor="student-phone" label="Phone" tone={fieldTone}>
          <input
            id="student-phone"
            className={controlClass}
            disabled={disableProfile}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            placeholder="+1 555 000 0000"
            type="tel"
            value={form.phone}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="student-status" label="Status" tone={fieldTone}>
          <select
            id="student-status"
            className={controlClass}
            disabled={disableStatus}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as StudentStatus,
              }))
            }
            value={form.status}
          >
            {studentStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </FormField>
        <FormField htmlFor="student-source" label="Source" tone={fieldTone}>
          <input
            id="student-source"
            className={controlClass}
            disabled={disableProfile}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            placeholder="Referral, webinar, Instagram"
            type="text"
            value={form.source}
          />
        </FormField>
      </div>

      <FormField htmlFor="student-notes" label="Notes" tone={fieldTone}>
        <textarea
          id="student-notes"
          className={textAreaClass}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder="Add goals, context, or support notes."
          value={form.notes}
        />
      </FormField>
    </>
  );
}

export { emptyForm as emptyStudentForm };
export type { StudentFormState };
