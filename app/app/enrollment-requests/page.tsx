import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { EnrollmentRequestsPageClient } from "@/src/components/enrollment-requests/EnrollmentRequestsPageClient";
import { AppShell } from "@/src/components/layout/AppShell";

type EnrollmentRequestsPageProps = {
  searchParams: Promise<{
    course?: string | string[];
  }>;
};

export default async function EnrollmentRequestsPage({
  searchParams,
}: EnrollmentRequestsPageProps) {
  const params = await searchParams;
  const initialCourseId =
    typeof params.course === "string" ? params.course : undefined;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Requests">
        <EnrollmentRequestsPageClient initialCourseId={initialCourseId} />
      </AppShell>
    </RouteGuard>
  );
}
