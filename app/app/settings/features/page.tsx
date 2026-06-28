import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { FeatureSettingsPage } from "@/src/components/settings/FeatureSettingsPage";

export default function FeatureSettingsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Features">
        <FeatureSettingsPage />
      </AppShell>
    </RouteGuard>
  );
}
