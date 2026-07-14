import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { PublicSiteSettingsPage } from "@/src/components/public-site-settings/PublicSiteSettingsPage";

export default function PublicSiteSettingsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Branding">
        <FeatureGate featureKey="website_builder">
          <PublicSiteSettingsPage />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
