import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { SessionsPageClient } from "@/src/components/sessions/SessionsPageClient";

export default function SessionsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Live Classes">
        <SessionsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
