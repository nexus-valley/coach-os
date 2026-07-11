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
import { Skeleton } from "@/src/components/ui/Skeleton";
import { TableShell } from "@/src/components/ui/TableShell";
import {
  createStudent,
  getStudentsForTenant,
  type Student,
  type StudentStatus,
} from "@/src/lib/students";
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

        const tenantStudents = await getStudentsForTenant(currentTenant.id);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setStudents(tenantStudents);
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

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Student CRM
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Students
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Manage student records, lead sources, contact context, and CRM
            notes for this workspace.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} size="lg" type="button">
          Add Student
        </Button>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-white">
            {students.length} {students.length === 1 ? "student" : "students"}
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
          action={{ label: "Add Student", onClick: () => setFormOpen(true) }}
          description="Add your first student or lead to begin building the CRM layer. Enrollment and payment history will connect automatically."
          icon="SD"
          title="No students added yet"
        />
      ) : (
        <TableShell className="mt-6 border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
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
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-400">New CRM record</p>
                <h3 className="mt-2 text-2xl font-semibold">Add Student</h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-slate-400 transition hover:bg-white/10 hover:text-white"
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
              />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-slate-700! bg-white/10! text-white! hover:bg-white/15!"
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
  errors = {},
  form,
  setForm,
}: {
  errors?: StudentFormErrors;
  form: StudentFormState;
  setForm: React.Dispatch<React.SetStateAction<StudentFormState>>;
}) {
  return (
    <>
      <FormField
        error={errors.fullName}
        htmlFor="student-full-name"
        label="Full name"
        required
        tone="dark"
      >
        <input
          id="student-full-name"
          className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
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
          tone="dark"
        >
          <input
            id="student-email"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="student@example.com"
            type="email"
            value={form.email}
          />
        </FormField>
        <FormField htmlFor="student-phone" label="Phone" tone="dark">
          <input
            id="student-phone"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
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
        <FormField htmlFor="student-status" label="Status" tone="dark">
          <select
            id="student-status"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
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
        <FormField htmlFor="student-source" label="Source" tone="dark">
          <input
            id="student-source"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value }))
            }
            placeholder="Referral, webinar, Instagram"
            type="text"
            value={form.source}
          />
        </FormField>
      </div>

      <FormField htmlFor="student-notes" label="Notes" tone="dark">
        <textarea
          id="student-notes"
          className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder="Add CRM context, goals, or support notes."
          value={form.notes}
        />
      </FormField>
    </>
  );
}

export { emptyForm as emptyStudentForm };
export type { StudentFormState };
