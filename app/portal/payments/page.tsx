"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalPayments } from "@/src/components/portal/StudentPortalPayments";
import { FeatureGate } from "@/src/components/features/FeatureGate";

export default function PortalPaymentsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate
            featureKey="finance"
            mode="portal"
            tenantId={context.tenant.id}
          >
            <StudentPortalPayments context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
