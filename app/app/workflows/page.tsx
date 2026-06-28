import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { WorkflowBuilderPage } from "@/src/components/workflows/WorkflowBuilderPage";

export default function WorkflowsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Workflows">
        <FeatureGate featureKey="workflows">
          <WorkflowBuilderPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
