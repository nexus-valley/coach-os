"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { getCourseById, type Course } from "@/src/lib/courses";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CourseDetailClientProps = {
  courseId: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function CourseStatusBadge({ status }: { status: Course["status"] }) {
  if (status === "published") {
    return <Badge tone="success">Published</Badge>;
  }

  return <Badge className="border-white/10 bg-white/10 text-white">Draft</Badge>;
}

export function CourseDetailClient({ courseId }: CourseDetailClientProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCourse() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          setError("Workspace context is not available.");
          return;
        }

        const currentCourse = await getCourseById({
          courseId,
          tenantId: currentTenant.id,
        });

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourse(currentCourse);

        if (!currentCourse) {
          setError("Course not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load this course right now.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCourse();

    return () => {
      active = false;
    };
  }, [courseId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-white/[0.06]">
          <span className="sr-only">Loading course</span>
        </Card>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Course detail</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Course not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white"
            href="/app/courses"
          >
            Back to courses
          </Link>
        </Card>
      </div>
    );
  }

  const placeholders = [
    {
      detail:
        "Sections and ordering will be managed here when lesson authoring is added.",
      title: "Course structure",
    },
    {
      detail:
        "Lesson CRUD is intentionally held for the next course-building module.",
      title: "Lessons",
    },
    {
      detail:
        "Use this area later for content checks, preview settings, and launch readiness.",
      title: "Publishing readiness",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-zinc-400 transition hover:text-white"
        href="/app/courses"
      >
        Back to courses
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Course overview
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {course.title}
              </h2>
            </div>
            <CourseStatusBadge status={course.status} />
          </div>

          <p className="mt-6 max-w-3xl text-base leading-7 text-zinc-400">
            {course.description || "No description added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-zinc-500">Workspace</p>
              <p className="mt-2 font-semibold">{tenant?.name}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Slug</p>
              <p className="mt-2 font-semibold">/{course.slug}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(course.created_at)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Module scope</p>
          <h3 className="mt-3 text-2xl font-semibold">
            Foundation only
          </h3>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            This screen confirms tenant-safe course loading. Course sections and
            lessons are shown as placeholders only.
          </p>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {placeholders.map((item, index) => (
          <Card
            className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10"
            key={item.title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {item.detail}
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}
