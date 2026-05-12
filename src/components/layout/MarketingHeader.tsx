import Link from "next/link";

import { CoachOSLogo } from "@/src/components/branding/CoachOSLogo";
import { Button } from "@/src/components/ui/Button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-3" href="/">
          <CoachOSLogo className="h-11 w-40 sm:h-12 sm:w-44" variant="full" />
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 lg:flex">
          <a className="transition hover:text-zinc-950" href="#platform">
            Platform
          </a>
          <a className="transition hover:text-zinc-950" href="#features">
            Features
          </a>
          <a className="transition hover:text-zinc-950" href="#why-coachos">
            Why CoachOS
          </a>
          <a className="transition hover:text-zinc-950" href="#about">
            About Us
          </a>
          <a className="transition hover:text-zinc-950" href="#contact">
            Contact
          </a>
        </nav>

        <Button className="hidden sm:inline-flex" href="/demo" size="sm">
          Try Demo
        </Button>
      </div>
    </header>
  );
}
