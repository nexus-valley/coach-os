import type { ReactNode } from "react";

import { Card } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";

type TableShellProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title?: ReactNode;
};

export function TableShell({
  actions,
  children,
  className = "",
  description,
  title,
}: TableShellProps) {
  return (
    <Card className={["overflow-hidden bg-white", className].filter(Boolean).join(" ")}>
      {title || description || actions ? (
        <div className="border-b border-[#CBD5E1] p-5">
          <SectionHeader actions={actions} description={description} title={title} />
        </div>
      ) : null}
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}
