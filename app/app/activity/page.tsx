import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { ActivityPageClient } from "@/src/components/activity/ActivityPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function ActivityPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Activity">
        <ActivityPageClient />
      </AppShell>
    </RouteGuard>
  );
}
