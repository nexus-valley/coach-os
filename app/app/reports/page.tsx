import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { ReportsPageClient } from "@/src/components/reports/ReportsPageClient";

export default function ReportsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Reports">
        <FeatureGate featureKey="reports">
          <ReportsPageClient />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
