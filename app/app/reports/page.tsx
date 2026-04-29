import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { ReportsPageClient } from "@/src/components/reports/ReportsPageClient";

export default function ReportsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Reports">
        <ReportsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
