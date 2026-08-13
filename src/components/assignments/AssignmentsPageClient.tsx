"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getSafeAssignmentError } from "@/src/lib/assignmentErrors";
import {
  assignmentListDefaultPageSize,
  canRoleManageAssignments,
  createAssignment,
  getAssignmentProgramOptions,
  getAssignments,
  type AssignmentListPage,
  type AssignmentListSort,
  type AssignmentProgramOption,
  type AssignmentStatus,
} from "@/src/lib/assignments";
import { getCohortsForTenant, type CohortWithCourse } from "@/src/lib/cohorts";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import { getUserDelegatedPermissions } from "@/src/lib/delegatedPermissions";
import { canAccessAttendance } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type AssignmentFormState = {
  cohortId: string;
  courseId: string;
  description: string;
  dueAt: string;
  instructions: string;
  maxScore: string;
  title: string;
};

const emptyForm: AssignmentFormState = {
  cohortId: "",
  courseId: "",
  description: "",
  dueAt: "",
  instructions: "",
  maxScore: "100",
  title: "",
};

const emptyPage: AssignmentListPage = {
  hasNext: false,
  hasPrevious: false,
  items: [],
  page: 1,
  pageSize: assignmentListDefaultPageSize,
  total: 0,
  totalPages: 1,
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "No due date";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getStatusTone(status: AssignmentStatus): "danger" | "success" | "warning" {
  return status === "published" ? "success" : status === "closed" ? "danger" : "warning";
}

function toDateTimeLocalValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(18, 0, 0, 0);
  return toDateTimeLocalValue(date);
}

