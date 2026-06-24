import { AppShell } from "@/src/components/layout/AppShell";
import { CrmPage } from "@/src/components/crm/CrmPage";

export default function CrmRoute() {
  return (
    <AppShell activeItem="CRM">
      <CrmPage />
    </AppShell>
  );
}
