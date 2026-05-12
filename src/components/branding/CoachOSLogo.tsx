type CoachOSLogoVariant = "full" | "icon" | "spinner";

type CoachOSLogoProps = {
  className?: string;
  label?: string;
  variant?: CoachOSLogoVariant;
};

const assets: Record<CoachOSLogoVariant, string> = {
  full: "/brand/coachos-logo.png",
  icon: "/brand/coachos-icon.png",
  spinner: "/brand/coachos-spinner.png",
};

const defaultClasses: Record<CoachOSLogoVariant, string> = {
  full: "h-14 w-48",
  icon: "h-11 w-11",
  spinner: "h-16 w-16 coachos-spin",
};

export function CoachOSLogo({
  className = "",
  label = "CoachOS",
  variant = "full",
}: CoachOSLogoProps) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center justify-center align-middle",
        defaultClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={label}
        className="h-full w-full object-contain"
        src={assets[variant]}
      />
    </span>
  );
}
