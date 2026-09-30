import type { ReactNode } from "react";

import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export type EmptyStateAction = {
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

export type EmptyStateProps = {
  action?: EmptyStateAction | ReactNode;
  className?: string;
  description: string;
  eyebrow?: string;
  icon?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "compact" | "default";
  title: string;
};

const containerClasses = {
  compact:
    "mt-4 rounded-ui border border-line bg-surface p-5 text-content-primary shadow-surface",
  default:
    "mt-6 rounded-ui border border-line bg-surface p-8 text-content-primary shadow-surface",
};

const titleClasses = {
  compact: "break-words text-lg font-semibold",
  default: "break-words text-2xl font-semibold",
};

const actionSpacingClasses = {
  compact: "mt-5",
  default: "mt-6",
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
  className = "",
  description,
  eyebrow,
  icon,
  secondaryAction,
  size = "default",
  title,
}: EmptyStateProps) {
  return (
    <Card
      className={[containerClasses[size], className].filter(Boolean).join(" ")}
    >
      <div className="mx-auto max-w-2xl text-center">
        {icon ? (
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-ui border border-line-strong bg-action-primary-subtle text-sm font-bold text-action-primary">
            {icon}
          </div>
        ) : null}
        {eyebrow ? (
          <p className="mt-5 text-xs font-semibold uppercase text-status-info">
            {eyebrow}
          </p>
        ) : null}
        <h3
          className={[
            titleClasses[size],
            icon || eyebrow ? "mt-4" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </h3>
        <p className="mt-3 break-words text-sm leading-6 text-content-secondary">
          {description}
        </p>
        {action || secondaryAction ? (
          <div
            className={`${actionSpacingClasses[size]} flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center`}
          >
            {isActionConfig(action) ? (
              <Button
                disabled={action.disabled}
                onClick={action.onClick}
                size="md"
                type="button"
                variant="primary"
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
