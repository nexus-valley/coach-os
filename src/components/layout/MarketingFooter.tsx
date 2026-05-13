import { CoachOSBrandAsset } from "@/src/components/branding/CoachOSBrandAsset";

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-5 py-8 text-center text-sm text-zinc-500 sm:px-6 md:flex-row md:text-left lg:px-8">
        <div className="flex flex-col items-center gap-3 md:items-start">
          <CoachOSBrandAsset className="h-12 w-44" variant="fullLogo" />
          <p>&copy; 2026 Nexus Valley Technologies. All rights reserved.</p>
        </div>
        <div className="flex items-center gap-2 font-medium text-zinc-600">
          <a className="transition hover:text-zinc-950" href="#about">
            About
          </a>
          <span className="text-zinc-300">|</span>
          <a className="transition hover:text-zinc-950" href="#contact">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
