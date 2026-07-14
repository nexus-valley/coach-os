import { Badge } from "@/src/components/ui/Badge";
import type { EnrollmentStatus } from "@/src/lib/enrollments";

export function formatEnrollmentStatus(status: EnrollmentStatus) {
  if (status === "completed") {
    return "Completed";
  }

  if (status === "paused") {
    return "Paused";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return "Active";
}

export function EnrollmentStatusBadge({
  status,
}: {
  status: EnrollmentStatus;
}) {
  if (status === "completed") {
    return <Badge tone="success">{formatEnrollmentStatus(status)}</Badge>;
  }

  if (status === "paused") {
    return <Badge tone="warning">{formatEnrollmentStatus(status)}</Badge>;
  }

  if (status === "cancelled") {
    return <Badge tone="danger">{formatEnrollmentStatus(status)}</Badge>;
  }

  return <Badge tone="owner">{formatEnrollmentStatus(status)}</Badge>;
}
