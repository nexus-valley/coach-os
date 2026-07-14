import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { BrandingSettingsPage } from "@/src/components/branding-settings/BrandingSettingsPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function SettingsBrandingPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Branding">
        <BrandingSettingsPage />
      </AppShell>
    </RouteGuard>
  );
}
