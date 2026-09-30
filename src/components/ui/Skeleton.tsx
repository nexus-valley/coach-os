export type SkeletonProps = {
  className?: string;
};

const opacityModifierPattern = String.raw`(?:\/(?:\d{1,3}|\[[^\]]+\]))?`;
const standardColorPattern = String.raw`(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)`;
const semanticColorPattern = String.raw`(?:action-primary(?:-hover|-subtle)?|canvas|surface(?:-elevated|-inverse|-subtle)?|status-(?:danger|info|success|warning)(?:-subtle)?)`;
const arbitraryColorPattern = String.raw`\[(?:#[0-9a-f]{3,8}|(?:var|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(.+\))\]`;

const backgroundColorUtilityPattern = new RegExp(
  String.raw`^!?bg-(?:(?:inherit|current|transparent|black|white|${standardColorPattern}|${semanticColorPattern})${opacityModifierPattern}|${arbitraryColorPattern}${opacityModifierPattern})!?$`,
  "i",
);

function hasBaseBackgroundColorUtility(className: string) {
  return className
    .split(/\s+/)
    .some((classToken) => backgroundColorUtilityPattern.test(classToken));
}

export function Skeleton({ className = "" }: SkeletonProps) {
  const hasCallerBackground = hasBaseBackgroundColorUtility(className);

  return (
    <div
      aria-hidden="true"
      className={[
        "animate-pulse rounded-ui",
        hasCallerBackground ? "" : "bg-action-primary-subtle",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
