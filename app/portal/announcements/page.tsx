"use client";

import { Suspense } from "react";

import { FeatureGate } from "@/src/components/features/FeatureGate";
import { StudentPortalAnnouncements } from "@/src/components/portal/StudentPortalAnnouncements";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { PortalLoadingCard } from "@/src/components/portal/StudentPortalShared";

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
            <Suspense
              fallback={<PortalLoadingCard label="Loading announcements" />}
            >
              <StudentPortalAnnouncements context={context} />
            </Suspense>
          </FeatureGate>
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
