"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalPayments } from "@/src/components/portal/StudentPortalPayments";

export default function PortalPaymentsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalPayments context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
