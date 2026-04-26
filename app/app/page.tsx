import { AppShell } from "@/src/components/layout/AppShell";
import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

const stats = [
  { label: "Total Students", value: "0", detail: "Ready for enrollment" },
  { label: "Active Courses", value: "0", detail: "Create your first offer" },
  { label: "Monthly Revenue", value: "$0", detail: "Connect payments later" },
  { label: "Pending Tasks", value: "4", detail: "Setup checklist" },
];

const setupSteps = [
  "Business profile",
  "Connect payment gateway",
  "Create first course",
  "Invite students",
];

export default function PlatformPage() {
  return (
    <RouteGuard mode="app">
      <AppShell>
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Module 1 foundation
              </Badge>
              <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                Dashboard
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-400">
                Your premium internal workspace shell is ready for courses,
                cohorts, students, payments, automations, and analytics.
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-300">
              Workspace: Nexus Valley
            </div>
          </div>

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <Card
                className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10"
                key={stat.label}
              >
                <p className="text-sm font-medium text-zinc-400">
                  {stat.label}
                </p>
                <p className="mt-4 text-4xl font-semibold tracking-normal">
                  {stat.value}
                </p>
                <p className="mt-3 text-sm text-zinc-500">{stat.detail}</p>
              </Card>
            ))}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.68fr]">
            <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <h3 className="text-xl font-semibold">Operating overview</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    This placeholder keeps the shell focused while future
                    modules add real data, tenant state, and workflows.
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-950">
                  Shell ready
                </span>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {["Learning", "Revenue", "Engagement"].map((item) => (
                  <div
                    className="rounded-3xl border border-white/10 bg-zinc-950/40 p-5"
                    key={item}
                  >
                    <p className="text-sm font-medium text-zinc-400">{item}</p>
                    <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/3 rounded-full bg-white" />
                    </div>
                    <p className="mt-4 text-xs text-zinc-500">
                      Waiting for module data
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">
                    Platform setup progress
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Complete the core workspace setup before launching.
                  </p>
                </div>
                <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                  0/4
                </span>
              </div>

              <div className="mt-7 space-y-4">
                {setupSteps.map((step) => (
                  <div
                    className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                    key={step}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-sm font-semibold text-zinc-500">
                      +
                    </span>
                    <div>
                      <p className="font-medium text-zinc-950">{step}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        Pending setup
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </div>
      </AppShell>
    </RouteGuard>
  );
}
