import Link from "next/link";

type AppShellProps = {
  activeItem?: string;
  children: React.ReactNode;
};

const navItems = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/courses", label: "Courses" },
  { href: "#", label: "Cohorts" },
  { href: "/app/students", label: "Students" },
  { href: "/app/enrollments", label: "Enrollments" },
  { href: "#", label: "CRM" },
  { href: "#", label: "Community" },
  { href: "/app/payments", label: "Payments" },
  { href: "#", label: "Automations" },
  { href: "#", label: "Analytics" },
  { href: "#", label: "Settings" },
];

const iconMap: Record<string, string> = {
  Analytics: "AN",
  Automations: "AU",
  CRM: "CR",
  Cohorts: "CO",
  Community: "CM",
  Courses: "CU",
  Dashboard: "DB",
  Enrollments: "EN",
  Payments: "PY",
  Settings: "ST",
  Students: "SD",
};

export function AppShell({ activeItem = "Dashboard", children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_32rem),linear-gradient(135deg,rgba(39,39,42,0.55),transparent_34rem)]" />

      <div className="relative flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-white/[0.04] px-4 py-5 backdrop-blur-xl lg:block">
          <Link className="flex items-center gap-3 px-2" href="/app">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
              CO
            </span>
            <div>
              <p className="text-base font-semibold">CoachOS</p>
              <p className="text-xs text-zinc-400">Nexus Valley</p>
            </div>
          </Link>

          <nav className="mt-10 space-y-1">
            {navItems.map((item) => {
              const active = item.label === activeItem;

              return (
                <Link
                  className={[
                    "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition",
                    active
                      ? "bg-white text-zinc-950 shadow-lg shadow-black/20"
                      : "text-zinc-200 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                  href={item.href}
                  key={item.label}
                >
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-xl text-[10px] font-bold",
                      active
                        ? "bg-zinc-950 text-white"
                        : "bg-white/10 text-zinc-100",
                    ].join(" ")}
                  >
                    {iconMap[item.label]}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl">
            <div className="flex h-20 items-center justify-between px-5 sm:px-6 lg:px-8">
              <div>
                <p className="text-xs font-semibold text-zinc-500">
                  Nexus Valley
                </p>
                <h1 className="mt-1 text-xl font-semibold text-white">
                  CoachOS
                </h1>
              </div>
              <div className="hidden items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-zinc-100 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Workspace ready
              </div>
            </div>
          </header>

          <main className="flex-1 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-zinc-950/90 px-3 py-3 backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {navItems.slice(0, 5).map((item) => {
              const active = item.label === activeItem;

              return (
                <Link
                  className={[
                    "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium",
                    active
                      ? "bg-white text-zinc-950"
                      : "text-zinc-200 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                  href={item.href}
                  key={item.label}
                >
                  <span className="text-[10px] font-bold">
                    {iconMap[item.label]}
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
