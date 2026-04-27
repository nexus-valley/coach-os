type BadgeTone = "dark" | "light" | "success";

type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  dark: "border-white/10 bg-white/10 text-white",
  light: "border-teal-400/30 bg-teal-400/10 text-teal-300 shadow-sm",
  success: "border-teal-400/30 bg-teal-400/15 text-teal-300",
};

export function Badge({ children, className = "", tone = "light" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
