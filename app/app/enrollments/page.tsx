import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { EnrollmentsPageClient } from "@/src/components/enrollments/EnrollmentsPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function EnrollmentsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Enrollments">
        <EnrollmentsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
