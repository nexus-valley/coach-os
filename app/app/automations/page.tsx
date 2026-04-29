import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AutomationsPageClient } from "@/src/components/automations/AutomationsPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function AutomationsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Automations">
        <AutomationsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
