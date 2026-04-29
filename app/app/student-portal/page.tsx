import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { StudentPortalPageClient } from "@/src/components/student-portal/StudentPortalPageClient";

export default function StudentPortalPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Portal">
        <StudentPortalPageClient />
      </AppShell>
    </RouteGuard>
  );
}
