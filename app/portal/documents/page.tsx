"use client";

import { StudentPortalDocuments } from "@/src/components/portal/StudentPortalDocuments";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { FeatureGate } from "@/src/components/features/FeatureGate";

export default function PortalDocumentsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate
            featureKey="documents"
            mode="portal"
            tenantId={context.tenant.id}
          >
            <StudentPortalDocuments context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
