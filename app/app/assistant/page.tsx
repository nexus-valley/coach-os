import { AssistantPage } from "@/src/components/assistant/AssistantPage";
import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";

export default function AppAssistantRoute() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Assistant">
        <AssistantPage scope="team" />
      </AppShell>
    </RouteGuard>
  );
}
