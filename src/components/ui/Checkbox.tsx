"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
  type Ref,
} from "react";

export type CheckboxProps = Omit<
  ComponentPropsWithRef<"input">,
  "children" | "type"
> & {
  containerClassName?: string;
  description?: ReactNode;
  error?: ReactNode;
  indeterminate?: boolean;
  label: ReactNode;
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

function assignRef<T>(ref: Ref<T> | undefined, node: T) {
  if (typeof ref === "function") {
    const cleanup = ref(node);

    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }

  if (ref) {
    ref.current = node;

    return () => {
      if (ref.current === node) {
        ref.current = null;
      }
    };
  }

  return undefined;
}

export function Checkbox({
  "aria-describedby": callerDescribedBy,
  "aria-errormessage": callerErrorMessage,
  "aria-invalid": callerInvalid,
  className = "",
  containerClassName = "",
  description,
  disabled,
  error,
  id,
  indeterminate = false,
  label,
  ref,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const resolvedId = id ?? `checkbox-${generatedId}`;
  const descriptionId = `${resolvedId}-description`;
  const errorId = `${resolvedId}-error`;
  const hasDescription = Boolean(description);
  const hasError = Boolean(error);
  const internalRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (!node) {
        return;
      }

      const cleanups = [assignRef(internalRef, node), assignRef(ref, node)].filter(
        (cleanup): cleanup is () => void => Boolean(cleanup),
      );

      return () => {
        for (const cleanup of cleanups.reverse()) {
          cleanup();
        }
      };
    },
    [ref],
  );
  const describedBy = mergeDescribedBy(callerDescribedBy, [
    ...(hasDescription ? [descriptionId] : []),
    ...(hasError ? [errorId] : []),
  ]);

  useEffect(() => {
    if (internalRef.current) {
      internalRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

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
        className={[
          "mt-3 h-5 w-5 shrink-0 cursor-pointer accent-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:outline aria-invalid:outline-1 aria-invalid:outline-offset-1 aria-invalid:outline-status-danger aria-invalid:focus-visible:outline-2 aria-invalid:focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:accent-content-muted",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        id={resolvedId}
        ref={mergedRef}
        type="checkbox"
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
