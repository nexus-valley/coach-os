type BadgeTone = "dark" | "light" | "success";

type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  dark: "border-zinc-800 bg-zinc-950 text-white",
  light: "border-zinc-300 bg-white text-zinc-950 shadow-sm",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
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
