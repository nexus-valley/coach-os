import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { BackupRecoveryPage } from "@/src/components/backup/BackupRecoveryPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function BackupPage() {
  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Backup & Recovery">
        <BackupRecoveryPage />
      </AppShell>
    </RouteGuard>
  );
}
