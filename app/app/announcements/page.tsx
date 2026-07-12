import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AnnouncementsPageClient } from "@/src/components/announcements/AnnouncementsPageClient";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

export default function AnnouncementsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Messages">
        <FeatureGate featureKey="messages">
          <AnnouncementsPageClient />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
