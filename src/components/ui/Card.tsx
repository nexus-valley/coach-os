type CardProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  padding?: "lg" | "md" | "none" | "sm";
  variant?: "dark" | "default" | "elevated" | "glass" | "subtle";
} & React.HTMLAttributes<HTMLDivElement>;

const variantClasses = {
  dark: "border-[#1E293B] bg-[#0F172A] text-white shadow-lg shadow-slate-950/15",
  default:
    "border-[#CBD5E1] bg-white text-[#0B1F33] shadow-sm shadow-slate-950/5",
  elevated:
    "border-[#CBD5E1] bg-white text-[#0B1F33] shadow-lg shadow-slate-950/10",
  glass:
    "border-[#CBD5E1] bg-white/90 text-[#0B1F33] shadow-sm shadow-slate-950/5 backdrop-blur-xl",
  subtle:
    "border-[#CBD5E1] bg-[#F9FBFD] text-[#0B1F33] shadow-none",
};

const paddingClasses = {
  lg: "p-6",
  md: "p-5",
  none: "",
  sm: "p-4",
};

export function Card({
  children,
  className = "",
  interactive = false,
  padding = "none",
  variant = "default",
  ...props
}: CardProps) {
  return (
    <div
      className={[
        "rounded-lg border",
        variantClasses[variant],
        paddingClasses[padding],
        interactive
          ? "transition duration-200 hover:-translate-y-0.5 hover:border-[#145DA0]/45 hover:shadow-md hover:shadow-slate-950/10"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
