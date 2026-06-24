import { ApprovalCenterPage } from "@/src/components/approvals/ApprovalCenterPage";
import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";

export default function ApprovalsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Approvals">
        <ApprovalCenterPage />
      </AppShell>
    </RouteGuard>
  );
}
