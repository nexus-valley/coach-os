import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { FeatureGate } from "@/src/components/features/FeatureGate";
import { AppShell } from "@/src/components/layout/AppShell";
import { ThreadDetailClient } from "@/src/components/messages/ThreadDetailClient";

type MessageThreadPageProps = {
  params: Promise<{
    threadId: string;
  }>;
};

export default async function MessageThreadPage({
  params,
}: MessageThreadPageProps) {
  const { threadId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Messages">
        <FeatureGate featureKey="messages">
          <ThreadDetailClient threadId={threadId} />
        </FeatureGate>
      </AppShell>
    </RouteGuard>
  );
}
