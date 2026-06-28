"use client";

import { FeatureGate } from "@/src/components/features/FeatureGate";
import { StudentPortalCertificates } from "@/src/components/portal/StudentPortalCertificates";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalCertificatesPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate
            featureKey="certificates"
            mode="portal"
            tenantId={context.tenant.id}
          >
            <StudentPortalCertificates context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
