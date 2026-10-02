import type { ReactNode } from "react";

export type PageContainerProps = {
  children: ReactNode;
  className?: string;
  width?: "editor" | "full" | "narrow" | "standard";
};

const widthClasses = {
  editor: "mx-auto w-full max-w-7xl",
  full: "w-full",
  narrow: "mx-auto w-full max-w-3xl",
  standard: "mx-auto w-full max-w-6xl",
};

export function PageContainer({
  children,
  className = "",
  width = "standard",
}: PageContainerProps) {
  return (
    <div className={[widthClasses[width], className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
