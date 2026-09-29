"use client";

/* eslint-disable jsx-a11y/role-supports-aria-props -- Native radio errors require explicit validation associations. */

import {
  useId,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";

export type RadioProps = Omit<
  ComponentPropsWithRef<"input">,
  "children" | "type"
> & {
  containerClassName?: string;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
};

export type RadioGroupProps = Omit<
  ComponentPropsWithRef<"fieldset">,
  "children"
> & {
  children: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  legend: ReactNode;
  orientation?: "horizontal" | "vertical";
};

function mergeDescribedBy(
  callerIds: string | undefined,
  generatedIds: string[],
) {
  const ids = [callerIds, ...generatedIds]
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .filter(Boolean);

  return [...new Set(ids)].join(" ") || undefined;
}

const choiceInputClasses =
  "mt-3 h-5 w-5 shrink-0 cursor-pointer accent-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:outline aria-invalid:outline-1 aria-invalid:outline-offset-1 aria-invalid:outline-status-danger aria-invalid:focus-visible:outline-2 aria-invalid:focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:accent-content-muted";

export function Radio({
  "aria-describedby": callerDescribedBy,
  "aria-errormessage": callerErrorMessage,
  "aria-invalid": callerInvalid,
  className = "",
  containerClassName = "",
  description,
  disabled,
  error,
  id,
  label,
  ref,
  ...props
}: RadioProps) {
  const generatedId = useId();
  const resolvedId = id ?? `radio-${generatedId}`;
  const descriptionId = `${resolvedId}-description`;
  const errorId = `${resolvedId}-error`;
  const hasDescription = Boolean(description);
  const hasError = Boolean(error);
  const describedBy = mergeDescribedBy(callerDescribedBy, [
    ...(hasDescription ? [descriptionId] : []),
    ...(hasError ? [errorId] : []),
  ]);

  return (
    <div
      className={[
        "grid min-h-11 grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3",
        containerClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        {...props}
        aria-describedby={describedBy}
        aria-errormessage={hasError ? errorId : callerErrorMessage}
        aria-invalid={hasError ? true : callerInvalid}
        className={[choiceInputClasses, className].filter(Boolean).join(" ")}
        disabled={disabled}
        id={resolvedId}
        ref={ref}
        type="radio"
      />
      <div className="min-w-0 py-2.5">
        <label
          className={[
            "block cursor-pointer text-sm font-medium leading-5",
            disabled
              ? "cursor-not-allowed text-content-muted"
              : "text-content-primary",
          ]
            .filter(Boolean)
            .join(" ")}
          htmlFor={resolvedId}
        >
          {label}
        </label>
        {hasDescription ? (
          <p
            className="mt-1 text-xs leading-5 text-content-muted"
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {hasError ? (
          <p
            className="mt-1 text-xs font-medium leading-5 text-status-danger"
            id={errorId}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function RadioGroup({
  "aria-describedby": callerDescribedBy,
  "aria-errormessage": callerErrorMessage,
  "aria-invalid": callerInvalid,
  children,
  className = "",
  description,
  disabled,
  error,
  legend,
  orientation = "vertical",
  ref,
  ...props
}: RadioGroupProps) {
  const generatedId = useId();
  const descriptionId = `radio-group-${generatedId}-description`;
  const errorId = `radio-group-${generatedId}-error`;
  const hasDescription = Boolean(description);
  const hasError = Boolean(error);
  const describedBy = mergeDescribedBy(callerDescribedBy, [
    ...(hasDescription ? [descriptionId] : []),
    ...(hasError ? [errorId] : []),
  ]);

  return (
    <fieldset
      {...props}
      aria-describedby={describedBy}
      aria-errormessage={hasError ? errorId : callerErrorMessage}
      aria-invalid={hasError ? true : callerInvalid}
      className={[
        "min-w-0 space-y-3 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-70",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      ref={ref}
    >
      <legend className="text-sm font-semibold text-content-primary">
        {legend}
      </legend>
      {hasDescription ? (
        <p
          className="mt-1 text-xs leading-5 text-content-muted"
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
      <div
        className={
          orientation === "horizontal"
            ? "flex flex-wrap gap-x-6 gap-y-2"
            : "grid gap-2"
        }
      >
        {children}
      </div>
      {hasError ? (
        <p
          className="mt-1 text-xs font-medium leading-5 text-status-danger"
          id={errorId}
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
