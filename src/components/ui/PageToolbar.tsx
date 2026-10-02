import type { ReactNode } from "react";

export type PageToolbarProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  label: string;
};

export function PageToolbar({
  actions,
  children,
  className = "",
  label,
}: PageToolbarProps) {
  return (
    <div
      aria-label={label}
      className={[
        "flex w-full flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
    >
      <div className="flex min-w-0 w-full flex-1 flex-wrap items-end gap-3">
        {children}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center justify-start gap-3 md:w-auto md:shrink-0 md:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
