import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CoursesPageClient } from "@/src/components/courses/CoursesPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

export default function CoursesPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Programs">
        <CoursesPageClient />
      </AppShell>
    </RouteGuard>
  );
}
