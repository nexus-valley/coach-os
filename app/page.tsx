import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";

const features = [
  {
    description:
      "Create structured courses with sections, lessons, video/resource links, and learner progress tracking.",
    title: "Course Builder",
  },
  {
    description:
      "Organize students into batches, connect cohorts to courses, and track members with start and end dates.",
    title: "Live Cohorts",
  },
  {
    description:
      "Manage student profiles, contact details, notes, enrollments, payments, and follow-ups in one place.",
    title: "Student CRM",
  },
  {
    description:
      "Record payments, generate receipts, track payment status, and manage UPI-ready payment links.",
    title: "Payments",
  },
  {
    description:
      "Share payment links, receipts, reminders, and certificates through WhatsApp-ready templates, with automation rules for follow-ups.",
    title: "WhatsApp & Email Automation",
  },
  {
    description:
      "Build engagement around your coaching programs with future-ready community and learner interaction workflows.",
    title: "Community",
  },
  {
    description:
      "View revenue, students, enrollments, course performance, payment activity, and export reports for business decisions.",
    title: "Analytics",
  },
  {
    description:
      "Manage workspace branding, roles, permissions, subscription plans, and secure team access.",
    title: "Admin Controls",
  },
];

const previewRows = [
  ["Course launch", "82%", "On track"],
  ["Cohort delivery", "14 live", "Active"],
  ["Revenue ops", "$48.2k", "This month"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <MarketingHeader />

      <section className="relative overflow-hidden border-b border-zinc-200 bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(24,24,27,0.12),transparent_28rem),linear-gradient(135deg,rgba(244,244,245,0.95),rgba(255,255,255,0.55))]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-12 px-5 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-20">
          <div className="max-w-3xl">
            <Badge tone="dark">Premium coaching infrastructure</Badge>
            <h1 className="mt-8 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-normal text-zinc-950 sm:text-6xl lg:text-7xl">
              Run your entire coaching business from one premium platform.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl">
              Courses, cohorts, payments, communities, CRM, automation, and
              analytics &mdash; built for serious coaches and academies.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button href="/demo" size="lg">
                Try Demo
              </Button>
              <Button href="/signup" size="lg" variant="secondary">
                Start Building
              </Button>
              <Button href="/app" size="lg" variant="secondary">
                Open Platform
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-zinc-950/5 blur-3xl" />
            <Card className="relative overflow-hidden border-zinc-300 bg-zinc-950 p-4 text-white shadow-2xl shadow-zinc-950/20">
              <div className="rounded-2xl border border-white/10 bg-white/4 p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-5">
                  <div>
                    <p className="text-sm font-semibold text-white">CoachOS</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Business command center
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                    Live workspace
                  </span>
                </div>

                <div className="grid gap-3 py-5 sm:grid-cols-3">
                  {["Students", "Revenue", "Completion"].map((item, index) => (
                    <div
                      className="rounded-2xl border border-white/10 bg-white/6 p-4"
                      key={item}
                    >
                      <p className="text-xs text-zinc-400">{item}</p>
                      <p className="mt-3 text-2xl font-semibold">
                        {["2,480", "$48k", "91%"][index]}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  {previewRows.map(([label, value, status]) => (
                    <div
                      className="grid grid-cols-[1fr_auto] gap-4 rounded-2xl border border-white/10 bg-white/4 p-4 sm:grid-cols-[1fr_auto_auto]"
                      key={label}
                    >
                      <p className="font-medium text-white">{label}</p>
                      <p className="font-semibold text-white">{value}</p>
                      <p className="hidden text-sm text-zinc-400 sm:block">
                        {status}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section
        className="mx-auto grid max-w-7xl gap-6 px-5 py-20 sm:px-6 lg:grid-cols-3 lg:px-8"
        id="why-coachos"
      >
        <div className="lg:col-span-1">
          <Badge>Problem</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal sm:text-4xl">
            Coaches are running premium brands on disconnected tools.
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {[
            "Course content lives in one app while cohort operations happen somewhere else.",
            "Payments, CRM, messages, and student progress rarely speak to each other.",
            "Teams lose hours stitching together reports instead of improving the learning experience.",
            "Clients feel the operational gaps even when the coaching itself is excellent.",
          ].map((item) => (
            <Card className="p-6" key={item}>
              <span className="mb-5 block h-1.5 w-12 rounded-full bg-zinc-950" />
              <p className="text-base leading-7 text-zinc-600">{item}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-zinc-950 text-white" id="platform">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <Badge className="border-white/15 bg-white/10 text-white">
              Solution
            </Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal sm:text-4xl">
              One operating system for every layer of a coaching business.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              "Design learning paths, launch cohorts, and track student progress from one control room.",
              "Unify sales, payments, community, delivery, and operations without rebuilding your stack every month.",
              "Give founders, coaches, and admins a shared command center for decisions and execution.",
              "Start with a premium foundation that can grow into the full Nexus Valley CoachOS platform.",
            ].map((item) => (
              <div
                className="rounded-3xl border border-white/10 bg-white/6 p-6 shadow-xl shadow-black/10"
                key={item}
              >
                <p className="leading-7 text-zinc-300">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8"
        id="features"
      >
        <div className="max-w-2xl">
          <Badge>Feature Grid</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal sm:text-4xl">
            Built around the workflows serious coaches need every day.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Card
              className="group min-h-52 p-6 transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-zinc-950/[0.08]"
              key={feature.title}
            >
              <div className="flex h-full flex-col justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="mt-8 text-lg font-semibold text-zinc-950">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section
        className="mx-auto grid max-w-7xl gap-8 px-5 pb-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8"
        id="about"
      >
        <div>
          <Badge>About Us</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
            About CoachOS
          </h2>
        </div>
        <Card className="p-6 sm:p-8">
          <div className="space-y-5 text-base leading-8 text-zinc-600">
            <p>
              CoachOS is built by Nexus Valley to help coaches, trainers, and
              small academies run their business without complexity.
            </p>
            <p>
              From managing students and courses to tracking payments and
              sending WhatsApp reminders, CoachOS brings everything into one
              simple platform.
            </p>
            <p>
              We focus on practical, real-world workflows so coaches can spend
              less time on operations and more time teaching and growing their
              business.
            </p>
          </div>
        </Card>
      </section>

      <section
        className="border-y border-zinc-200 bg-[#F3FAFD]"
        id="contact"
      >
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <Badge>Contact</Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
              Contact Us
            </h2>
          </div>
          <Card className="p-6 sm:p-8">
            <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="text-lg font-semibold text-zinc-950">
                  Nexus Valley Technologies
                </p>
                <address className="mt-4 not-italic leading-8 text-zinc-600">
                  9/443-3, Pari Nagar Extension
                  <br />
                  CAK Road
                  <br />
                  Karur - 639002
                  <br />
                  Tamil Nadu, India
                </address>
                <div className="mt-6">
                  <p className="text-sm font-semibold text-zinc-500">
                    Mobile / WhatsApp
                  </p>
                  <a
                    className="mt-2 inline-block text-lg font-semibold text-[#145DA0] transition hover:text-[#0F4C81]"
                    href="tel:+917338841434"
                  >
                    +91 73388 41434
                  </a>
                </div>
              </div>
              <a
                className="inline-flex h-12 items-center justify-center rounded-full border border-[#145DA0]/20 bg-[#145DA0] px-6 text-base font-semibold text-white shadow-md shadow-[#145DA0]/15 transition hover:-translate-y-0.5 hover:bg-[#0F4C81]"
                href="https://wa.me/917338841434"
                rel="noreferrer"
                target="_blank"
              >
                Chat on WhatsApp
              </a>
            </div>
          </Card>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
