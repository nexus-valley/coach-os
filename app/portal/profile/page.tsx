"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalProfile } from "@/src/components/portal/StudentPortalProfile";

export default function PortalProfilePage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalProfile context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
