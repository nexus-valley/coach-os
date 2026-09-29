import { useId, type ReactNode } from "react";

export type FormFieldControlProps = Readonly<{
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-errormessage"?: string;
  disabled?: true;
  required?: true;
}>;

export type FormFieldProps = {
  children:
    | ReactNode
    | ((controlProps: FormFieldControlProps) => ReactNode);
  className?: string;
  controlId?: string;
  description?: ReactNode;
  disabled?: boolean;
  error?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
  required?: boolean;
  tone?: "dark" | "light";
};

export function FormField({
  children,
  className = "",
  controlId,
  description,
  disabled = false,
  error,
  htmlFor,
  label,
  required = false,
  tone = "light",
}: FormFieldProps) {
  const generatedId = useId();
  const generatedControlId = `form-field-${generatedId}`;
  const isRenderProp = typeof children === "function";
  const resolvedControlId = controlId ?? htmlFor ?? generatedControlId;
  const descriptionId =
    isRenderProp && description
      ? `${resolvedControlId}-description`
      : undefined;
  const errorId =
    isRenderProp && error ? `${resolvedControlId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps: FormFieldControlProps = {
    id: resolvedControlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(errorId
      ? { "aria-errormessage": errorId, "aria-invalid": true }
      : {}),
    ...(disabled ? { disabled: true } : {}),
    ...(required ? { required: true } : {}),
  };
  const renderedChildren = isRenderProp ? children(controlProps) : children;
  const labelClass =
    tone === "dark"
      ? "block text-sm font-semibold text-slate-200"
      : "block text-sm font-semibold text-content-primary";
  const descriptionClass =
    tone === "dark"
      ? "text-xs leading-5 text-slate-300"
      : "text-xs leading-5 text-content-muted";
  const errorClass =
    tone === "dark"
      ? "text-xs font-medium leading-5 text-red-300"
      : "text-xs font-medium leading-5 text-status-danger";
  const requiredMarkerClass = "ml-1 text-status-danger";

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <label
        className={labelClass}
        htmlFor={isRenderProp ? resolvedControlId : htmlFor}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className={requiredMarkerClass}>
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <p className={descriptionClass} id={descriptionId}>
          {description}
        </p>
      ) : null}
      {renderedChildren}
      {error ? (
        <p className={errorClass} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
