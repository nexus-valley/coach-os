import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { OperationsPageClient } from "@/src/components/operations/OperationsPageClient";

export default function OperationsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Operations">
        <OperationsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
