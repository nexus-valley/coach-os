import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { MobileReadinessPage } from "@/src/components/mobile-readiness/MobileReadinessPage";

export default function MobileReadinessRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Mobile Readiness">
        <MobileReadinessPage />
      </AppShell>
    </RouteGuard>
  );
}
