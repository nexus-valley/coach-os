import Link from "next/link";

import { Button } from "@/src/components/ui/Button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-3" href="/">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-bold text-white shadow-lg shadow-zinc-950/20">
            NV
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-zinc-950">
              Nexus Valley
            </span>
            <span className="mt-1 text-xs font-medium text-zinc-500">
              CoachOS
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex">
          <a className="transition hover:text-zinc-950" href="#solution">
            Platform
          </a>
          <a className="transition hover:text-zinc-950" href="#features">
            Features
          </a>
          <a className="transition hover:text-zinc-950" href="#problem">
            Why CoachOS
          </a>
        </nav>

        <Button className="hidden sm:inline-flex" href="/app" size="sm">
          View Platform
        </Button>
      </div>
    </header>
  );
}
