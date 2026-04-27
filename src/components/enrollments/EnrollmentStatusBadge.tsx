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
    return (
      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
        Paused
      </Badge>
    );
  }

  if (status === "cancelled") {
    return (
      <Badge className="border-red-500/30 bg-red-500/15 text-red-300">
        Cancelled
      </Badge>
    );
  }

  return (
    <Badge className="border-teal-400/30 bg-teal-400/10 text-teal-300">
      Active
    </Badge>
  );
}
