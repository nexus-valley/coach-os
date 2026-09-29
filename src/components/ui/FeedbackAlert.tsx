import type { ReactNode } from "react";

import { Button } from "@/src/components/ui/Button";

export type FeedbackAlertProps = {
  announcement?: "none" | "polite" | "assertive";
  children: ReactNode;
  className?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retrying?: boolean;
  tone?: "error" | "info" | "success" | "warning";
};

const toneClasses = {
  error:
    "border-status-danger/30 bg-status-danger-subtle text-status-danger",
  info: "border-status-info/30 bg-status-info-subtle text-status-info",
  success:
    "border-status-success/30 bg-status-success-subtle text-status-success",
  warning:
    "border-status-warning/30 bg-status-warning-subtle text-status-warning",
};

export function FeedbackAlert({
  announcement = "none",
  children,
  className = "",
  onRetry,
  retryDisabled = false,
  retrying = false,
  tone = "error",
}: FeedbackAlertProps) {
  const role =
    announcement === "polite"
      ? "status"
      : announcement === "assertive"
        ? "alert"
        : undefined;

  return (
    <div
      className={[
        "rounded-ui border p-4 text-sm leading-6 break-words",
        onRetry
          ? "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          : "",
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={role}
    >
      <p className="min-w-0 flex-1 font-medium">{children}</p>
      {onRetry ? (
        <Button
          className="shrink-0"
          disabled={retryDisabled}
          isLoading={retrying}
          loadingText="Retrying..."
          onClick={onRetry}
          size="sm"
          type="button"
          variant="secondary"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
