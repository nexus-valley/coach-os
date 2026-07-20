import { Button } from "@/src/components/ui/Button";

export const earlyAccessContactHref = "/support";
export const earlyAccessSupportMessage =
  "CoachFort is currently in early access for online coaching businesses setting up branded program pages and student access flows. Explore safely before using it for live student operations.";
export const earlyAccessMessage =
  earlyAccessSupportMessage;

type EarlyAccessNoticeProps = {
  className?: string;
  tone?: "dark" | "light";
};

export function EarlyAccessNotice({
  className = "",
  tone = "light",
}: EarlyAccessNoticeProps) {
  const isDark = tone === "dark";

  // Soft-launch notice shown while founder-led onboarding continues.
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
          {earlyAccessSupportMessage}
        </p>
        <Button href="/support" size="sm" variant="secondary">
          Founder-led support
        </Button>
      </div>
    </section>
  );
}
