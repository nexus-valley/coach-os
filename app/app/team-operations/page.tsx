import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { TeamOperationsPage } from "@/src/components/team-operations/TeamOperationsPage";

export default function TeamOperationsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Team Operations">
        <FeatureGate featureKey="team_operations">
          <TeamOperationsPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
