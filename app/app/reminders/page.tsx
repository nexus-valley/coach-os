import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { RemindersPageClient } from "@/src/components/reminders/RemindersPageClient";

export default function RemindersPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Reminders">
        <RemindersPageClient />
      </AppShell>
    </RouteGuard>
  );
}
