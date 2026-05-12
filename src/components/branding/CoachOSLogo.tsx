import type { CSSProperties } from "react";

type CoachOSLogoVariant = "full" | "icon" | "spinner";

type CoachOSLogoProps = {
  className?: string;
  label?: string;
  variant?: CoachOSLogoVariant;
};

const defaultClasses: Record<CoachOSLogoVariant, string> = {
  full: "h-14 w-48 rounded-2xl shadow-sm shadow-[#0B2A3D]/10",
  icon: "h-11 w-11 rounded-2xl shadow-lg shadow-[#0B2A3D]/20",
  spinner:
    "h-16 w-16 rounded-full shadow-lg shadow-amber-400/25 coachos-logo-spin",
};

const cropStyles: Record<CoachOSLogoVariant, CSSProperties> = {
  full: {
    left: "-4%",
    top: "-72%",
    width: "154%",
  },
  icon: {
    left: "-448%",
    top: "-219%",
    width: "614%",
  },
  spinner: {
    left: "-396%",
    top: "-86%",
    width: "549%",
  },
};

export function CoachOSLogo({
  className = "",
  label = "CoachOS",
  variant = "full",
}: CoachOSLogoProps) {
  return (
    <span
      className={[
        "relative inline-block shrink-0 overflow-hidden bg-[#111827] align-middle",
        defaultClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={label}
        className="absolute h-auto max-w-none"
        src="/brand/coachos-master.png"
        style={cropStyles[variant]}
      />
    </span>
  );
}
