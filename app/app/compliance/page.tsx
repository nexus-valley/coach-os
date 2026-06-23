import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { ComplianceCenterPage } from "@/src/components/compliance/ComplianceCenterPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function CompliancePage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Compliance">
        <ComplianceCenterPage />
      </AppShell>
    </RouteGuard>
  );
}
