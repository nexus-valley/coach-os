"use client";

import { FeatureGate } from "@/src/components/features/FeatureGate";
import { StudentPortalAnnouncements } from "@/src/components/portal/StudentPortalAnnouncements";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalAnnouncementsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <FeatureGate
            featureKey="messages"
            mode="portal"
            tenantId={context.tenant.id}
          >
            <StudentPortalAnnouncements context={context} />
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
