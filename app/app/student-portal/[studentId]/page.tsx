import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { StudentPortalPreviewClient } from "@/src/components/student-portal/StudentPortalPreviewClient";

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
        <StudentPortalPreviewClient studentId={studentId} />
      </AppShell>
    </RouteGuard>
  );
}
