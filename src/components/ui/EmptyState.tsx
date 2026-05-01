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
    <Card className="mt-6 border-[#D8E8F0] bg-white p-8 text-[#0B2A3D] shadow-2xl shadow-[#0B2A3D]/10">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2ECBEA] text-sm font-bold text-[#0B1F33] shadow-lg shadow-[#2ECBEA]/25">
          {icon}
        </div>
        <h3 className="mt-6 text-2xl font-semibold">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#5D7185]">{description}</p>
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
