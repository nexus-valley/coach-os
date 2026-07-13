import { Button } from "@/src/components/ui/Button";

export const earlyAccessContactHref = "/support";
export const maintenanceTestingMessage =
  "CoachFort is currently under maintenance and testing. You may explore the platform, but please do not use it for live academy operations yet.";
export const earlyAccessMessage =
  maintenanceTestingMessage;

type EarlyAccessNoticeProps = {
  className?: string;
  tone?: "dark" | "light";
};

export function EarlyAccessNotice({
  className = "",
  tone = "light",
}: EarlyAccessNoticeProps) {
  const isDark = tone === "dark";

  // Temporary testing notice shown while production launch checks continue.
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
          {maintenanceTestingMessage}
        </p>
        <Button href="/support" size="sm" variant="secondary">
          Testing support
        </Button>
      </div>
    </section>
  );
}
