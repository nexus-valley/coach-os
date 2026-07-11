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
        <p className="text-sm font-medium text-[#425B76]">{label}</p>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      <div className="mt-4 flex items-end gap-3">
        <p className="text-3xl font-semibold tracking-normal text-[#0B1F33]">
          {value}
        </p>
        {trend ? <div className="pb-1 text-sm font-semibold">{trend}</div> : null}
      </div>
      {description ? (
        <p className="mt-3 text-sm leading-6 text-[#66788F]">{description}</p>
      ) : null}
    </Card>
  );
}
