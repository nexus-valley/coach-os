import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { StudentsPageClient } from "@/src/components/students/StudentsPageClient";

export default function StudentsPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Students">
        <StudentsPageClient />
      </AppShell>
    </RouteGuard>
  );
}
