import type { ReactNode } from "react";

type SectionHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function SectionHeader({
  actions,
  className = "",
  description,
  eyebrow,
  title,
}: SectionHeaderProps) {
  return (
    <div
      className={[
        "flex min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0 flex-1 sm:min-w-64">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-normal text-status-info">
            {eyebrow}
          </p>
        ) : null}
        <h2
          className={[
            "break-words text-xl font-semibold tracking-normal text-content-primary",
            eyebrow ? "mt-2" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-content-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
