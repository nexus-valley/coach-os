import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { SessionDetailClient } from "@/src/components/sessions/SessionDetailClient";

type SessionDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  const { sessionId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Sessions">
        <SessionDetailClient sessionId={sessionId} />
      </AppShell>
    </RouteGuard>
  );
}
