import { Button } from "@/src/components/ui/Button";

type FeedbackAlertProps = {
  children: React.ReactNode;
  onRetry?: () => void;
  tone?: "error" | "success" | "warning";
};

const toneClasses = {
  error: "border-red-400/30 bg-red-500/10 text-red-100",
  success: "border-teal-400/30 bg-teal-400/10 text-teal-100",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-100",
};

export function FeedbackAlert({
  children,
  onRetry,
  tone = "error",
}: FeedbackAlertProps) {
  return (
    <div
      className={[
        "rounded-3xl border p-4 text-sm",
        onRetry ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "",
        toneClasses[tone],
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p>{children}</p>
      {onRetry ? (
        <Button onClick={onRetry} size="sm" type="button" variant="secondary">
          Retry
        </Button>
      ) : null}
    </div>
  );
}
