import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { DashboardPageClient } from "@/src/components/dashboard/DashboardPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function PlatformPage() {
  return (
    <RouteGuard mode="app">
      <AppShell>
        <DashboardPageClient />
      </AppShell>
    </RouteGuard>
  );
}
