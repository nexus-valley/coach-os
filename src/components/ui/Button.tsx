import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  children: React.ReactNode;
  className?: string;
  href?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const baseClasses =
  "inline-flex items-center justify-center rounded-full font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-white/10 bg-[var(--coachos-brand)] text-black shadow-lg shadow-teal-950/30 hover:-translate-y-0.5 hover:brightness-110",
  secondary:
    "border border-white/10 bg-white/10 text-white shadow-sm hover:-translate-y-0.5 hover:bg-white/15",
  ghost: "text-slate-300 hover:bg-white/10 hover:text-white",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  children,
  className = "",
  href,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <Link className={classes} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}
