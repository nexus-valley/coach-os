"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  createReminder,
  deleteReminder,
  getRemindersForTenant,
  updateReminderStatus,
  type ReminderStatus,
  type ReminderType,
  type ReminderWithRelations,
} from "@/src/lib/reminders";
import { getStudentsForTenant, type Student } from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | ReminderStatus;
type TypeFilter = "all" | ReminderType;

type ReminderFormState = {
  courseId: string;
  description: string;
  dueAt: string;
  reminderType: ReminderType;
  studentId: string;
  title: string;
};

const emptyForm: ReminderFormState = {
  courseId: "",
  description: "",
  dueAt: "",
  reminderType: "general",
  studentId: "",
  title: "",
};

const statusFilters: StatusFilter[] = [
  "all",
  "pending",
  "completed",
  "cancelled",
];
const typeFilters: TypeFilter[] = [
  "all",
  "general",
  "payment",
  "course_followup",
  "student_followup",
];
const reminderTypes: ReminderType[] = [
  "general",
  "payment",
  "course_followup",
  "student_followup",
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatType(value: string) {
  return value.replace("_", " ");
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function isOverdue(reminder: ReminderWithRelations) {
  return reminder.status === "pending" && new Date(reminder.due_at) < new Date();
}

function getSearchText(reminder: ReminderWithRelations) {
  return [
    reminder.title,
    reminder.description,
    reminder.reminder_type,
    reminder.student?.full_name,
    reminder.student?.email,
    reminder.course?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function StatusBadge({ status }: { status: ReminderStatus }) {
  if (status === "completed") {
    return (
      <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
        Completed
      </Badge>
    );
  }

  if (status === "cancelled") {
    return (
      <Badge className="border-red-400/30 bg-red-500/10 text-red-300">
        Cancelled
      </Badge>
    );
  }

  return (
    <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
      Pending
    </Badge>
  );
}

export function RemindersPageClient() {
  const router = useRouter();
  const [actionError, setActionError] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ReminderFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [reminders, setReminders] = useState<ReminderWithRelations[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  async function loadReminderContext(currentTenant: Tenant) {
    const [tenantReminders, tenantStudents, tenantCourses] = await Promise.all([
      getRemindersForTenant(currentTenant.id),
      getStudentsForTenant(currentTenant.id),
      getCoursesForTenant(currentTenant.id),
    ]);

    setReminders(tenantReminders);
    setStudents(tenantStudents);
    setCourses(tenantCourses);
  }

  useEffect(() => {
    let active = true;

    async function loadReminders() {
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
        await loadReminderContext(currentTenant);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load reminders."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReminders();

    return () => {
      active = false;
    };
  }, [router]);

  const filteredReminders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return reminders.filter((reminder) => {
      const matchesStatus =
        statusFilter === "all" || reminder.status === statusFilter;
      const matchesType =
        typeFilter === "all" || reminder.reminder_type === typeFilter;
      const matchesSearch =
        !normalizedSearch ||
        getSearchText(reminder).includes(normalizedSearch);

      return matchesStatus && matchesType && matchesSearch;
    });
  }, [reminders, search, statusFilter, typeFilter]);

  const overdueCount = reminders.filter(isOverdue).length;

  async function refreshReminders() {
    if (!tenant) {
      return;
    }

    setReminders(await getRemindersForTenant(tenant.id));
  }

  async function handleCreateReminder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    setMutatingId("create");
    setActionError("");

    try {
      const dueDate = new Date(form.dueAt);

      if (Number.isNaN(dueDate.getTime())) {
        throw new Error("Choose a valid due date and time.");
      }

      await createReminder({
        course_id: form.courseId || null,
        description: form.description,
        due_at: dueDate.toISOString(),
        reminder_type: form.reminderType,
        student_id: form.studentId || null,
        tenant_id: tenant.id,
        title: form.title,
      });
      setForm(emptyForm);
      setFormOpen(false);
      await refreshReminders();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to create reminder."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleStatusChange(
    reminderId: string,
    status: ReminderStatus,
  ) {
    if (!tenant) {
      return;
    }

    setMutatingId(reminderId);
    setActionError("");

    try {
      await updateReminderStatus(reminderId, tenant.id, status);
      await refreshReminders();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to update reminder."));
    } finally {
      setMutatingId("");
    }
  }

  async function handleDeleteReminder(reminderId: string) {
    if (!tenant) {
      return;
    }

    const confirmed = window.confirm("Delete this reminder?");

    if (!confirmed) {
      return;
    }

    setMutatingId(reminderId);
    setActionError("");

    try {
      await deleteReminder(reminderId, tenant.id);
      await refreshReminders();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to delete reminder."));
    } finally {
      setMutatingId("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
            Internal reminders
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Reminders
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Track internal follow-ups for students, payments, courses, and
            general workspace operations.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} size="lg" type="button">
          Create Reminder
        </Button>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
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
              placeholder="Title, student, or course"
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
                  {formatType(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Type</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:ring-4 focus:ring-teal-400/10"
              onChange={(event) =>
                setTypeFilter(event.target.value as TypeFilter)
              }
              value={typeFilter}
            >
              {typeFilters.map((type) => (
                <option className="text-slate-950" key={type} value={type}>
                  {formatType(type)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-slate-300">
            {filteredReminders.length} visible
          </span>
          <span className="rounded-full border border-red-400/30 bg-red-500/10 px-4 py-2 text-red-300">
            {overdueCount} overdue
          </span>
        </div>
      </Card>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-56 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading reminder</span>
            </Card>
          ))}
        </section>
      ) : filteredReminders.length === 0 ? (
        <Card className="mt-6 border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              RM
            </div>
            <h3 className="mt-6 text-2xl font-semibold">
              No reminders found
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Create internal reminders for follow-ups, payment checks, or
              course operations.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredReminders.map((reminder) => {
            const overdue = isOverdue(reminder);

            return (
              <Card
                className={[
                  "flex min-h-72 flex-col justify-between p-6 text-white shadow-2xl shadow-black/10",
                  overdue
                    ? "border-red-400/30 bg-red-500/10"
                    : "border-white/10 bg-[#101214]",
                ].join(" ")}
                key={reminder.id}
              >
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Badge className="border-white/15 bg-white/10 text-white">
                      {formatType(reminder.reminder_type)}
                    </Badge>
                    <StatusBadge status={reminder.status} />
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold leading-tight">
                    {reminder.title}
                  </h3>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-400">
                    {reminder.description || "No description added."}
                  </p>
                  <div className="mt-5 space-y-2 text-sm">
                    <p className={overdue ? "text-red-200" : "text-slate-400"}>
                      Due {formatDateTime(reminder.due_at)}
                    </p>
                    <p className="text-slate-400">
                      Student:{" "}
                      <span className="text-white">
                        {reminder.student?.full_name ?? "Not linked"}
                      </span>
                    </p>
                    <p className="text-slate-400">
                      Course:{" "}
                      <span className="text-white">
                        {reminder.course?.title ?? "Not linked"}
                      </span>
                    </p>
                    {reminder.payment ? (
                      <p className="text-slate-400">
                        Payment:{" "}
                        <span className="text-white">
                          {reminder.payment.currency || "USD"}{" "}
                          {reminder.payment.amount} ({reminder.payment.status})
                        </span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-7 flex flex-wrap gap-2 border-t border-white/10 pt-5">
                  <Button
                    disabled={mutatingId === reminder.id}
                    onClick={() =>
                      handleStatusChange(reminder.id, "completed")
                    }
                    size="sm"
                    type="button"
                  >
                    Complete
                  </Button>
                  <Button
                    disabled={mutatingId === reminder.id}
                    onClick={() => handleStatusChange(reminder.id, "pending")}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Pending
                  </Button>
                  <Button
                    disabled={mutatingId === reminder.id}
                    onClick={() =>
                      handleStatusChange(reminder.id, "cancelled")
                    }
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    className="text-red-300! hover:bg-red-500/10! hover:text-red-200!"
                    disabled={mutatingId === reminder.id}
                    onClick={() => handleDeleteReminder(reminder.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  New reminder
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Create Reminder
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

            <form className="mt-7 space-y-5" onSubmit={handleCreateReminder}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Follow up with student"
                  required
                  type="text"
                  value={form.title}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Type
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reminderType: event.target.value as ReminderType,
                      }))
                    }
                    value={form.reminderType}
                  >
                    {reminderTypes.map((type) => (
                      <option className="text-slate-950" key={type} value={type}>
                        {formatType(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Due date and time
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dueAt: event.target.value,
                      }))
                    }
                    required
                    type="datetime-local"
                    value={form.dueAt}
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Student
                  </span>
                  <select
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        studentId: event.target.value,
                      }))
                    }
                    value={form.studentId}
                  >
                    <option className="text-slate-950" value="">
                      No student
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
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Add internal context for this follow-up."
                  value={form.description}
                />
              </label>

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
                  {mutatingId === "create" ? "Creating..." : "Create Reminder"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
