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
import {
  createCourse,
  getCoursesForTenant,
  type Course,
  type CreateCourseInput,
} from "@/src/lib/courses";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManageCourses,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CourseFormStatus = CreateCourseInput["status"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: Course["status"] }) {
  if (status === "published") {
    return <Badge tone="success">Published</Badge>;
  }

  return (
    <Badge className="border-white/10 bg-white/10 text-slate-200">Draft</Badge>
  );
}

export function CoursesPageClient() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CourseFormStatus>("draft");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCourses() {
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
        } = await supabase.auth.getUser();
        const [tenantCourses, role] = await Promise.all([
          getCoursesForTenant(currentTenant.id),
          user ? getCurrentMemberRole(currentTenant.id, user.id) : null,
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourses(tenantCourses);
        setCurrentRole(role);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load programs right now.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCourses();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleCreateCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    if (!title.trim()) {
      setFormError("Program title is required.");
      return;
    }

    setSaving(true);
    setError("");
    setFormError("");

    try {
      const course = await createCourse({
        description,
        status,
        tenantId: tenant.id,
        title,
      });

      setFormOpen(false);
      setDescription("");
      setStatus("draft");
      setTitle("");
      router.push(`/app/courses/${course.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create program. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canManage = canManageCourses(currentRole);
  const publishedCourses = courses.filter((course) => course.status === "published")
    .length;
  const draftCourses = courses.filter((course) => course.status === "draft").length;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Program workflow
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Programs
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Shape the learning products your coaching brand sells, teaches, and
            connects to enrollments.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setFormOpen(true)} size="lg" type="button">
            Create Program
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
              Programs sit between student demand, payment, access, and
              delivery. Keep drafts clean, then publish when the program is
              ready to run.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/10 p-4">
              <p className="text-2xl font-semibold">{courses.length}</p>
              <p className="mt-1 text-sm text-slate-400">Total programs</p>
            </div>
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
              <p className="text-2xl font-semibold text-emerald-200">
                {publishedCourses}
              </p>
              <p className="mt-1 text-sm text-emerald-100/80">Published</p>
            </div>
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
              <p className="text-2xl font-semibold text-amber-200">
                {draftCourses}
              </p>
              <p className="mt-1 text-sm text-amber-100/80">Drafts</p>
            </div>
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

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="border-white/10 bg-[#101214] p-6"
              key={item}
            >
              <span className="sr-only">Loading course</span>
              <Skeleton className="h-6 w-24 bg-white/10" />
              <Skeleton className="mt-8 h-8 w-3/4 bg-white/10" />
              <Skeleton className="mt-5 h-4 w-full bg-white/10" />
              <Skeleton className="mt-3 h-4 w-5/6 bg-white/10" />
              <Skeleton className="mt-10 h-10 w-full bg-white/10" />
            </Card>
          ))}
        </section>
      ) : courses.length === 0 ? (
        <EmptyState
          action={
            canManage
              ? { label: "Create Program", onClick: () => setFormOpen(true) }
              : undefined
          }
          description="Create your first draft program to start shaping the learning experience, sections, lessons, and enrollments."
          icon="CU"
          title="No programs created yet"
        />
      ) : (
        <section className="mt-6">
          <SectionHeader
            actions={
              draftCourses > 0 ? (
                <Badge tone="warning">{draftCourses} drafts</Badge>
              ) : (
                <Badge className="border-white/15 bg-white/10 text-white">
                  Catalog ready
                </Badge>
              )
            }
            className="mb-4"
            description={
              <span className="text-slate-400">
                Review published programs and drafts before linking them to
                batches, sessions, assignments, and enrollments.
              </span>
            }
            title={<span className="text-white">Program catalog</span>}
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <Link href={`/app/courses/${course.id}`} key={course.id}>
                <Card className="h-full border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 transition hover:-translate-y-1 hover:bg-[#15181b]">
                  <div className="flex h-full min-h-60 flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <StatusBadge status={course.status} />
                        <span className="text-xs text-slate-500">
                          {formatDate(course.created_at)}
                        </span>
                      </div>
                      <h3 className="mt-6 text-2xl font-semibold leading-tight">
                        {course.title}
                      </h3>
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">
                        {course.description || "No description added yet."}
                      </p>
                    </div>
                    <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5 text-sm">
                      <span className="text-slate-500">/{course.slug}</span>
                      <span className="font-semibold text-white">Open</span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#475569]">
                  New program
                </p>
                <h3 className="mt-2 text-2xl font-semibold">Create Program</h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#CBD5E1] text-sm font-semibold text-[#475569] transition hover:bg-[#F8FAFC] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateCourse}>
              <FormField
                error={formError}
                htmlFor="course-title"
                label="Program title"
                required
              >
                <input
                  id="course-title"
                  className="mt-2 h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Signature coaching program"
                  required
                  type="text"
                  value={title}
                />
              </FormField>

              <FormField
                htmlFor="course-description"
                label="Description"
              >
                <textarea
                  id="course-description"
                  className="mt-2 min-h-32 w-full resize-none rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the promise, audience, and outcome."
                  value={description}
                />
              </FormField>

              <FormField label="Status">
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] p-1">
                  {(["draft", "published"] as const).map((item) => (
                    <button
                      className={[
                        "h-11 rounded-lg text-sm font-semibold transition",
                        status === item
                          ? "bg-[#145DA0] text-white shadow-sm shadow-[#145DA0]/20"
                          : "text-[#475569] hover:bg-white hover:text-[#0B1F33]",
                      ].join(" ")}
                      key={item}
                      onClick={() => setStatus(item)}
                      type="button"
                    >
                      {item === "draft" ? "Draft" : "Published"}
                    </button>
                  ))}
                </div>
              </FormField>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Creating..." : "Create Program"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
