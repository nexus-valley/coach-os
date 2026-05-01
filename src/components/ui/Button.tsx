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
  "inline-flex items-center justify-center rounded-full font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[#D8E8F0] disabled:bg-[#E5EEF4] disabled:text-[#66788F] disabled:shadow-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "coachos-primary-button border border-[#145DA0]/20 bg-[#145DA0] text-white shadow-md shadow-[#145DA0]/15 hover:-translate-y-0.5 hover:bg-[#0F4C81]",
  secondary:
    "border border-[#D8E8F0] bg-white text-[#0B2A3D] shadow-sm hover:-translate-y-0.5 hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]",
  ghost: "text-[#5D7185] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]",
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
