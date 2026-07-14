"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  EnrollmentStatusBadge,
  formatEnrollmentStatus,
} from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
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
const enrollmentGridColumns =
  "grid-cols-[minmax(220px,1.4fr)_minmax(260px,1.4fr)_130px_130px]";

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
            Review all program enrollments. To create or update an enrollment,
            open the student profile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button href="/app/students" size="sm" variant="secondary">
            Open Students
          </Button>
          <Button href="/app/courses" size="sm" variant="secondary">
            Open Programs
          </Button>
          <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white">
            {filteredEnrollments.length} visible
          </div>
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
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Enrollment status tracks learning administration. Access-control
              rules such as expiry or payment gating are handled separately.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-400">Search</span>
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-white/30 focus:ring-4 focus:ring-white/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student or program"
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
                  {status === "all" ? "All statuses" : formatEnrollmentStatus(status)}
                </option>
              ))}
            </select>
          </label>
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
        <EmptyState
          action={{ label: "Open Students", onClick: () => router.push("/app/students") }}
          description="No enrollments yet. Add a student, create a program, then enroll the student from their profile."
          icon="EN"
          title="No enrollments found"
        />
      ) : (
        <Card className="mt-6 overflow-hidden border-white/10 bg-[#101214] text-white shadow-2xl shadow-black/10">
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              <div
                className={[
                  "grid gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold text-slate-400",
                  enrollmentGridColumns,
                ].join(" ")}
              >
                <span>Student</span>
                <span>Program</span>
                <span>Status</span>
                <span>Enrolled</span>
              </div>
              <div className="divide-y divide-white/10">
                {filteredEnrollments.map((enrollment) => (
                  <div
                    className={[
                      "grid gap-4 px-5 py-5",
                      enrollmentGridColumns,
                      "items-start",
                    ].join(" ")}
                    key={enrollment.id}
                  >
                    <Link
                      className="min-w-0 transition hover:text-white"
                      href={`/app/students/${enrollment.student_id}`}
                    >
                      <p className="truncate font-semibold">
                        {enrollment.student?.full_name ??
                          "Student unavailable"}
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-400">
                        {enrollment.student?.email ||
                          enrollment.student?.phone ||
                          "No contact details"}
                      </p>
                    </Link>
                    <Link
                      className="min-w-0 truncate font-semibold transition hover:text-white"
                      href={`/app/courses/${enrollment.course_id}`}
                    >
                      {enrollment.course?.title ?? "Program unavailable"}
                    </Link>
                    <div>
                      <EnrollmentStatusBadge status={enrollment.status} />
                    </div>
                    <p className="text-sm text-slate-400">
                      {formatDate(enrollment.enrolled_at)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
