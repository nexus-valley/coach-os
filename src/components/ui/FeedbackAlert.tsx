import { Button } from "@/src/components/ui/Button";

type FeedbackAlertProps = {
  children: React.ReactNode;
  onRetry?: () => void;
  tone?: "error" | "success" | "warning";
};

const toneClasses = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-[#14B8A6]/30 bg-[#14B8A6]/10 text-[#0F766E]",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
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
