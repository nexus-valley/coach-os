"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  addStudentToCohort,
  getCohortById,
  getCohortMembers,
  removeStudentFromCohort,
  type CohortMemberWithStudent,
  type CohortWithCourse,
} from "@/src/lib/cohorts";
import { getStudentsForTenant, type Student } from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CohortDetailClientProps = {
  cohortId: string;
};

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

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function CohortDetailClient({ cohortId }: CohortDetailClientProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [cohort, setCohort] = useState<CohortWithCourse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<CohortMemberWithStudent[]>([]);
  const [mutating, setMutating] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const availableStudents = useMemo(
    () =>
      students.filter(
        (student) =>
          !members.some((member) => member.student_id === student.id),
      ),
    [members, students],
  );

  const loadCohortContext = useCallback(async (currentTenant: Tenant) => {
    const [currentCohort, cohortMembers, tenantStudents] = await Promise.all([
      getCohortById({
        cohortId,
        tenantId: currentTenant.id,
      }),
      getCohortMembers({
        cohortId,
        tenantId: currentTenant.id,
      }),
      getStudentsForTenant(currentTenant.id),
    ]);

    setCohort(currentCohort);
    setMembers(currentCohort ? cohortMembers : []);
    setStudents(tenantStudents);

    const nextAvailable = tenantStudents.find(
      (student) =>
        !cohortMembers.some((member) => member.student_id === student.id),
    );
    setSelectedStudentId(nextAvailable?.id ?? "");

    if (!currentCohort) {
      setError("Cohort not found in this workspace.");
    }
  }, [cohortId]);

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

        setTenant(currentTenant);
        await loadCohortContext(currentTenant);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load this cohort."));
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
  }, [loadCohortContext, router]);

  async function refreshMembers() {
    if (!tenant) {
      return;
    }

    const [cohortMembers, tenantStudents] = await Promise.all([
      getCohortMembers({
        cohortId,
        tenantId: tenant.id,
      }),
      getStudentsForTenant(tenant.id),
    ]);
    setMembers(cohortMembers);
    setStudents(tenantStudents);
    setSelectedStudentId(
      tenantStudents.find(
        (student) =>
          !cohortMembers.some((member) => member.student_id === student.id),
      )?.id ?? "",
    );
  }

  async function openAddPanel() {
    setActionError("");
    setAddOpen(true);

    try {
      await refreshMembers();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load students."));
    }
  }

  async function handleAddStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !selectedStudentId) {
      setActionError("Select a student before adding a cohort member.");
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await addStudentToCohort({
        cohortId,
        studentId: selectedStudentId,
        tenantId: tenant.id,
      });
      setAddOpen(false);
      await refreshMembers();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to add student to cohort."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleRemoveStudent(member: CohortMemberWithStudent) {
    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    const confirmed = window.confirm(
      `Remove ${member.student?.full_name ?? "this student"} from this cohort?`,
    );

    if (!confirmed) {
      return;
    }

    setMutating(true);
    setActionError("");

    try {
      await removeStudentFromCohort({
        cohortId,
        studentId: member.student_id,
        tenantId: tenant.id,
      });
      await refreshMembers();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to remove student."));
    } finally {
      setMutating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading cohort</span>
        </Card>
      </div>
    );
  }

  if (error || !cohort) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">
            Cohort detail
          </p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Cohort not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black"
            href="/app/cohorts"
          >
            Back to cohorts
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-slate-400 transition hover:text-white"
        href="/app/cohorts"
      >
        Back to cohorts
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.38fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                {cohort.course?.title ?? "Course unavailable"}
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {cohort.name}
              </h2>
            </div>
            <Badge className="border-white/15 bg-white/10 text-white">
              {members.length} {members.length === 1 ? "member" : "members"}
            </Badge>
          </div>

          <p className="mt-7 max-w-3xl text-sm leading-6 text-slate-400">
            {cohort.description || "No description added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-slate-400">Start date</p>
              <p className="mt-2 font-semibold">
                {formatDate(cohort.start_date)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">End date</p>
              <p className="mt-2 font-semibold">
                {formatDate(cohort.end_date)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(cohort.created_at)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-400">Workspace</p>
          <h3 className="mt-3 text-2xl font-semibold">{tenant?.name}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Cohort members are scoped to this workspace and linked to the
            selected course batch.
          </p>
          <Button className="mt-7 w-full" onClick={openAddPanel} type="button">
            Add Student
          </Button>
        </Card>
      </section>

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Members
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Cohort students
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Add students to this batch without changing course enrollments
                or payment records.
              </p>
            </div>
            <Button onClick={openAddPanel} type="button">
              Add Student
            </Button>
          </div>

          {members.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                ST
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No students in this cohort
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Add existing student CRM records to start shaping this batch.
              </p>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {members.map((member) => (
                <div
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                  key={member.id}
                >
                  <div>
                    <p className="font-semibold">
                      {member.student?.full_name ?? "Student unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {member.student?.email || member.student?.phone || "No contact added"}
                    </p>
                  </div>
                  <p className="text-sm text-slate-400">
                    Added {formatDate(member.enrolled_at)}
                  </p>
                  <Button
                    className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                    disabled={mutating}
                    onClick={() => handleRemoveStudent(member)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Add Student</h3>
            <form className="mt-7 space-y-5" onSubmit={handleAddStudent}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Student
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) => setSelectedStudentId(event.target.value)}
                  required
                  value={selectedStudentId}
                >
                  <option className="text-slate-950" value="">
                    Select a student
                  </option>
                  {availableStudents.map((student) => (
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

              {students.length === 0 ? (
                <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-300">
                  Add students to the CRM before building cohort membership.
                </p>
              ) : availableStudents.length === 0 ? (
                <p className="rounded-2xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm leading-6 text-teal-300">
                  Every available student is already in this cohort.
                </p>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm leading-6 text-slate-400">
                  Existing cohort members are hidden from the selector to avoid
                  duplicates.
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  className="border-white/10"
                  onClick={() => setAddOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    mutating ||
                    !selectedStudentId ||
                    availableStudents.length === 0
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
    </div>
  );
}
