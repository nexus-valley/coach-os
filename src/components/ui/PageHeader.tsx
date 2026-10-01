import Link from "next/link";
import type { ReactNode } from "react";

type PageHeaderProps = {
  actions?: ReactNode;
  backLink?: {
    href: string;
    label: string;
  };
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  metadata?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  backLink,
  className = "",
  description,
  eyebrow,
  metadata,
  title,
}: PageHeaderProps) {
  return (
    <section
      className={[
        "flex min-w-0 flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0 flex-1 sm:min-w-80">
        {backLink ? (
          <Link
            className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-ui text-sm font-semibold text-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            href={backLink.href}
          >
            <span aria-hidden="true">&larr;</span>
            <span>{backLink.label}</span>
          </Link>
        ) : null}
        {eyebrow ? (
          <div className="text-xs font-semibold uppercase tracking-normal text-status-info">
            {eyebrow}
          </div>
        ) : null}
        <h1
          className={[
            "break-words text-3xl font-semibold tracking-normal text-content-primary",
            eyebrow ? "mt-2" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-content-secondary">
            {description}
          </p>
        ) : null}
        {metadata ? <div className="mt-4 flex flex-wrap gap-2">{metadata}</div> : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