export function AssignmentsPageClient() {
  const router = useRouter();
  const createButtonRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [assignmentPage, setAssignmentPage] = useState(emptyPage);
  const [canManageEffective, setCanManageEffective] = useState(false);
  const [cohorts, setCohorts] = useState<CohortWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<AssignmentFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [page, setPage] = useState(1);
  const [programFilter, setProgramFilter] = useState("");
  const [programOptions, setProgramOptions] = useState<AssignmentProgramOption[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [selectorsLoaded, setSelectorsLoaded] = useState(false);
  const [sort, setSort] = useState<AssignmentListSort>("due_soon");
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "all">("all");
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canAccessAttendance(currentRole);
  const canManage = canManageEffective;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim().slice(0, 120));
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) return;
        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const supabase = getSupabaseClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const role = user ? await getCurrentMemberRole(currentTenant.id, user.id) : null;

        setTenant(currentTenant);
        setCurrentRole(role);

        if (canAccessAttendance(role)) {
          const [programs, delegated] = await Promise.all([
            getAssignmentProgramOptions(currentTenant.id),
            user
              ? getUserDelegatedPermissions(currentTenant.id, user.id).catch(() => [])
              : Promise.resolve([]),
          ]);
          if (!active) return;
          setProgramOptions(programs);
          setCanManageEffective(
            canRoleManageAssignments(role) ||
              delegated.some(
                (permission) => permission.permission_key === "manage_assignments",
              ),
          );
        }
      } catch (caught) {
        if (active) setError(getSafeAssignmentError(caught));
      } finally {
        if (active) setInitializing(false);
      }
    }

    void initialize();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    let active = true;

    async function loadPage() {
      if (!tenant || !canAccess) return;
      setListLoading(true);
      setError("");

      try {
        const result = await getAssignments(tenant.id, {
          courseId: programFilter || null,
          needsReview,
          page,
          pageSize: assignmentListDefaultPageSize,
          search: debouncedSearch,
          sort,
          status: statusFilter === "all" ? null : statusFilter,
        });
        if (!active) return;
        setAssignmentPage(result);
        if (page > result.totalPages) setPage(result.totalPages);
      } catch (caught) {
        if (active) setError(getSafeAssignmentError(caught));
      } finally {
        if (active) setListLoading(false);
      }
    }

    void loadPage();
    return () => { active = false; };
  }, [canAccess, debouncedSearch, needsReview, page, programFilter, refreshVersion, sort, statusFilter, tenant]);

  useEffect(() => {
    if (!formOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setFormOpen(false);
        window.setTimeout(
          () =>
            createButtonRef.current
              ?.querySelector<HTMLElement>("button")
              ?.focus(),
          0,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(
      () =>
        (
          dialogRef.current?.querySelector<HTMLElement>("input, select, textarea") ??
          dialogRef.current?.querySelector<HTMLElement>("button")
        )?.focus(),
      0,
    );
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formOpen, saving]);

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setProgramFilter("");
    setNeedsReview(false);
    setSort("due_soon");
    setPage(1);
  }

  async function openCreateForm() {
    if (!tenant) return;
    setError("");
    setSuccess("");
    setFormOpen(true);

    if (selectorsLoaded) {
      setForm((current) => ({ ...current, dueAt: current.dueAt || defaultDueDate() }));
      return;
    }

    setSelectorLoading(true);
    try {
      const [tenantCourses, tenantCohorts] = await Promise.all([
        getCoursesForTenant(tenant.id),
        getCohortsForTenant(tenant.id),
      ]);
      setCourses(tenantCourses);
      setCohorts(tenantCohorts);
      setSelectorsLoaded(true);
      setForm({
        ...emptyForm,
        cohortId: tenantCohorts[0]?.id ?? "",
        courseId: tenantCohorts[0]?.course_id ?? tenantCourses[0]?.id ?? "",
        dueAt: defaultDueDate(),
      });
    } catch (caught) {
      setError(getSafeAssignmentError(caught, "Assignment options could not be loaded."));
      setFormOpen(false);
    } finally {
      setSelectorLoading(false);
    }
  }

  function closeCreateForm() {
    if (saving) return;
    setFormOpen(false);
    window.setTimeout(
      () => createButtonRef.current?.querySelector<HTMLElement>("button")?.focus(),
      0,
    );
  }

  async function handleCreateAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await createAssignment({
        cohortId: form.cohortId || null,
        courseId: form.courseId || null,
        description: form.description,
        dueAt: form.dueAt,
        instructions: form.instructions,
        maxScore: form.maxScore,
        tenantId: tenant.id,
        title: form.title,
      });
      setFormOpen(false);
      setForm(emptyForm);
      window.setTimeout(
        () => createButtonRef.current?.querySelector<HTMLElement>("button")?.focus(),
        0,
      );
      setPage(1);
      setRefreshVersion((value) => value + 1);
      setSuccess("Assignment created.");
    } catch (caught) {
      setError(getSafeAssignmentError(caught, "Assignment could not be created."));
    } finally {
      setSaving(false);
    }
  }

  if (!initializing && currentRole && !canAccess) {
    return <AccessDeniedCard description="You do not have permission to access assignments." />;
  }

  const filtersActive = Boolean(search || statusFilter !== "all" || programFilter || needsReview);
  const noMatches = assignmentPage.items.length === 0 && filtersActive;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge tone="light">Academic operations</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">Assignments</h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">Find work awaiting review and manage assignment delivery.</p>
        </div>
        {canManage ? <div ref={createButtonRef}><Button onClick={() => void openCreateForm()} size="lg" type="button">Create Assignment</Button></div> : null}
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 shadow-2xl shadow-[#0B2A3D]/10 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
          <label className="block md:col-span-2 xl:col-span-1">
            <span className="text-sm font-medium text-[#425B76]">Search assignments</span>
            <span className="relative mt-2 block">
              <input className="h-11 w-full rounded-lg border border-[#D8E8F0] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10" maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title" type="search" value={search} />
            </span>
          </label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Status</span><select className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] bg-white px-3 text-sm" onChange={(event) => { setStatusFilter(event.target.value as AssignmentStatus | "all"); setPage(1); }} value={statusFilter}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Program</span><select className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] bg-white px-3 text-sm" onChange={(event) => { setProgramFilter(event.target.value); setPage(1); }} value={programFilter}><option value="">All programs</option>{programOptions.map((program) => <option key={program.id} value={program.id}>{program.title}</option>)}</select></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Review state</span><select className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] bg-white px-3 text-sm" onChange={(event) => { setNeedsReview(event.target.value === "needs_review"); setPage(1); }} value={needsReview ? "needs_review" : "all"}><option value="all">All assignments</option><option value="needs_review">Needs review</option></select></label>
          <label className="block"><span className="text-sm font-medium text-[#425B76]">Sort</span><select className="mt-2 h-11 w-full rounded-lg border border-[#D8E8F0] bg-white px-3 text-sm" onChange={(event) => { setSort(event.target.value as AssignmentListSort); setPage(1); }} value={sort}><option value="due_soon">Due soon</option><option value="newest">Newest</option><option value="title">Title</option></select></label>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-[#D8E8F0] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="text-sm text-[#425B76]">{listLoading ? "Loading assignment page…" : `${assignmentPage.total} ${assignmentPage.total === 1 ? "assignment" : "assignments"}`}</p>
          {filtersActive ? <Button onClick={resetFilters} size="sm" type="button" variant="ghost">Reset filters</Button> : null}
        </div>
      </Card>

      {error ? <div className="mt-6"><FeedbackAlert>{error}</FeedbackAlert></div> : null}
      {success ? <div className="mt-6"><FeedbackAlert tone="success">{success}</FeedbackAlert></div> : null}

      {initializing || listLoading ? (
        <section aria-label="Loading assignments" className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <Card className="h-64 animate-pulse border-[#D8E8F0] bg-white" key={item}><span className="sr-only">Loading assignments</span></Card>)}</section>
      ) : assignmentPage.items.length === 0 ? (
        <EmptyState
          action={noMatches ? { label: "Reset filters", onClick: resetFilters } : canManage ? { label: "Create Assignment", onClick: () => void openCreateForm() } : undefined}
          description={needsReview ? "No persisted submissions currently need review." : noMatches ? "No assignments match the current search and filters." : "Create an assignment to begin tracking student work."}
          icon="AS"
          title={needsReview ? "Review queue is clear" : noMatches ? "No matching assignments" : "No assignments yet"}
        />
      ) : (
        <>
          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {assignmentPage.items.map((assignment) => {
              const submitted = assignment.submissionCounts.submitted + assignment.submissionCounts.reviewed + assignment.submissionCounts.late;
              return (
                <Card className="flex min-h-72 flex-col justify-between border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10" key={assignment.id}>
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3"><Badge tone={getStatusTone(assignment.status)}>{assignment.status}</Badge><span className="text-xs font-medium text-[#66788F]">{formatDateTime(assignment.due_at)}</span></div>
                    <h3 className="mt-5 text-xl font-semibold leading-tight text-[#0B1F33]">{assignment.title}</h3>
                    <p className="mt-3 text-sm font-semibold text-[#0E7490]">{assignment.cohort?.name ?? assignment.course?.title ?? "General assignment"}</p>
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#425B76]">{assignment.description || assignment.instructions || "No assignment description added yet."}</p>
                    {assignment.awaitingReviewCount > 0 ? <p className="mt-4 text-sm font-semibold text-[#9A5B00]">{assignment.awaitingReviewCount} awaiting review</p> : null}
                  </div>
                  <div className="mt-8 border-t border-[#D8E8F0] pt-5">
                    <p className="text-sm text-[#66788F]">{submitted} submitted · {assignment.submissionCounts.reviewed} reviewed</p>
                    <Button className="mt-4" href={`/app/assignments/${assignment.id}`} size="sm">Open Assignment</Button>
                  </div>
                </Card>
              );
            })}
          </section>
          <nav aria-label="Assignment pages" className="mt-6 flex items-center justify-between gap-4">
            <Button disabled={!assignmentPage.hasPrevious} onClick={() => setPage((value) => Math.max(value - 1, 1))} type="button" variant="secondary">Previous</Button>
            <p className="text-sm text-[#425B76]">Page {assignmentPage.page} of {assignmentPage.totalPages}</p>
            <Button disabled={!assignmentPage.hasNext} onClick={() => setPage((value) => value + 1)} type="button" variant="secondary">Next</Button>
          </nav>
        </>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#0B2A3D]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <div aria-labelledby="create-assignment-title" aria-modal="true" className="w-full max-w-2xl" ref={dialogRef} role="dialog">
          <Card className="max-h-[calc(100vh-2rem)] w-full overflow-y-auto border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/30 sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-[#66788F]">Homework setup</p><h3 className="mt-2 text-2xl font-semibold text-[#0B1F33]" id="create-assignment-title">Create Assignment</h3></div><button aria-label="Close create assignment" className="h-11 rounded-lg border border-[#D8E8F0] px-4 text-sm font-semibold text-[#66788F]" onClick={closeCreateForm} type="button">Close</button></div>
            {selectorLoading ? <p aria-live="polite" className="mt-7 text-sm text-[#425B76]">Loading assignment options…</p> : (
              <form className="mt-7 space-y-5" onSubmit={handleCreateAssignment}>
                <label className="block"><span className="text-sm font-medium text-[#425B76]">Assignment title</span><input className="mt-2 h-12 w-full rounded-lg border border-[#D8E8F0] px-4 text-sm" onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Weekly homework" required type="text" value={form.title} /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className="text-sm font-medium text-[#425B76]">Course</span><select className="mt-2 h-12 w-full rounded-lg border border-[#D8E8F0] px-4 text-sm" onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))} value={form.courseId}><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
                  <label className="block"><span className="text-sm font-medium text-[#425B76]">Cohort</span><select className="mt-2 h-12 w-full rounded-lg border border-[#D8E8F0] px-4 text-sm" onChange={(event) => { const cohort = cohorts.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, cohortId: event.target.value, courseId: cohort?.course_id ?? current.courseId })); }} value={form.cohortId}><option value="">No cohort</option>{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className="text-sm font-medium text-[#425B76]">Due date</span><input className="mt-2 h-12 w-full rounded-lg border border-[#D8E8F0] px-4 text-sm" onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))} type="datetime-local" value={form.dueAt} /></label>
                  <label className="block"><span className="text-sm font-medium text-[#425B76]">Max score</span><input className="mt-2 h-12 w-full rounded-lg border border-[#D8E8F0] px-4 text-sm" min="0" onChange={(event) => setForm((current) => ({ ...current, maxScore: event.target.value }))} type="number" value={form.maxScore} /></label>
                </div>
                <label className="block"><span className="text-sm font-medium text-[#425B76]">Description</span><textarea className="mt-2 min-h-20 w-full resize-none rounded-lg border border-[#D8E8F0] px-4 py-3 text-sm" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} value={form.description} /></label>
                <label className="block"><span className="text-sm font-medium text-[#425B76]">Instructions</span><textarea className="mt-2 min-h-28 w-full resize-none rounded-lg border border-[#D8E8F0] px-4 py-3 text-sm" onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} value={form.instructions} /></label>
                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><Button onClick={closeCreateForm} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Creating…" : "Create Assignment"}</Button></div>
              </form>
            )}
          </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
