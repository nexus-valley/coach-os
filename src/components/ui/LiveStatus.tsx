import type { ReactNode } from "react";

export type LiveStatusProps = {
  children: ReactNode;
  className?: string;
  politeness?: "polite" | "assertive";
  visuallyHidden?: boolean;
};

export function LiveStatus({
  children,
  className = "",
  politeness = "polite",
  visuallyHidden = false,
}: LiveStatusProps) {
  return (
    <div
      className={[
        "text-sm leading-6 text-content-muted",
        visuallyHidden ? "sr-only" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={politeness === "assertive" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
