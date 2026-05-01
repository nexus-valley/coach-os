type BadgeTone = "dark" | "light" | "success";

type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  tone?: BadgeTone;
} & React.HTMLAttributes<HTMLSpanElement>;

const toneClasses: Record<BadgeTone, string> = {
  dark: "border-[#D8E8F0] bg-white text-[#0B1F33]",
  light: "border-[#2ECBEA]/40 bg-[#EAF7FC] text-[#145DA0] shadow-sm",
  success: "border-[#14B8A6]/30 bg-[#14B8A6]/10 text-[#0F766E]",
};

export function Badge({
  children,
  className = "",
  tone = "light",
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
