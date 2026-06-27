import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { DocumentCenterPage } from "@/src/components/documents/DocumentCenterPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function DocumentsRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Documents">
        <DocumentCenterPage />
      </AppShell>
    </RouteGuard>
  );
}
