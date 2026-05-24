import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AssignmentsPageClient } from "@/src/components/assignments/AssignmentsPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function AssignmentsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Assignments">
        <AssignmentsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
