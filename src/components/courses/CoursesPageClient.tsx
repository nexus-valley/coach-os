"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  createCourse,
  getCoursesForTenant,
  type Course,
  type CreateCourseInput,
} from "@/src/lib/courses";
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
    <Badge className="border-white/10 bg-white/10 text-zinc-200">Draft</Badge>
  );
}

export function CoursesPageClient() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
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

        const tenantCourses = await getCoursesForTenant(currentTenant.id);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourses(tenantCourses);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load courses right now.",
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

    setSaving(true);
    setError("");

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
          : "Unable to create course right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Course engine
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Courses
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-400">
            Build and organize premium course products for your current
            workspace.
          </p>
        </div>
        <Button
          className="bg-white text-zinc-950 hover:bg-zinc-100"
          onClick={() => setFormOpen(true)}
          size="lg"
          type="button"
        >
          Create Course
        </Button>
      </div>

      <Card className="mt-8 border-white/10 bg-white/[0.06] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-400">
              Current workspace
            </p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
            {courses.length} {courses.length === 1 ? "course" : "courses"}
          </div>
        </div>
      </Card>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-60 animate-pulse border-white/10 bg-white/[0.06]"
              key={item}
            >
              <span className="sr-only">Loading course</span>
            </Card>
          ))}
        </section>
      ) : courses.length === 0 ? (
        <Card className="mt-6 border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">
              CU
            </div>
            <h3 className="mt-6 text-2xl font-semibold">
              No courses created yet
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Create your first draft course to start shaping the learning
              experience. Lessons and section management will arrive in a later
              module.
            </p>
            <Button
              className="mt-7"
              onClick={() => setFormOpen(true)}
              type="button"
            >
              Create Course
            </Button>
          </div>
        </Card>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <Link href={`/app/courses/${course.id}`} key={course.id}>
              <Card className="h-full border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 transition hover:-translate-y-1 hover:bg-white/[0.09]">
                <div className="flex h-full min-h-60 flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <StatusBadge status={course.status} />
                      <span className="text-xs text-zinc-500">
                        {formatDate(course.created_at)}
                      </span>
                    </div>
                    <h3 className="mt-6 text-2xl font-semibold leading-tight">
                      {course.title}
                    </h3>
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-400">
                      {course.description || "No description added yet."}
                    </p>
                  </div>
                  <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5 text-sm">
                    <span className="text-zinc-500">/{course.slug}</span>
                    <span className="font-semibold text-white">Open</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-zinc-500">
                  New course
                </p>
                <h3 className="mt-2 text-2xl font-semibold">Create Course</h3>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateCourse}>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Course title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Signature coaching program"
                  required
                  type="text"
                  value={title}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Description
                </span>
                <textarea
                  className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the promise, audience, and outcome."
                  value={description}
                />
              </label>

              <div>
                <p className="text-sm font-medium text-zinc-700">Status</p>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-1">
                  {(["draft", "published"] as const).map((item) => (
                    <button
                      className={[
                        "h-11 rounded-xl text-sm font-semibold transition",
                        status === item
                          ? "bg-zinc-950 text-white shadow-lg shadow-zinc-950/15"
                          : "text-zinc-500 hover:bg-white hover:text-zinc-950",
                      ].join(" ")}
                      key={item}
                      onClick={() => setStatus(item)}
                      type="button"
                    >
                      {item === "draft" ? "Draft" : "Published"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  className="border-zinc-200"
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Creating..." : "Create Course"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
