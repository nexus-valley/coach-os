"use client";

import { StudentPortalAssignments } from "@/src/components/portal/StudentPortalAssignments";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalAssignmentsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalAssignments context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
