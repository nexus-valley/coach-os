import Link from "next/link";
import type { ReactNode } from "react";

type ButtonVariant =
  | "destructive"
  | "ghost"
  | "outline"
  | "premium"
  | "primary"
  | "secondary"
  | "success";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  href?: string;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  loadingText?: string;
  rightIcon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[#D8E8F0] disabled:bg-[#E5EEF4] disabled:text-[#66788F] disabled:shadow-none";

const variantClasses: Record<ButtonVariant, string> = {
  destructive:
    "border border-[#B91C1C]/20 bg-[#DC2626] text-white shadow-sm shadow-[#DC2626]/15 hover:-translate-y-0.5 hover:bg-[#B91C1C]",
  outline:
    "border border-[#BFD7E6] bg-transparent text-[#0B2A3D] hover:-translate-y-0.5 hover:border-[#145DA0]/45 hover:bg-white/70",
  premium:
    "border border-[#D9A32F]/30 bg-[#0B2A3D] text-white shadow-md shadow-[#0B2A3D]/15 hover:-translate-y-0.5 hover:bg-[#082236]",
  primary:
    "coachos-primary-button border border-[#145DA0]/20 bg-[#145DA0] text-white shadow-md shadow-[#145DA0]/15 hover:-translate-y-0.5 hover:bg-[#0F4C81]",
  secondary:
    "border border-[#D8E8F0] bg-white text-[#0B2A3D] shadow-sm hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]",
  ghost: "text-[#5D7185] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]",
  success:
    "border border-[#047857]/20 bg-[#059669] text-white shadow-sm shadow-[#059669]/15 hover:-translate-y-0.5 hover:bg-[#047857]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  children,
  className = "",
  disabled,
  fullWidth = false,
  href,
  isLoading = false,
  leftIcon,
  loadingText,
  rightIcon,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || isLoading;
  const content = isLoading && loadingText ? loadingText : children;
  const classes = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const buttonContent = (
    <>
      {isLoading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80"
        />
      ) : (
        leftIcon
      )}
      <span>{content}</span>
      {!isLoading ? rightIcon : null}
    </>
  );

  if (href) {
    return (
      <Link
        aria-busy={isLoading || undefined}
        aria-disabled={isDisabled || undefined}
        className={classes}
        href={href}
        onClick={isDisabled ? (event) => event.preventDefault() : undefined}
        tabIndex={isDisabled ? -1 : undefined}
      >
        {buttonContent}
      </Link>
    );
  }

  return (
    <button
      aria-busy={isLoading || undefined}
      className={classes}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {buttonContent}
    </button>
  );
}
