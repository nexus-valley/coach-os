import type { CSSProperties } from "react";

type CoachOSBrandAssetVariant = "appIcon" | "fullLogo" | "spinner";

type CoachOSBrandAssetProps = {
  alt?: string;
  className?: string;
  variant: CoachOSBrandAssetVariant;
};

const defaultClasses: Record<CoachOSBrandAssetVariant, string> = {
  appIcon: "h-11 w-11 rounded-2xl",
  fullLogo: "h-16 w-56",
  spinner: "h-16 w-16 rounded-full coachos-spin",
};

const imageStyles: Record<CoachOSBrandAssetVariant, CSSProperties> = {
  fullLogo: {
    left: "-4%",
    top: "-17%",
    width: "108%",
  },
  appIcon: {
    left: "-27%",
    top: "-175%",
    width: "310%",
  },
  spinner: {
    left: "-210%",
    top: "-211%",
    width: "358%",
  },
};

export function CoachOSBrandAsset({
  alt = "CoachOS",
  className = "",
  variant,
}: CoachOSBrandAssetProps) {
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
        src="/brand/coachos-master.png"
        style={imageStyles[variant]}
      />
    </span>
  );
}
