import type { ReactNode } from "react";

import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

type EmptyStateAction = {
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

type EmptyStateProps = {
  action?: EmptyStateAction | ReactNode;
  description: string;
  eyebrow?: string;
  icon?: ReactNode;
  secondaryAction?: ReactNode;
  title: string;
};

function isActionConfig(action: EmptyStateProps["action"]): action is EmptyStateAction {
  return Boolean(
    action &&
      typeof action === "object" &&
      "label" in action &&
      "onClick" in action,
  );
}

export function EmptyState({
  action,
  description,
  eyebrow,
  icon,
  secondaryAction,
  title,
}: EmptyStateProps) {
  return (
    <Card className="mt-6 border-[#CBD5E1] bg-white p-8 text-[#0B2A3D] shadow-sm shadow-slate-950/5">
      <div className="mx-auto max-w-2xl text-center">
        {icon ? (
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[#9ADDEA] bg-[#EAF8FC] text-sm font-bold text-[#0B2A3D] shadow-sm shadow-[#2ECBEA]/15">
            {icon}
          </div>
        ) : null}
        {eyebrow ? (
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#0E7490]">
            {eyebrow}
          </p>
        ) : null}
        <h3 className={["text-2xl font-semibold", icon || eyebrow ? "mt-4" : ""].join(" ")}>
          {title}
        </h3>
        <p className="mt-3 text-sm leading-6 text-[#334155]">{description}</p>
        {action ? (
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isActionConfig(action) ? (
              <Button
                disabled={action.disabled}
                onClick={action.onClick}
                type="button"
              >
                {action.label}
              </Button>
            ) : (
              action
            )}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
