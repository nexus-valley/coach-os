import type { CSSProperties } from "react";

type CoachFortBrandAssetVariant = "appIcon" | "fullLogo" | "spinner";

type CoachFortBrandAssetProps = {
  alt?: string;
  className?: string;
  variant: CoachFortBrandAssetVariant;
};

const defaultClasses: Record<CoachFortBrandAssetVariant, string> = {
  appIcon: "h-11 w-11 rounded-2xl",
  fullLogo: "h-16 w-56",
  spinner: "h-16 w-16 rounded-full coachos-spin",
};

const imageStyles: Record<CoachFortBrandAssetVariant, CSSProperties> = {
  fullLogo: {
    left: "-4%",
    top: "-48%",
    width: "108%",
  },
  appIcon: {
    left: "-22%",
    top: "-207%",
    width: "358%",
  },
  spinner: {
    left: "-513%",
    top: "-432%",
    width: "672%",
  },
};

export function CoachFortBrandAsset({
  alt = "CoachFort",
  className = "",
  variant,
}: CoachFortBrandAssetProps) {
  return (
    <span
      className={[
        "relative inline-block shrink-0 overflow-hidden align-middle",
        defaultClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        className="absolute h-auto max-w-none select-none"
        draggable={false}
        src="/brand/coachfort-master.png"
        style={imageStyles[variant]}
      />
    </span>
  );
}
