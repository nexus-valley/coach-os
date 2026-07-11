import type { ReactNode } from "react";

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  metadata?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  className = "",
  description,
  eyebrow,
  metadata,
  title,
}: PageHeaderProps) {
  return (
    <section
      className={[
        "flex flex-col gap-5 border-b border-[#D8E8F0] pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0E7490]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#425B76]">
            {description}
          </p>
        ) : null}
        {metadata ? <div className="mt-4 flex flex-wrap gap-2">{metadata}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </section>
  );
}
