import type { ReactNode } from "react";

import { Card } from "@/src/components/ui/Card";

type StatCardProps = {
  className?: string;
  description?: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  trend?: ReactNode;
  value: ReactNode;
};

export function StatCard({
  className = "",
  description,
  label,
  status,
  trend,
  value,
}: StatCardProps) {
  return (
    <Card className={className} padding="md">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold text-content-secondary">{label}</p>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      <div className="mt-4 flex items-end gap-3">
        <p className="text-2xl font-semibold tracking-normal text-content-primary">
          {value}
        </p>
        {trend ? <div className="pb-1 text-sm font-semibold">{trend}</div> : null}
      </div>
      {description ? (
        <p className="mt-3 text-sm leading-6 text-content-secondary">{description}</p>
      ) : null}
    </Card>
  );
}
