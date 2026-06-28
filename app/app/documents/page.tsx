import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { DocumentCenterPage } from "@/src/components/documents/DocumentCenterPage";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

export default function DocumentsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Documents">
        <FeatureGate featureKey="documents">
          <DocumentCenterPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
