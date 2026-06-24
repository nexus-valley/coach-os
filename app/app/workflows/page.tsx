import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { WorkflowBuilderPage } from "@/src/components/workflows/WorkflowBuilderPage";

export default function WorkflowsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Workflows">
        <WorkflowBuilderPage />
      </AppShell>
    </RouteGuard>
  );
}
