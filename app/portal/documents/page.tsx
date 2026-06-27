"use client";

import { StudentPortalDocuments } from "@/src/components/portal/StudentPortalDocuments";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalDocumentsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalDocuments context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
