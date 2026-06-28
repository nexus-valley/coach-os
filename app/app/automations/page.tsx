import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AutomationsPageClient } from "@/src/components/automations/AutomationsPageClient";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

export default function AutomationsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Automations">
        <FeatureGate featureKey="automations">
          <AutomationsPageClient />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
