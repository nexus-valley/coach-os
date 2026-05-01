import { Badge } from "@/src/components/ui/Badge";
import type { PaymentStatus } from "@/src/lib/payments";

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  if (status === "completed") {
    return <Badge tone="success">Completed</Badge>;
  }

  if (status === "failed") {
    return <Badge tone="danger">Failed</Badge>;
  }

  return <Badge tone="warning">Pending</Badge>;
}
