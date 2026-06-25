import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { TeamOperationsPage } from "@/src/components/team-operations/TeamOperationsPage";

export default function TeamOperationsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Team Operations">
        <TeamOperationsPage />
      </AppShell>
    </RouteGuard>
  );
}
