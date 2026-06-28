import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { MarketingCenterPage } from "@/src/components/marketing/MarketingCenterPage";

export default function MarketingRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Marketing">
        <FeatureGate featureKey="marketing">
          <MarketingCenterPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
