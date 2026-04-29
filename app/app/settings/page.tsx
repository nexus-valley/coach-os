import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { TeamSettingsClient } from "@/src/components/settings/TeamSettingsClient";

export default function SettingsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Settings">
        <TeamSettingsClient />
      </AppShell>
    </RouteGuard>
  );
}
