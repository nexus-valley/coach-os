"use client";

import Link from "next/link";

import { CoachOSBrandAsset } from "@/src/components/branding/CoachOSBrandAsset";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ reset }: AppErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B2A3D]">
      <div className="w-full max-w-2xl rounded-[2rem] border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
        <CoachOSBrandAsset className="mx-auto h-14 w-14" variant="appIcon" />
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-[#145DA0]">
          Workspace interrupted
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          This workspace screen could not load.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#5D7185]">
          No technical details are exposed here. Retry the screen or return to
          the dashboard.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#145DA0] px-5 text-sm font-semibold text-white transition hover:brightness-110"
            onClick={reset}
            type="button"
          >
            Retry
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
