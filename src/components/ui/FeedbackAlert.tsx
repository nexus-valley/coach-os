import { Button } from "@/src/components/ui/Button";

type FeedbackAlertProps = {
  children: React.ReactNode;
  className?: string;
  onRetry?: () => void;
  tone?: "error" | "info" | "success" | "warning";
};

const toneClasses = {
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-[#14B8A6]/30 bg-[#14B8A6]/10 text-[#0F766E]",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
};

export function FeedbackAlert({
  children,
  className = "",
  onRetry,
  tone = "error",
}: FeedbackAlertProps) {
  return (
    <div
      className={[
    "rounded-lg border p-4 text-sm font-medium leading-6",
        onRetry ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "",
        toneClasses[tone],
        className,
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
