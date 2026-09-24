import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { AppShell } from "@/src/components/layout/AppShell";
import { VideoLibraryClient } from "@/src/components/video/VideoLibraryClient";

export default function VideoLibraryPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Video Library">
        <VideoLibraryClient />
      </AppShell>
    </RouteGuard>
  );
}
