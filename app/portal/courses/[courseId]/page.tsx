"use client";

import { use } from "react";

import { StudentCourseViewer } from "@/src/components/portal/StudentCourseViewer";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

type StudentCourseViewerPageProps = {
  params: Promise<{ courseId: string }>;
};

export default function StudentCourseViewerPage({
  params,
}: StudentCourseViewerPageProps) {
  const { courseId } = use(params);

  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentCourseViewer context={context} courseId={courseId} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
