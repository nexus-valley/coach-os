import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CohortsPageClient } from "@/src/components/cohorts/CohortsPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function CohortsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Cohorts">
        <CohortsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
