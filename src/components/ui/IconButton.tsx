import type { ButtonHTMLAttributes, ReactNode } from "react";

import {
  buttonControlClasses,
  buttonVariantClasses,
  type ButtonVariant,
} from "./buttonStyles";

export type IconButtonSize = "compact" | "default";

export type IconButtonProps = {
  icon: ReactNode;
  label: string;
  size?: IconButtonSize;
  variant?: ButtonVariant;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "aria-labelledby" | "children"
>;

const sizeClasses: Record<IconButtonSize, string> = {
  compact: "h-10 w-10 p-0",
  default: "h-11 w-11 p-0",
};

const iconSizeClasses: Record<IconButtonSize, string> = {
  compact:
    "inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
  default:
    "inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
};

export function IconButton({
  className = "",
  disabled,
  icon,
  label,
  size = "default",
  type = "button",
  variant = "secondary",
  ...props
}: IconButtonProps) {
  const classes = [
    buttonControlClasses,
    buttonVariantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      aria-label={label}
      className={classes}
      disabled={disabled}
      type={type}
    >
      <span aria-hidden="true" className={iconSizeClasses[size]}>
        {icon}
      </span>
    </button>
  );
}
