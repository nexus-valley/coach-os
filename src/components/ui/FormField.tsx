import type { ReactNode } from "react";

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
  required?: boolean;
};

export function FormField({
  children,
  className = "",
  description,
  error,
  htmlFor,
  label,
  required = false,
}: FormFieldProps) {
  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <label
        className="block text-sm font-semibold text-[#0B2A3D]"
        htmlFor={htmlFor}
      >
        {label}
        {required ? <span className="ml-1 text-[#B91C1C]">*</span> : null}
      </label>
      {description ? (
        <p className="text-xs leading-5 text-[#66788F]">{description}</p>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium leading-5 text-[#B91C1C]">{error}</p>
      ) : null}
    </div>
  );
}
