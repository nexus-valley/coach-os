"use client";

import { FeatureGate } from "@/src/components/features/FeatureGate";
import { StudentPortalCommunity } from "@/src/components/portal/StudentPortalCommunity";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalCommunityPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate featureKey="messages" mode="portal" tenantId={context.tenant.id}>
            <StudentPortalCommunity context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
