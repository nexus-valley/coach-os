"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getEnrollmentsForTenant,
  type EnrollmentStatus,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StatusFilter = "all" | EnrollmentStatus;

const statusFilters: StatusFilter[] = [
  "all",
  "active",
  "completed",
  "paused",
  "cancelled",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getSearchText(enrollment: EnrollmentWithRelations) {
  return [
    enrollment.student?.full_name,
    enrollment.student?.email,
    enrollment.student?.phone,
    enrollment.course?.title,
    enrollment.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function EnrollmentsPageClient() {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadEnrollments() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const tenantEnrollments = await getEnrollmentsForTenant(
          currentTenant.id,
        );

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setEnrollments(tenantEnrollments);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load enrollments right now.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEnrollments();

    return () => {
      active = false;
    };
  }, [router]);

  const filteredEnrollments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return enrollments.filter((enrollment) => {
      const matchesStatus =
        statusFilter === "all" || enrollment.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        getSearchText(enrollment).includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [enrollments, search, statusFilter]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-white/15 bg-white/10 text-white">
            Enrollment foundation
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
            Enrollments
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            See which students are connected to which courses across this
            workspace.
          </p>
        </div>
        <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white">
          {filteredEnrollments.length} visible
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-[#101214] p-5 text-white shadow-2xl shadow-black/10 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
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
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student or course"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Status</span>
            <select
              className="mt-2 h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              {statusFilters.map((status) => (
                <option className="text-slate-950" key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4">
          {[0, 1, 2].map((item) => (
            <Card
              className="h-24 animate-pulse border-white/10 bg-[#101214]"
              key={item}
            >
              <span className="sr-only">Loading enrollment</span>
            </Card>
          ))}
        </section>
      ) : filteredEnrollments.length === 0 ? (
        <Card className="mt-6 border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              EN
            </div>
            <h3 className="mt-6 text-2xl font-semibold">
              No enrollments found
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Enroll a student from their profile to create the first course
              connection.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="hidden grid-cols-[1fr_1fr_auto_auto] gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold text-slate-400 lg:grid">
            <span>Student</span>
            <span>Course</span>
            <span>Status</span>
            <span>Enrolled</span>
          </div>
          <div className="divide-y divide-white/10">
            {filteredEnrollments.map((enrollment) => (
              <div
                className="grid gap-4 px-5 py-5 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center"
                key={enrollment.id}
              >
                <Link
                  className="transition hover:text-white"
                  href={`/app/students/${enrollment.student_id}`}
                >
                  <p className="font-semibold">
                    {enrollment.student?.full_name ?? "Student unavailable"}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {enrollment.student?.email ||
                      enrollment.student?.phone ||
                      "No contact details"}
                  </p>
                </Link>
                <Link
                  className="font-semibold transition hover:text-white"
                  href={`/app/courses/${enrollment.course_id}`}
                >
                  {enrollment.course?.title ?? "Course unavailable"}
                </Link>
                <EnrollmentStatusBadge status={enrollment.status} />
                <p className="text-sm text-slate-400">
                  {formatDate(enrollment.enrolled_at)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
