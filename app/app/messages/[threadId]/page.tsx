import { RouteGuard } from "@/src/components/auth/RouteGuard";
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
        <ThreadDetailClient threadId={threadId} />
      </AppShell>
    </RouteGuard>
  );
}
