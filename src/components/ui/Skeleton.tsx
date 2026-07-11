type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        "animate-pulse rounded-lg bg-[#EAF7FC]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
