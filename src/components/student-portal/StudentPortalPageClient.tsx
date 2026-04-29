"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  getPortalStudentsForTenant,
  type PortalStudentSummary,
} from "@/src/lib/studentPortal";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

function getSearchText(summary: PortalStudentSummary) {
  return [
    summary.student.full_name,
    summary.student.email,
    summary.student.phone,
    summary.student.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getProgressLabel(summary: PortalStudentSummary) {
  if (summary.progressRecordCount === 0) {
    return "No progress yet";
  }

  return `${summary.completedLessonsCount}/${summary.progressRecordCount} tracked lessons completed`;
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function StudentPortalPageClient() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<PortalStudentSummary[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPortalStudents() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const portalStudents = await getPortalStudentsForTenant(
          currentTenant.id,
        );

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setStudents(portalStudents);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          getErrorMessage(caught, "Unable to load student portal preview."),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPortalStudents();

    return () => {
      active = false;
    };
  }, [router]);

  const filteredStudents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return students;
    }

    return students.filter((student) =>
      getSearchText(student).includes(normalizedSearch),
    );
  }, [search, students]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
            Internal preview
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Student Portal
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Preview the student-facing course access experience for enrolled
            learners before public student login is introduced.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white">
          {filteredStudents.length} visible
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end">
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
              placeholder="Student name, email, or phone"
              type="search"
              value={search}
            />
          </label>
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
              className="h-56 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading portal student</span>
            </Card>
          ))}
        </section>
      ) : filteredStudents.length === 0 ? (
        <Card className="mt-6 border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              SP
            </div>
            <h3 className="mt-6 text-2xl font-semibold">
              No enrolled students found
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Enroll students into courses to preview their portal access here.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredStudents.map((summary) => (
            <Card
              className="flex min-h-60 flex-col justify-between border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 transition hover:bg-[#15181b]"
              key={summary.student.id}
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <Badge className="border-white/15 bg-white/10 text-white">
                    {summary.enrolledCourseCount}{" "}
                    {summary.enrolledCourseCount === 1 ? "course" : "courses"}
                  </Badge>
                  <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
                    Preview
                  </Badge>
                </div>
                <h3 className="mt-6 text-2xl font-semibold leading-tight">
                  {summary.student.full_name}
                </h3>
                <p className="mt-3 text-sm text-slate-400">
                  {summary.student.email ||
                    summary.student.phone ||
                    "No contact details"}
                </p>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  {getProgressLabel(summary)}
                </p>
              </div>
              <Button
                className="mt-7"
                href={`/app/student-portal/${summary.student.id}`}
              >
                Open Portal Preview
              </Button>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
