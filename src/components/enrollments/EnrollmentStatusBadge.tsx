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
    return <Badge className="border-amber-200 bg-amber-50 text-amber-700">Paused</Badge>;
  }

  if (status === "cancelled") {
    return <Badge className="border-red-200 bg-red-50 text-red-700">Cancelled</Badge>;
  }

  return <Badge className="border-sky-200 bg-sky-50 text-sky-700">Active</Badge>;
}
