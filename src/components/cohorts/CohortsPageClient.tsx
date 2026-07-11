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
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  createCohort,
  deleteCohort,
  getCohortsForTenant,
  updateCohort,
  type CohortWithCourse,
} from "@/src/lib/cohorts";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManageCourses,
  canDeleteRecords,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CohortFormState = {
  courseId: string;
  description: string;
  endDate: string;
  name: string;
  startDate: string;
};

const emptyForm: CohortFormState = {
  courseId: "",
  description: "",
  endDate: "",
  name: "",
  startDate: "",
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

function createFormFromCohort(cohort: CohortWithCourse): CohortFormState {
  return {
    courseId: cohort.course_id,
    description: cohort.description ?? "",
    endDate: cohort.end_date ?? "",
    name: cohort.name,
    startDate: cohort.start_date ?? "",
  };
}

export function CohortsPageClient() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [editingCohort, setEditingCohort] = useState<CohortWithCourse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [form, setForm] = useState<CohortFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const canDelete = canDeleteRecords(currentRole);
  const canManageCohorts = canManageCourses(currentRole);

  async function loadCohorts(currentTenant: Tenant) {
    const [tenantCohorts, tenantCourses] = await Promise.all([
      getCohortsForTenant(currentTenant.id),
      getCoursesForTenant(currentTenant.id),
    ]);

    setCohorts(tenantCohorts);
    setCourses(tenantCourses);
    setForm((current) => ({
      ...current,
      courseId: current.courseId || tenantCourses[0]?.id || "",
    }));
  }

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

        setTenant(currentTenant);
        setCurrentRole(
          user ? await getCurrentMemberRole(currentTenant.id, user.id) : null,
        );
        await loadCohorts(currentTenant);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load cohorts right now."));
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
  }, [router]);

  function openCreateForm() {
    setError("");
    setSuccess("");
    setEditingCohort(null);
    setForm({ ...emptyForm, courseId: courses[0]?.id ?? "" });
    setFormOpen(true);
  }

  function openEditForm(cohort: CohortWithCourse) {
    setError("");
    setSuccess("");
    setEditingCohort(cohort);
    setForm(createFormFromCohort(cohort));
    setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.name.trim()) {
        throw new Error("Cohort name is required.");
      }

      if (!form.courseId) {
        throw new Error("Select a linked course.");
      }

      if (
        form.startDate &&
        form.endDate &&
        new Date(form.endDate) < new Date(form.startDate)
      ) {
        throw new Error("End date cannot be before start date.");
      }

      if (editingCohort) {
        await updateCohort({
          cohortId: editingCohort.id,
          courseId: form.courseId,
          description: form.description,
          endDate: form.endDate,
          name: form.name,
          startDate: form.startDate,
          tenantId: tenant.id,
        });
      } else {
        await createCohort({
          courseId: form.courseId,
          description: form.description,
          endDate: form.endDate,
          name: form.name,
          startDate: form.startDate,
          tenantId: tenant.id,
        });
      }

      setFormOpen(false);
      setEditingCohort(null);
      setForm({ ...emptyForm, courseId: courses[0]?.id ?? "" });
      await loadCohorts(tenant);
      setSuccess(editingCohort ? "Cohort updated." : "Cohort created.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to save cohort."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cohort: CohortWithCourse) {
    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    const confirmed = window.confirm(`Delete ${cohort.name}?`);

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await deleteCohort({
        cohortId: cohort.id,
        tenantId: tenant.id,
      });
      await loadCohorts(tenant);
      setSuccess("Cohort deleted.");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to delete cohort."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Batch management
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Cohorts
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Group students into course batches with clear dates, linked course
            context, and member visibility.
          </p>
        </div>
        {canManageCohorts ? (
          <Button onClick={openCreateForm} size="lg" type="button">
            Create Cohort
          </Button>
        ) : null}
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
          <div className="rounded-full border border-teal-400/30 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-300">
            {cohorts.length} {cohorts.length === 1 ? "cohort" : "cohorts"}
          </div>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
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
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="border-white/10 bg-[#101214] p-6"
              key={item}
            >
              <span className="sr-only">Loading cohort</span>
              <Skeleton className="h-6 w-28 bg-white/10" />
              <Skeleton className="mt-8 h-8 w-3/4 bg-white/10" />
              <Skeleton className="mt-5 h-4 w-2/3 bg-white/10" />
              <Skeleton className="mt-4 h-4 w-full bg-white/10" />
              <Skeleton className="mt-10 h-10 w-full bg-white/10" />
            </Card>
          ))}
        </section>
      ) : cohorts.length === 0 ? (
        <EmptyState
          action={
            canManageCohorts
              ? {
                  disabled: courses.length === 0,
                  label: "Create Cohort",
                  onClick: openCreateForm,
                }
              : undefined
          }
          description="Create a batch for a course, then add students from the cohort detail page or each student profile."
          icon="CO"
          title="No cohorts created yet"
        />
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cohorts.map((cohort) => (
            <Card
              className="flex min-h-72 flex-col justify-between border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 transition hover:bg-[#15181b]"
              key={cohort.id}
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                    {cohort.memberCount}{" "}
                    {cohort.memberCount === 1 ? "student" : "students"}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {formatDate(cohort.created_at)}
                  </span>
                </div>
                <h3 className="mt-6 text-2xl font-semibold leading-tight">
                  {cohort.name}
                </h3>
                <p className="mt-3 text-sm font-medium text-teal-300">
                  {cohort.course?.title ?? "Course unavailable"}
                </p>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">
                  {cohort.description || "No description added yet."}
                </p>
              </div>
              <div className="mt-8 border-t border-white/10 pt-5">
                <p className="text-sm text-slate-400">
                  {formatDate(cohort.start_date)} - {formatDate(cohort.end_date)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    className="inline-flex h-10 items-center justify-center rounded-full bg-teal-400 px-4 text-sm font-semibold text-black transition hover:bg-teal-300"
                    href={`/app/cohorts/${cohort.id}`}
                  >
                    Open
                  </Link>
                  {canManageCohorts ? (
                    <Button
                      className="border-white/10"
                      onClick={() => openEditForm(cohort)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                      disabled={saving}
                      onClick={() => handleDelete(cohort)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
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
                  {editingCohort ? "Edit batch" : "New batch"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  {editingCohort ? "Edit Cohort" : "Create Cohort"}
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

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <FormField
                htmlFor="cohort-name"
                label="Cohort name"
                required
                tone="dark"
              >
                <input
                  id="cohort-name"
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Spring accelerator batch"
                  required
                  type="text"
                  value={form.name}
                />
              </FormField>

              <FormField
                htmlFor="cohort-course"
                label="Linked course"
                required
                tone="dark"
              >
                <select
                  id="cohort-course"
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      courseId: event.target.value,
                    }))
                  }
                  required
                  value={form.courseId}
                >
                  <option className="text-slate-950" value="">
                    Select a course
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
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  htmlFor="cohort-start-date"
                  label="Start date"
                  tone="dark"
                >
                  <input
                    id="cohort-start-date"
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={form.startDate}
                  />
                </FormField>
                <FormField
                  htmlFor="cohort-end-date"
                  label="End date"
                  tone="dark"
                >
                  <input
                    id="cohort-end-date"
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={form.endDate}
                  />
                </FormField>
              </div>

              <FormField
                htmlFor="cohort-description"
                label="Description"
                tone="dark"
              >
                <textarea
                  id="cohort-description"
                  className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Audience, delivery cadence, or batch notes."
                  value={form.description}
                />
              </FormField>

              {courses.length === 0 ? (
                <FeedbackAlert className="border-amber-400/30 bg-amber-400/10 text-amber-300" tone="warning">
                  Create a course before creating a cohort.
                </FeedbackAlert>
              ) : null}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-white/10"
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={saving || courses.length === 0 || !form.courseId}
                  type="submit"
                >
                  {saving
                    ? "Saving..."
                    : editingCohort
                      ? "Save Changes"
                      : "Create Cohort"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
