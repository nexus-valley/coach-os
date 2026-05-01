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
      <Badge className="border-amber-400/40 bg-amber-50 text-amber-700">
        Paused
      </Badge>
    );
  }

  if (status === "cancelled") {
    return (
      <Badge className="border-red-500/30 bg-red-50 text-red-700">
        Cancelled
      </Badge>
    );
  }

  return (
    <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
      Active
    </Badge>
  );
}
