import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AssignmentDetailClient } from "@/src/components/assignments/AssignmentDetailClient";
import { AppShell } from "@/src/components/layout/AppShell";

type AssignmentDetailPageProps = {
  params: Promise<{
    assignmentId: string;
  }>;
};

export default async function AssignmentDetailPage({
  params,
}: AssignmentDetailPageProps) {
  const { assignmentId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Assignments">
        <AssignmentDetailClient assignmentId={assignmentId} />
      </AppShell>
    </RouteGuard>
  );
}
