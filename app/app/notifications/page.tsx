import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { NotificationsPageClient } from "@/src/components/notifications/NotificationsPageClient";

export default function NotificationsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Notifications">
        <NotificationsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
