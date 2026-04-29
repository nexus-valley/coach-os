import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { StudentCourseAccessClient } from "@/src/components/student-portal/StudentCourseAccessClient";

type StudentPortalDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;
};

export default async function StudentPortalDetailPage({
  params,
}: StudentPortalDetailPageProps) {
  const { studentId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Portal">
        <StudentCourseAccessClient studentId={studentId} />
      </AppShell>
    </RouteGuard>
  );
}
