import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CohortDetailClient } from "@/src/components/cohorts/CohortDetailClient";
import { AppShell } from "@/src/components/layout/AppShell";

type CohortDetailPageProps = {
  params: Promise<{
    cohortId: string;
  }>;
};

export default async function CohortDetailPage({
  params,
}: CohortDetailPageProps) {
  const { cohortId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Cohorts">
        <CohortDetailClient cohortId={cohortId} />
      </AppShell>
    </RouteGuard>
  );
}
