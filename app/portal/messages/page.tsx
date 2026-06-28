"use client";

import { FeatureGate } from "@/src/components/features/FeatureGate";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalMessages } from "@/src/components/portal/StudentPortalMessages";

export default function PortalMessagesPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate
            featureKey="messages"
            mode="portal"
            tenantId={context.tenant.id}
          >
            <StudentPortalMessages context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
