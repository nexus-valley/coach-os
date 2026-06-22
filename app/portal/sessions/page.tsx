"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalSessions } from "@/src/components/portal/StudentPortalSessions";

export default function PortalSessionsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalSessions context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
