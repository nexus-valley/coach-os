"use client";

import { use } from "react";

import { StudentPortalAssignmentDetail } from "@/src/components/portal/StudentPortalAssignmentDetail";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

type StudentAssignmentDetailPageProps = {
  params: Promise<{ assignmentId: string }>;
};

export default function StudentAssignmentDetailPage({
  params,
}: StudentAssignmentDetailPageProps) {
  const { assignmentId } = use(params);

  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalAssignmentDetail
            assignmentId={assignmentId}
            context={context}
          />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
