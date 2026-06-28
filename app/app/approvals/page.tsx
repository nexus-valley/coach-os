import { ApprovalCenterPage } from "@/src/components/approvals/ApprovalCenterPage";
import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";

export default function ApprovalsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Approvals">
        <FeatureGate featureKey="approvals">
          <ApprovalCenterPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
