"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalMessages } from "@/src/components/portal/StudentPortalMessages";

export default function PortalMessagesPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalMessages context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
