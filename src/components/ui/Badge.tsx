type BadgeTone =
  | "admin"
  | "danger"
  | "dark"
  | "light"
  | "owner"
  | "staff"
  | "success"
  | "trainer"
  | "warning";

type BadgeProps = {
  children: React.ReactNode;
  className?: string;
  tone?: BadgeTone;
} & React.HTMLAttributes<HTMLSpanElement>;

const toneClasses: Record<BadgeTone, string> = {
  admin: "border-[#BFDDF5] bg-[#EEF6FF] text-[#145DA0]",
  danger: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
  dark: "border-[#D8E8F0] bg-white text-[#0B1F33]",
  light: "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B2A3D] shadow-sm",
  owner: "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]",
  staff: "border-[#CBD5E1] bg-[#F1F5F9] text-[#334155]",
  success: "border-[#A7F3D0] bg-[#E8F8F3] text-[#047857]",
  trainer: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
  warning: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
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
