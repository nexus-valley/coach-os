"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { TableShell } from "@/src/components/ui/TableShell";
import type { EnrollmentStatus } from "@/src/lib/enrollments";
import {
  defaultStudentDirectoryFilters,
  filterStudentDirectoryRows,
  getEnrollmentStatusLabel,
  getStudentDirectoryEmptyCopy,
  getStudentPortalStateLabel,
  sortStudentDirectoryRows,
  type StudentDirectoryEnrollment,
  type StudentDirectoryFilters,
  type StudentDirectoryPortalState,
  type StudentDirectoryRow,
  type StudentDirectorySort,
} from "@/src/lib/studentDirectory";
import {
  createStudent,
  getStudentDirectoryRows,
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

const enrollmentStatuses: EnrollmentStatus[] = [
  "active",
  "completed",
  "paused",
  "cancelled",
];

const portalStates: StudentDirectoryPortalState[] = [
  "access_active",
  "no_active_access",
  "access_unavailable",
  "status_restricted",
];

const studentStatusTones = {
  active: "success",
  blocked: "danger",
  inactive: "neutral",
  lead: "info",
} as const;

const enrollmentStatusTones = {
  active: "success",
  cancelled: "danger",
  completed: "info",
  paused: "warning",
} as const;

const portalStateTones = {
  access_active: "success",
  access_unavailable: "warning",
  no_active_access: "neutral",
  status_restricted: "outline",
} as const;

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

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return (
    <Badge tone={studentStatusTones[status]}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function ProgramSummary({
  enrollments,
}: {
  enrollments: StudentDirectoryEnrollment[];
}) {
  if (enrollments.length === 0) {
    return <span className="text-sm text-[#64748B]">Not enrolled</span>;
  }

  const visible = enrollments.slice(0, 2);
  const remaining = enrollments.length - visible.length;
  const remainingPrograms = enrollments
    .slice(visible.length)
    .map((enrollment) => `${enrollment.courseTitle} (${enrollment.status})`)
    .join(", ");

  return (
    <div className="space-y-2">
      {visible.map((enrollment) => (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          key={enrollment.id}
        >
          {enrollment.canOpenCourse ? (
            <Link
              className="max-w-full truncate text-sm font-semibold text-[#145DA0] hover:underline"
              href={`/app/courses/${enrollment.courseId}`}
            >
              {enrollment.courseTitle}
            </Link>
          ) : (
            <span className="max-w-full truncate text-sm font-semibold text-[#1E293B]">
              {enrollment.courseTitle}
            </span>
          )}
          <Badge tone={enrollmentStatusTones[enrollment.status]}>
            {getEnrollmentStatusLabel(enrollment.status)}
          </Badge>
        </div>
      ))}
      {remaining > 0 ? (
        <span
          aria-label={`${remaining} more programs: ${remainingPrograms}`}
          className="inline-flex text-xs font-semibold text-[#526A80]"
          title={remainingPrograms}
        >
          +{remaining} more
        </span>
      ) : null}
    </div>
  );
}

function PortalSummary({ state }: { state: StudentDirectoryPortalState }) {
  return (
    <Badge tone={portalStateTones[state]}>
      {getStudentPortalStateLabel(state)}
    </Badge>
  );
}

function DirectoryFilters({
  filters,
  onChange,
  onReset,
  programs,
  sort,
  setSort,
  statusCounts,
}: {
  filters: StudentDirectoryFilters;
  onChange: (filters: StudentDirectoryFilters) => void;
  onReset: () => void;
  programs: { id: string; title: string }[];
  sort: StudentDirectorySort;
  setSort: (sort: StudentDirectorySort) => void;
  statusCounts: Record<"all" | StudentStatus, number>;
}) {
  const controlClass =
    "h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm font-medium text-[#334155] outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10";

  return (
    <section aria-label="Student directory filters" className="mt-6">
      <div
        aria-label="Student status filter"
        className="flex flex-wrap gap-2"
        role="group"
      >
        {(["all", ...studentStatuses] as const).map((status) => (
          <button
            aria-pressed={filters.studentStatus === status}
            className={[
              "h-10 rounded-lg border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA]",
              filters.studentStatus === status
                ? "border-[#145DA0] bg-[#145DA0] text-white"
                : "border-[#CBD5E1] bg-white text-[#334155] hover:border-[#2ECBEA] hover:bg-[#F3FAFD]",
            ].join(" ")}
            key={status}
            onClick={() => onChange({ ...filters, studentStatus: status })}
            type="button"
          >
            {status === "all"
              ? "All"
              : status.charAt(0).toUpperCase() + status.slice(1)}{" "}
            {statusCounts[status]}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1.5fr)_repeat(4,minmax(9rem,1fr))]">
        <label className="relative block">
          <span className="mb-1.5 block text-xs font-semibold text-[#526A80]">
            Search students
          </span>
          <input
            className={`${controlClass} pr-11`}
            onChange={(event) =>
              onChange({ ...filters, search: event.target.value })
            }
            placeholder="Name, email, or phone"
            type="search"
            value={filters.search}
          />
          {filters.search ? (
            <button
              aria-label="Clear student search"
              className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-[#526A80] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]"
              onClick={() => onChange({ ...filters, search: "" })}
              type="button"
            >
              X
            </button>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#526A80]">
            Program
          </span>
          <select
            className={controlClass}
            onChange={(event) =>
              onChange({ ...filters, programId: event.target.value })
            }
            value={filters.programId}
          >
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#526A80]">
            Enrollment
          </span>
          <select
            className={controlClass}
            onChange={(event) =>
              onChange({
                ...filters,
                enrollmentStatus: event.target.value as
                  | "all"
                  | EnrollmentStatus,
              })
            }
            value={filters.enrollmentStatus}
          >
            <option value="all">All enrollments</option>
            {enrollmentStatuses.map((status) => (
              <option key={status} value={status}>
                {getEnrollmentStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#526A80]">
            Portal access
          </span>
          <select
            className={controlClass}
            onChange={(event) =>
              onChange({
                ...filters,
                portalState: event.target.value as
                  | "all"
                  | StudentDirectoryPortalState,
              })
            }
            value={filters.portalState}
          >
            <option value="all">All portal states</option>
            {portalStates.map((state) => (
              <option key={state} value={state}>
                {getStudentPortalStateLabel(state)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#526A80]">
            Sort
          </span>
          <select
            className={controlClass}
            onChange={(event) =>
              setSort(event.target.value as StudentDirectorySort)
            }
            value={sort}
          >
            <option value="newest">Newest</option>
            <option value="name">Name A-Z</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <Button onClick={onReset} size="sm" type="button" variant="ghost">
          Reset filters
        </Button>
      </div>
    </section>
  );
}

async function fetchDirectorySnapshot() {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    return null;
  }

  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  const memberRole = user
    ? await getCurrentMemberRole(tenant.id, user.id)
    : null;

  if (!memberRole) {
    throw new Error("Student directory access is not available.");
  }

  const rows = await getStudentDirectoryRows({
    memberRole,
    tenantId: tenant.id,
  });

  return { memberRole, rows, tenant };
}

export function StudentsPageClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<StudentDirectoryFilters>(
    defaultStudentDirectoryFilters,
  );
  const [form, setForm] = useState<StudentFormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<StudentFormErrors>({});
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberRole, setMemberRole] = useState<MemberRole | null>(null);
  const [rows, setRows] = useState<StudentDirectoryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<StudentDirectorySort>("newest");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  async function loadDirectory() {
    setLoading(true);
    setError("");

    try {
      const snapshot = await fetchDirectorySnapshot();

      if (!snapshot) {
        router.replace("/onboarding");
        return;
      }

      setMemberRole(snapshot.memberRole);
      setRows(snapshot.rows);
      setTenant(snapshot.tenant);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load students right now."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialDirectory() {
      try {
        const snapshot = await fetchDirectorySnapshot();

        if (!active) {
          return;
        }

        if (!snapshot) {
          router.replace("/onboarding");
          return;
        }

        setMemberRole(snapshot.memberRole);
        setRows(snapshot.rows);
        setTenant(snapshot.tenant);
      } catch (caught) {
        if (active) {
          setError(
            getErrorMessage(caught, "Unable to load students right now."),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialDirectory();

    return () => {
      active = false;
    };
  }, [router]);

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
      await createStudent({ ...form, tenantId: tenant.id });
      setForm(emptyForm);
      setFormOpen(false);
      await loadDirectory();
      setSuccess("Student added.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to add student. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const canCreateStudent = memberRole !== null && memberRole !== "trainer";
  const statusCounts = useMemo(
    () => ({
      active: rows.filter((row) => row.student.status === "active").length,
      all: rows.length,
      blocked: rows.filter((row) => row.student.status === "blocked").length,
      inactive: rows.filter((row) => row.student.status === "inactive").length,
      lead: rows.filter((row) => row.student.status === "lead").length,
    }),
    [rows],
  );
  const programs = useMemo(() => {
    const byId = new Map<string, string>();

    for (const row of rows) {
      for (const enrollment of row.enrollments) {
        byId.set(enrollment.courseId, enrollment.courseTitle);
      }
    }

    return Array.from(byId, ([id, title]) => ({ id, title })).sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  }, [rows]);
  const visibleRows = useMemo(
    () =>
      sortStudentDirectoryRows(
        filterStudentDirectoryRows(rows, filters),
        sort,
      ),
    [filters, rows, sort],
  );
  const hasSearch = Boolean(filters.search.trim());
  const hasFilters =
    filters.studentStatus !== "all" ||
    Boolean(filters.programId) ||
    filters.enrollmentStatus !== "all" ||
    filters.portalState !== "all";
  const emptyCopy = getStudentDirectoryEmptyCopy({
    hasFilters,
    hasSearch,
    totalStudents: rows.length,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        actions={
          canCreateStudent ? (
            <Button onClick={() => setFormOpen(true)} type="button">
              Add Student
            </Button>
          ) : null
        }
        description="Find students, review their program relationships, and open the right record for the next action."
        eyebrow="Student operations"
        metadata={
          <Badge tone={loading ? "neutral" : "info"}>
            {loading ? "Loading students" : `${rows.length} students`}
          </Badge>
        }
        title="Students"
      />

      {success ? (
        <FeedbackAlert className="mt-6" tone="success">
          {success}
        </FeedbackAlert>
      ) : null}

      <DirectoryFilters
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(defaultStudentDirectoryFilters)}
        programs={programs}
        setSort={setSort}
        sort={sort}
        statusCounts={statusCounts}
      />

      {error ? (
        <EmptyState
          action={{ label: "Try again", onClick: () => void loadDirectory() }}
          description="No student information was changed. Reload the directory to try again."
          eyebrow="Unable to load"
          title="Student directory is unavailable"
        />
      ) : loading ? (
        <div
          aria-label="Loading student directory"
          aria-live="polite"
          className="mt-6 space-y-3"
        >
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visibleRows.length === 0 ? (
        <EmptyState
          action={
            rows.length === 0 && canCreateStudent
              ? { label: "Add Student", onClick: () => setFormOpen(true) }
              : hasFilters || hasSearch
                ? { label: "Reset filters", onClick: () => setFilters(defaultStudentDirectoryFilters) }
                : undefined
          }
          description={emptyCopy.description}
          title={emptyCopy.title}
        />
      ) : (
        <TableShell
          className="mt-6 border-[#CBD5E1] shadow-sm shadow-slate-950/5"
          description={`${visibleRows.length} of ${rows.length} student${rows.length === 1 ? "" : "s"} in this view`}
          title="Student directory"
        >
          <div className="hidden min-w-[920px] lg:block">
            <div className="grid grid-cols-[1.2fr_0.65fr_1.45fr_0.85fr_auto] gap-5 border-b border-[#CBD5E1] bg-[#F8FAFC] px-5 py-3 text-xs font-semibold text-[#475569]">
              <span>Student</span>
              <span>Status</span>
              <span>Programs</span>
              <span>Portal access</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {visibleRows.map((row) => (
                <div
                  className="grid grid-cols-[1.2fr_0.65fr_1.45fr_0.85fr_auto] items-center gap-5 px-5 py-4"
                  key={row.student.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0B1F33]">
                      {row.student.full_name}
                    </p>
                    <p className="mt-1 truncate text-sm text-[#526A80]">
                      {row.student.email || "No email provided"}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#64748B]">
                      {row.student.phone || "No phone provided"}
                    </p>
                  </div>
                  <StudentStatusBadge status={row.student.status} />
                  <ProgramSummary enrollments={row.enrollments} />
                  <PortalSummary state={row.portalState} />
                  <Button
                    href={`/app/students/${row.student.id}`}
                    size="sm"
                    variant="secondary"
                  >
                    View student
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0] lg:hidden">
            {visibleRows.map((row) => (
              <article className="p-4" key={row.student.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-[#0B1F33]">
                      {row.student.full_name}
                    </h2>
                    <p className="mt-1 break-words text-sm text-[#526A80]">
                      {row.student.email || "No email provided"}
                    </p>
                    <p className="mt-1 text-sm text-[#64748B]">
                      {row.student.phone || "No phone provided"}
                    </p>
                  </div>
                  <StudentStatusBadge status={row.student.status} />
                </div>
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs font-semibold text-[#64748B]">
                      Programs
                    </dt>
                    <dd className="mt-2">
                      <ProgramSummary enrollments={row.enrollments} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-[#64748B]">
                      Portal
                    </dt>
                    <dd className="mt-2">
                      <PortalSummary state={row.portalState} />
                    </dd>
                  </div>
                </dl>
                <div className="mt-5">
                  <Button
                    fullWidth
                    href={`/app/students/${row.student.id}`}
                    size="sm"
                    variant="secondary"
                  >
                    View student
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </TableShell>
      )}

      {formOpen && canCreateStudent ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#475569]">
                  New student record
                </p>
                <h3 className="mt-2 text-2xl font-semibold">Add Student</h3>
              </div>
              <button
                aria-label="Close Add Student"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#CBD5E1] text-sm font-semibold text-[#475569] transition hover:bg-[#F8FAFC] hover:text-[#0B1F33]"
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
      ? "mt-2 h-12 w-full rounded-lg border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
      : "mt-2 h-12 w-full rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10";
  const textAreaClass =
    tone === "dark"
      ? "mt-2 min-h-28 w-full resize-none rounded-lg border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
      : "mt-2 min-h-28 w-full resize-none rounded-lg border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10";

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
          className={controlClass}
          disabled={disableProfile}
          id="student-full-name"
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
            className={controlClass}
            disabled={disableProfile}
            id="student-email"
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
            className={controlClass}
            disabled={disableProfile}
            id="student-phone"
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
            className={controlClass}
            disabled={disableStatus}
            id="student-status"
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
            className={controlClass}
            disabled={disableProfile}
            id="student-source"
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
          className={textAreaClass}
          id="student-notes"
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
