"use client";

import Link from "next/link";

import { CoachOSLogo } from "@/src/components/branding/CoachOSLogo";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B2A3D]">
      <div className="w-full max-w-2xl rounded-[2rem] border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
        <CoachOSLogo className="mx-auto h-14 w-14" variant="icon" />
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-[#145DA0]">
          Something went wrong
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          CoachOS could not finish loading this screen.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#5D7185]">
          The issue has been contained. Try again, or return to the dashboard
          and continue from there.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#145DA0] px-5 text-sm font-semibold text-white transition hover:brightness-110"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-5 text-sm font-semibold text-[#0B2A3D] transition hover:bg-[#F3FAFD]"
            href="/app"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
