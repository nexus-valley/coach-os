"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { formatEnrollmentStatus } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalCourses({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading programs" />;
  if (error || !overview) return <PortalError message={error || "Unable to load programs."} />;

  const completedCourses = overview.courses.filter((course) => course.isCompleted).length;
  const averageProgress =
    overview.courses.length === 0
      ? 0
      : Math.round(
          overview.courses.reduce(
            (total, course) => total + course.progressPercentage,
            0,
          ) / overview.courses.length,
        );

  return (
    <div className="space-y-6">
      <PageHeader
        description="Continue the programs assigned by your coach or team, review lesson progress, and see your current enrollment status."
        eyebrow="Learning"
        title="My Programs"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Enrolled" value={overview.courses.length} />
        <StatCard label="Completed" value={completedCourses} />
        <StatCard label="Average progress" value={`${averageProgress}%`} />
      </section>

      <SectionHeader
        description="Programs shown here are assigned by your coach or team. Enrollment status is shown for reference."
        title="Continue learning"
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {overview.courses.length === 0 ? (
          <PortalEmptyState>
            No programs have been assigned to you yet.
          </PortalEmptyState>
        ) : (
          overview.courses.map((course) => (
            <Card className="border-[#D8E8F0] bg-white p-6" key={course.course.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{course.course.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    {course.course.description || "Program details will appear here."}
                  </p>
                </div>
                <Badge tone={course.isCompleted ? "success" : "admin"}>
                  {formatEnrollmentStatus(course.enrollment.status)}
                </Badge>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
                <div
                  className="h-full rounded-full bg-[#145DA0]"
                  style={{ width: `${course.progressPercentage}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-[#425B76]">
                <span>
                  {course.completedLessonsCount}/{course.lessonCount} lessons complete
                </span>
                <span>{course.progressPercentage}%</span>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
