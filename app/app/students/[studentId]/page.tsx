import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { StudentDetailClient } from "@/src/components/students/StudentDetailClient";

type StudentDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;
};

export default async function StudentDetailPage({
  params,
}: StudentDetailPageProps) {
  const { studentId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Students">
        <StudentDetailClient studentId={studentId} />
      </AppShell>
    </RouteGuard>
  );
}
