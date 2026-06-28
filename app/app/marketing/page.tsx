import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { MarketingCenterPage } from "@/src/components/marketing/MarketingCenterPage";

export default function MarketingRoute() {
  return (
    <AppShell activeItem="Marketing">
      <FeatureGate featureKey="marketing">
        <MarketingCenterPage />
      </FeatureGate>
    </AppShell>
  );
}
