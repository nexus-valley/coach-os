import Link from "next/link";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Button } from "@/src/components/ui/Button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between gap-4">
          <Link className="flex shrink-0 items-center gap-3" href="/">
            <CoachFortBrandAsset
              className="h-14 w-48 sm:h-16 sm:w-56"
              variant="fullLogo"
            />
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 xl:flex">
            <Link className="transition hover:text-zinc-950" href="/#platform">
              Platform
            </Link>
            <Link className="transition hover:text-zinc-950" href="/#features">
              Features
            </Link>
            <Link className="transition hover:text-zinc-950" href="/#why-coachfort">
              Why CoachFort
            </Link>
            <Link className="transition hover:text-zinc-950" href="/#about">
              About Us
            </Link>
            <Link className="transition hover:text-zinc-950" href="/support">
              Support
            </Link>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button href="/login" size="sm" variant="ghost">
              Login
            </Button>
            <Button href="/signup" size="sm">
              Sign Up
            </Button>
            <Button href="/demo" size="sm" variant="secondary">
              Try Demo
            </Button>
            <Button href="/support" size="sm" variant="secondary">
              Support
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 border-t border-[#D8E8F0]/70 py-3 text-center text-xs font-semibold md:hidden">
          <Link
            className="rounded-full px-2 py-2 text-[#0B2A3D] transition hover:bg-[#EAF7FC]"
            href="/login"
          >
            Login
          </Link>
          <Link
            className="rounded-full bg-[#145DA0] px-2 py-2 text-white shadow-sm shadow-[#145DA0]/15 transition hover:bg-[#0F4C81]"
            href="/signup"
          >
            Sign Up
          </Link>
          <Link
            className="rounded-full border border-[#D8E8F0] bg-white px-2 py-2 text-[#0B2A3D] transition hover:bg-[#F3FAFD]"
            href="/demo"
          >
            Demo
          </Link>
          <Link
            className="rounded-full border border-[#D8E8F0] bg-white px-2 py-2 text-[#0B2A3D] transition hover:bg-[#F3FAFD]"
            href="/support"
          >
            Support
          </Link>
        </div>
      </div>
    </header>
  );
}
