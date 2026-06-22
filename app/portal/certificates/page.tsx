"use client";

import { StudentPortalCertificates } from "@/src/components/portal/StudentPortalCertificates";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalCertificatesPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalCertificates context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
