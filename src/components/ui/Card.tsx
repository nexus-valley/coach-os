type CardProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  padding?: "lg" | "md" | "none" | "sm";
  variant?: "dark" | "default" | "elevated" | "glass" | "subtle";
} & React.HTMLAttributes<HTMLDivElement>;

const variantClasses = {
  dark: "border-white/10 bg-[#101214] text-white shadow-lg shadow-black/15",
  default:
    "border-[#D8E8F0] bg-white text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5",
  elevated:
    "border-[#D8E8F0] bg-white text-[#0B1F33] shadow-lg shadow-[#0B2A3D]/10",
  glass:
    "border-white/40 bg-white/75 text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5 backdrop-blur-xl",
  subtle:
    "border-[#D8E8F0] bg-[#F7FCFF] text-[#0B1F33] shadow-none",
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
          ? "transition duration-200 hover:-translate-y-0.5 hover:border-[#2ECBEA]/55 hover:shadow-md hover:shadow-[#0B2A3D]/8"
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
