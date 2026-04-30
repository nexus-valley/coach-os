import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050607] px-5 text-white">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-[#101214] p-8 text-center shadow-2xl shadow-black/30">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
          404
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-teal-300">
          Page not found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-normal">
          This CoachOS page does not exist.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-400">
          The route may have moved, or the link may be incomplete.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            className="inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black transition hover:bg-teal-300"
            href="/app"
          >
            Back to dashboard
          </Link>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15"
            href="/"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
