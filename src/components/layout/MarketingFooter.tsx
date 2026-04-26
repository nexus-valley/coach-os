export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">
              NV
            </span>
            <div>
              <p className="font-semibold text-zinc-950">Nexus Valley CoachOS</p>
              <p className="text-sm text-zinc-500">
                Premium operating system for serious coaching businesses.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-semibold text-zinc-950">Platform</p>
            <div className="mt-4 space-y-3 text-zinc-500">
              <p>Courses</p>
              <p>Cohorts</p>
              <p>Payments</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-zinc-950">Operations</p>
            <div className="mt-4 space-y-3 text-zinc-500">
              <p>CRM</p>
              <p>Automation</p>
              <p>Analytics</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-zinc-950">Brand</p>
            <div className="mt-4 space-y-3 text-zinc-500">
              <p>Nexus Valley</p>
              <p>CoachOS</p>
              <p>2026</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
