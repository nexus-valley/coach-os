import { Badge } from "@/src/components/ui/Badge";
import type { PaymentStatus } from "@/src/lib/payments";

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  if (status === "completed") {
    return <Badge tone="success">Completed</Badge>;
  }

  if (status === "failed") {
    return <Badge className="border-red-500/30 bg-red-500/15 text-red-300">Failed</Badge>;
  }

  return (
    <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
      Pending
    </Badge>
  );
}
