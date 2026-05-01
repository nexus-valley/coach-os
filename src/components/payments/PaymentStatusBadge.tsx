import { Badge } from "@/src/components/ui/Badge";
import type { PaymentStatus } from "@/src/lib/payments";

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  if (status === "completed") {
    return <Badge tone="success">Completed</Badge>;
  }

  if (status === "failed") {
    return (
      <Badge className="border-red-500/30 bg-red-50 text-red-700">
        Failed
      </Badge>
    );
  }

  return (
    <Badge className="border-amber-400/40 bg-amber-50 text-amber-700">
      Pending
    </Badge>
  );
}
