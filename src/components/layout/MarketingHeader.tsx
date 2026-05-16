import Link from "next/link";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Button } from "@/src/components/ui/Button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-3" href="/">
          <CoachFortBrandAsset
            className="h-14 w-48 sm:h-16 sm:w-56"
            variant="fullLogo"
          />
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 lg:flex">
          <a className="transition hover:text-zinc-950" href="#platform">
            Platform
          </a>
          <a className="transition hover:text-zinc-950" href="#features">
            Features
          </a>
          <a className="transition hover:text-zinc-950" href="#why-coachfort">
            Why CoachFort
          </a>
          <a className="transition hover:text-zinc-950" href="#about">
            About Us
          </a>
          <a className="transition hover:text-zinc-950" href="#contact">
            Contact
          </a>
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          <Button href="/demo" size="sm">
            Try Demo
          </Button>
          <Button href="#contact" size="sm" variant="secondary">
            Contact
          </Button>
        </div>
      </div>
    </header>
  );
}
