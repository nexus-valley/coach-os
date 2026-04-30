export default function AppLoading() {
  return (
    <main className="min-h-screen bg-[#050607] px-5 py-6 text-white sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="h-8 w-32 animate-pulse rounded-full bg-white/10" />
            <div className="mt-5 h-10 w-64 animate-pulse rounded-2xl bg-white/10" />
            <div className="mt-4 h-5 w-full max-w-xl animate-pulse rounded-full bg-white/10" />
          </div>
          <div className="h-10 w-40 animate-pulse rounded-full bg-teal-400/20" />
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              className="h-36 animate-pulse rounded-[2rem] border border-white/10 bg-[#101214]"
              key={item}
            />
          ))}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          {[0, 1].map((item) => (
            <div
              className="h-80 animate-pulse rounded-[2rem] border border-white/10 bg-[#101214]"
              key={item}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
