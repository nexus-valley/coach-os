import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CommunityPageClient } from "@/src/components/community/CommunityPageClient";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

export default function CommunityPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Community">
        <FeatureGate featureKey="messages">
          <CommunityPageClient />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
