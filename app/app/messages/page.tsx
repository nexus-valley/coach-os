import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { MessagesPageClient } from "@/src/components/messages/MessagesPageClient";

export default function MessagesPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Messages">
        <MessagesPageClient />
      </AppShell>
    </RouteGuard>
  );
}
