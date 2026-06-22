"use client";

import { StudentPortalDashboard } from "@/src/components/portal/StudentPortalDashboard";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalDashboard context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
