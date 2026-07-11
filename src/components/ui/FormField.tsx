import type { ReactNode } from "react";

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
  required?: boolean;
  tone?: "dark" | "light";
};

export function FormField({
  children,
  className = "",
  description,
  error,
  htmlFor,
  label,
  required = false,
  tone = "light",
}: FormFieldProps) {
  const labelClass =
    tone === "dark"
      ? "block text-sm font-medium text-slate-300"
      : "block text-sm font-semibold text-[#0B2A3D]";
  const descriptionClass =
    tone === "dark"
      ? "text-xs leading-5 text-slate-400"
      : "text-xs leading-5 text-[#66788F]";
  const errorClass =
    tone === "dark"
      ? "text-xs font-medium leading-5 text-red-300"
      : "text-xs font-medium leading-5 text-[#B91C1C]";

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <label
        className={labelClass}
        htmlFor={htmlFor}
      >
        {label}
        {required ? <span className="ml-1 text-[#B91C1C]">*</span> : null}
      </label>
      {description ? (
        <p className={descriptionClass}>{description}</p>
      ) : null}
      {children}
      {error ? (
        <p className={errorClass}>{error}</p>
      ) : null}
    </div>
  );
}
