"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalCourses({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading courses" />;
  if (error || !overview) return <PortalError message={error || "Unable to load courses."} />;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">My Courses</h1>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {overview.courses.length === 0 ? (
          <PortalEmptyState>No enrolled courses yet.</PortalEmptyState>
        ) : (
          overview.courses.map((course) => (
            <Card className="border-[#D8E8F0] bg-white p-6" key={course.course.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{course.course.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    {course.course.description || "Course details will appear here."}
                  </p>
                </div>
                <Badge tone={course.isCompleted ? "success" : "admin"}>
                  {course.enrollment.status}
                </Badge>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#EAF7FC]">
                <div
                  className="h-full rounded-full bg-[#145DA0]"
                  style={{ width: `${course.progressPercentage}%` }}
                />
              </div>
              <p className="mt-3 text-sm font-medium text-[#425B76]">
                {course.completedLessonsCount}/{course.lessonCount} lessons complete
              </p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
