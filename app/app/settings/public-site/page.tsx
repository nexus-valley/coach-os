import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { PublicSiteSettingsPage } from "@/src/components/public-site-settings/PublicSiteSettingsPage";

export default function PublicSiteSettingsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Public Site">
        <PublicSiteSettingsPage />
      </AppShell>
    </RouteGuard>
  );
}
