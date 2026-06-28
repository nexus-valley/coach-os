import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { FinanceCenterPage } from "@/src/components/finance/FinanceCenterPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function FinanceRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Finance">
        <FeatureGate featureKey="finance">
          <FinanceCenterPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
