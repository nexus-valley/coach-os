import { Badge } from "@/src/components/ui/Badge";
import type { EnrollmentStatus } from "@/src/lib/enrollments";

export function EnrollmentStatusBadge({
  status,
}: {
  status: EnrollmentStatus;
}) {
  if (status === "completed") {
    return <Badge tone="success">Completed</Badge>;
  }

  if (status === "paused") {
    return <Badge tone="warning">Paused</Badge>;
  }

  if (status === "cancelled") {
    return <Badge tone="danger">Cancelled</Badge>;
  }

  return <Badge tone="owner">Active</Badge>;
}
