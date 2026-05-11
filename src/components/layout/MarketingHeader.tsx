import Link from "next/link";

import { Button } from "@/src/components/ui/Button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-3" href="/">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-linear-to-br from-[#145DA0] via-[#14B8C6] to-[#2ECBEA] text-sm font-bold text-white shadow-lg shadow-[#145DA0]/20">
            CO
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base font-semibold text-zinc-950">
              CoachOS
            </span>
            <span className="mt-1 text-xs font-medium text-zinc-500">
              by Nexus Valley
            </span>
          </span>
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
