import { FinanceCenterPage } from "@/src/components/finance/FinanceCenterPage";
import { AppShell } from "@/src/components/layout/AppShell";

export default function FinanceRoute() {
  return (
    <AppShell activeItem="Finance">
      <FinanceCenterPage />
    </AppShell>
  );
}
