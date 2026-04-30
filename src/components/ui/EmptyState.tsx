import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

type EmptyStateProps = {
  action?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
  };
  description: string;
  icon: string;
  title: string;
};

export function EmptyState({
  action,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <Card className="mt-6 border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--coachos-brand)] text-sm font-bold text-black">
          {icon}
        </div>
        <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
        {action ? (
          <Button
            className="mt-7"
            disabled={action.disabled}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
