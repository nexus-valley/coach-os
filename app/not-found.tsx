import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3FAFD] px-5 text-[#0B2A3D]">
      <div className="w-full max-w-2xl rounded-[2rem] border border-[#D8E8F0] bg-white p-8 text-center shadow-2xl shadow-[#0B2A3D]/10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2ECBEA] text-sm font-bold text-[#0B2A3D]">
          404
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-[#145DA0]">
          Page not found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          This CoachOS page does not exist.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#5D7185]">
          The route may have moved, or the link may be incomplete.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#145DA0] px-5 text-sm font-semibold text-white transition hover:brightness-110"
            href="/app"
          >
            Back to dashboard
          </Link>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#D8E8F0] bg-white px-5 text-sm font-semibold text-[#0B2A3D] transition hover:bg-[#F3FAFD]"
            href="/"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
