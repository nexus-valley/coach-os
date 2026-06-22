import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { PermissionsPageClient } from "@/src/components/security/PermissionsPageClient";

export default function PermissionsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Permissions">
        <PermissionsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
