"use client";

import { StudentPortalCourses } from "@/src/components/portal/StudentPortalCourses";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalCoursesPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalCourses context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
