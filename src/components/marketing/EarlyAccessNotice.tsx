import { Button } from "@/src/components/ui/Button";

export const earlyAccessContactHref = "https://wa.me/917338841434";
export const earlyAccessMessage =
  "CoachFort is currently in early access. We\u2019re onboarding selected coaching centres and academies in phases while we complete our production launch checks.";

type EarlyAccessNoticeProps = {
  className?: string;
  tone?: "dark" | "light";
};

export function EarlyAccessNotice({
  className = "",
  tone = "light",
}: EarlyAccessNoticeProps) {
  const isDark = tone === "dark";

  // Temporary early-access launch guard shown until MVP launch checks are complete.
  return (
    <section
      className={[
        "border-b px-5 py-4 sm:px-6 lg:px-8",
        isDark
          ? "border-white/10 bg-white/10 text-white"
          : "border-[#D8E8F0] bg-[#FFF7ED] text-[#0B2A3D]",
        className,
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={[
            "max-w-4xl text-sm font-medium leading-6",
            isDark ? "text-zinc-100" : "text-[#425B76]",
          ].join(" ")}
        >
          {earlyAccessMessage}
        </p>
        <Button href={earlyAccessContactHref} size="sm" variant="secondary">
          Contact us for early access
        </Button>
      </div>
    </section>
  );
}
