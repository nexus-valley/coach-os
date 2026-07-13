import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { EarlyAccessNotice } from "@/src/components/marketing/EarlyAccessNotice";
import { Fragment } from "react";

const valuePills = [
  "Student CRM",
  "Course Delivery",
  "Cohorts & Batches",
  "Certificates",
  "Manual Follow-ups",
  "Manual Payments",
  "Analytics",
  "Admin Controls",
];

const features = [
  {
    bullets: ["Structured sections", "Lesson resources", "Progress tracking"],
    description:
      "Create structured courses with sections, lessons, video/resource links, and learner progress tracking.",
    icon: "CB",
    title: "Course Builder",
  },
  {
    bullets: ["Batch dates", "Member lists", "Course linkage"],
    description:
      "Organize students into batches, connect cohorts to courses, and track members with start and end dates.",
    icon: "LC",
    title: "Cohorts & Batches",
  },
  {
    bullets: ["Contact records", "Notes", "Follow-ups"],
    description:
      "Manage student profiles, contact details, notes, enrollments, payments, and follow-ups in one place.",
    icon: "CRM",
    title: "Student CRM",
  },
  {
    bullets: ["Invoices", "Receipts", "Status tracking"],
    description:
      "Manage fee plans, invoices, manual payment records, receipts, and due status in Finance Center.",
    icon: "PY",
    title: "Manual Payments",
  },
  {
    bullets: ["Templates", "Reminders", "Manual sharing"],
    description:
      "Prepare reminders, receipts, and certificates for manual sharing and follow-up workflows across your preferred channels.",
    icon: "WA",
    title: "Manual Follow-up Workflows",
  },
  {
    bullets: ["Engagement base", "Learner touchpoints", "Future-ready"],
    description:
      "Build engagement around your coaching programs with future-ready community and learner interaction workflows.",
    icon: "CM",
    title: "Community",
  },
  {
    bullets: ["Revenue reports", "CSV exports", "Course performance"],
    description:
      "View revenue, students, enrollments, course performance, payment activity, and export reports for business decisions.",
    icon: "AN",
    title: "Analytics",
  },
  {
    bullets: ["Roles", "Branding", "Workspace controls"],
    description:
      "Manage workspace branding, roles, permissions, subscription plans, and secure team access.",
    icon: "AD",
    title: "Admin Controls",
  },
];

const comparisonRows = [
  ["Student records", "Spreadsheets and scattered notes", "Unified CRM with profile, payments, courses, and follow-ups"],
  ["Course delivery", "Content spread across drives and chat apps", "Structured courses, sections, lessons, and portal previews"],
  ["Payments", "Manual tracking and hard-to-find receipts", "Finance Center invoices, manual payments, receipts, and reports"],
  ["Operations", "Multiple tools with no shared context", "One workspace for team, branding, reminders, analytics, and workflows"],
];

const faqs = [
  {
    answer:
      "CoachFort is a coaching business platform for managing students, courses, cohorts, payments, certificates, reminders, reports, and daily operations from one workspace.",
    question: "What is CoachFort?",
  },
  {
    answer:
      "Yes. The live demo is free to explore and is designed to show the product flow with sample workspace data.",
    question: "Is the demo free?",
  },
  {
    answer:
      "Yes. Workspaces can configure branding details such as name, logo URL, brand color, website, and support contact information.",
    question: "Can I use my own branding?",
  },
  {
    answer:
      "CoachFort includes manual sharing flows and automation rule foundations. It does not send WhatsApp, SMS, or bulk email broadcasts automatically yet.",
    question: "Does it send automated messages?",
  },
  {
    answer:
      "Yes. CoachFort includes owner, admin, and staff role foundations so coaching teams can work from the same workspace.",
    question: "Can multiple staff members use the platform?",
  },
  {
    answer:
      "Yes. The dashboard, management pages, and marketing pages are designed to work across desktop, tablet, and mobile screens.",
    question: "Is CoachFort mobile friendly?",
  },
  {
    answer:
      "No. CoachFort is built around practical workflows so coaches and academy teams can manage operations without technical setup.",
    question: "Do I need technical knowledge?",
  },
];

function HeroVisual() {
  return (
    <div className="relative mx-auto max-w-xl lg:max-w-none">
      <div className="absolute -left-6 top-12 h-36 w-36 rounded-full bg-[#2ECBEA]/20 blur-3xl" />
      <div className="absolute -right-4 bottom-12 h-44 w-44 rounded-full bg-[#D9A32F]/20 blur-3xl" />
      <Card className="coachos-float relative overflow-hidden p-4 shadow-2xl shadow-[#0B2A3D]/20 sm:p-5">
        <div className="rounded-[1.5rem] border border-[#D8E8F0] bg-[linear-gradient(135deg,#FFFFFF_0%,#F3FAFD_58%,#EAF8FC_100%)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4 border-b border-[#D8E8F0] pb-5">
            <div>
              <p className="text-sm font-semibold text-[#0B2A3D]">
                CoachFort command center
              </p>
              <p className="mt-1 text-xs font-medium text-[#66788F]">
                Early-access operating snapshot
              </p>
            </div>
            <span className="rounded-full border border-[#9ADDEA] bg-[#EAF8FC] px-3 py-1 text-xs font-semibold text-[#0B6F87]">
              Demo ready
            </span>
          </div>

          <div className="grid gap-3 py-5 sm:grid-cols-3">
            {[
              ["Students", "2,480", "+18%"],
              ["Fee records", "840K", "Sample total"],
              ["Completion", "91%", "On track"],
            ].map(([label, value, note]) => (
              <div
                className="rounded-2xl border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5 transition hover:-translate-y-1"
                key={label}
              >
                <p className="text-xs font-semibold text-[#66788F]">{label}</p>
                <p className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                  {value}
                </p>
                <p className="mt-1 text-xs font-medium text-[#145DA0]">
                  {note}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Course progress
                </p>
                <span className="text-xs font-semibold text-[#145DA0]">
                  76%
                </span>
              </div>
              <div className="mt-4 h-3 rounded-full bg-[#E5EEF4]">
                <div className="h-3 w-3/4 rounded-full bg-[linear-gradient(90deg,#145DA0,#2ECBEA)]" />
              </div>
              <div className="mt-4 space-y-2">
                {["Stock Market Basics", "Digital Marketing Masterclass"].map(
                  (course) => (
                    <div
                      className="flex items-center justify-between rounded-xl bg-[#F6FBFE] px-3 py-2 text-xs"
                      key={course}
                    >
                      <span className="font-medium text-[#425B76]">
                        {course}
                      </span>
                      <span className="font-semibold text-[#0B2A3D]">
                        Active
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5">
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Manual follow-ups
                </p>
                <p className="mt-2 text-xs leading-5 text-[#66788F]">
                  Payment follow-up and completion reminders are prepared for
                  manual sharing through your preferred support channel.
                </p>
              </div>
              <div className="rounded-2xl border border-[#D8E8F0] bg-white p-4 shadow-sm shadow-[#0B2A3D]/5">
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Cohort activity
                </p>
                <div className="mt-3 space-y-2 text-xs text-[#425B76]">
                  <p>Weekend Batch added 8 students</p>
                  <p>Evening Batch has 2 pending payments</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="absolute -bottom-7 left-4 hidden rounded-2xl border border-[#D8E8F0] bg-white/90 p-4 shadow-xl shadow-[#0B2A3D]/15 backdrop-blur md:block">
        <p className="text-xs font-semibold text-[#66788F]">Receipt status</p>
        <p className="mt-1 text-lg font-semibold text-[#0B1F33]">
          42 generated
        </p>
      </div>
      <div className="absolute -right-2 top-20 hidden rounded-2xl border border-[#F5D48C] bg-[#FFF8E7]/95 p-4 shadow-xl shadow-[#D9A32F]/15 backdrop-blur md:block">
        <p className="text-xs font-semibold text-[#9A6A00]">Certificates</p>
        <p className="mt-1 text-lg font-semibold text-[#0B1F33]">
          Auto-ready
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <EarlyAccessNotice />

      <section className="relative overflow-hidden border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_42%,#EAF8FC_100%)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(46,203,234,0.18),transparent_32rem),radial-gradient(circle_at_90%_20%,rgba(217,163,47,0.16),transparent_28rem)]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-12 px-5 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-20">
          <div className="max-w-3xl">
            <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
              Premium coaching business platform
            </Badge>
            <h1 className="mt-7 max-w-4xl text-4xl font-semibold leading-[1.04] tracking-normal text-[#0B1F33] sm:text-6xl lg:text-7xl">
              Run Your Coaching Business from One Powerful Platform
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#425B76] sm:text-xl">
              Manage students, courses, cohorts, payments, certificates,
              follow-up workflows, analytics, and operations from a single
              premium workspace for India and overseas academies.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button href="/signup" size="lg">
                Early access signup
              </Button>
              <Button href="/demo" size="lg" variant="secondary">
                Try Live Demo
              </Button>
              <a
                className="inline-flex h-12 items-center justify-center rounded-full px-2 text-sm font-semibold text-[#145DA0] transition hover:text-[#0F4C81] sm:px-4"
                href="/login"
              >
                Already have an account? Login
              </a>
            </div>
            <p className="mt-5 text-sm font-medium text-[#66788F]">
              Controlled early access &bull; Invite-based onboarding &bull;
              Demo workspace ready
            </p>
          </div>

          <HeroVisual />
        </div>
      </section>

      <section className="border-b border-[#D8E8F0] bg-white/80 px-5 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-3">
          {valuePills.map((item) => (
            <span
              className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5"
              key={item}
            >
              <span className="mr-2 text-[#14B8C6]">&#10003;</span>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section
        className="mx-auto grid max-w-7xl gap-6 px-5 py-20 sm:px-6 lg:grid-cols-3 lg:px-8"
        id="why-coachfort"
      >
        <div className="lg:col-span-1">
          <Badge>Why CoachFort</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Why Coaches Choose CoachFort
          </h2>
          <p className="mt-4 leading-7 text-[#425B76]">
            CoachFort is designed around the daily operating rhythm of online
            coaches and academies in India and overseas, not generic project
            management.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {[
            ["Everything in one platform", "CRM, courses, payments, certificates, reports, reminders, and admin workflows stay connected."],
            ["Built for coaching businesses", "Cohorts, student profiles, course access, and receipts match real coaching operations."],
            ["Channel-ready follow-ups", "Prepare reminders, receipts, and certificates for manual sharing through your preferred support channel."],
            ["Premium operations dashboard", "Track revenue, enrollments, student growth, payment status, and workspace progress clearly."],
          ].map(([title, text]) => (
            <Card className="group p-6 transition hover:-translate-y-1" key={title}>
              <span className="mb-5 block h-1.5 w-12 rounded-full bg-[linear-gradient(90deg,#145DA0,#2ECBEA)]" />
              <h3 className="text-lg font-semibold text-[#0B1F33]">
                {title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#425B76]">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-[#0B2A3D] text-white" id="platform">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <Badge className="border-white/20 bg-white/10 text-white">
              Platform
            </Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal sm:text-4xl">
              Traditional Tools vs CoachFort
            </h2>
            <p className="mt-4 leading-7 text-cyan-50/75">
              Replace operational patchwork with a focused workspace built for
              student delivery, payments, follow-ups, and team control.
            </p>
          </div>
          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/8 shadow-2xl shadow-black/20">
            <div className="grid min-w-[760px] grid-cols-[0.75fr_1fr_1.2fr] gap-px bg-white/10 text-sm">
              <div className="bg-[#0B2A3D] p-4 font-semibold">Workflow</div>
              <div className="bg-[#0B2A3D] p-4 font-semibold">
                Traditional Tools
              </div>
              <div className="bg-[#0B2A3D] p-4 font-semibold text-[#8BE8F6]">
                CoachFort
              </div>
              {comparisonRows.map(([workflow, oldWay, coachfort]) => (
                <Fragment key={workflow}>
                  <div className="bg-white/6 p-4 font-semibold">
                    {workflow}
                  </div>
                  <div className="bg-white/6 p-4 text-cyan-50/70">
                    {oldWay}
                  </div>
                  <div className="bg-white/6 p-4 text-cyan-50">
                    {coachfort}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8"
        id="features"
      >
        <div className="max-w-2xl">
          <Badge>Features</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            A complete operating layer for serious coaching teams.
          </h2>
          <p className="mt-4 leading-7 text-[#425B76]">
            Each module is built to reduce operational friction and make the
            business easier to run as it grows.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card
              className="group min-h-72 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#0B2A3D]/15"
              key={feature.title}
            >
              <div className="flex h-full flex-col">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#145DA0,#2ECBEA)] text-xs font-bold text-white shadow-lg shadow-[#145DA0]/20">
                  {feature.icon}
                </span>
                <h3 className="mt-7 text-lg font-semibold text-[#0B1F33]">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#425B76]">
                  {feature.description}
                </p>
                <div className="mt-auto space-y-2 pt-5">
                  {feature.bullets.map((bullet) => (
                    <p
                      className="flex items-center gap-2 text-xs font-semibold text-[#66788F]"
                      key={bullet}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[#14B8C6]" />
                      {bullet}
                    </p>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-[#D8E8F0] bg-[linear-gradient(135deg,#FFFFFF,#EAF8FC)] p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-10 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
          <div>
            <Badge>Live Demo</Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
              Experience the Platform Live
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-[#425B76]">
              Explore a fully interactive demo workspace with sample students,
              payments, courses, reminders, and reports.
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:mt-0">
            <Button href="/demo" size="lg">
              Try Demo
            </Button>
            <Button href="/support" size="lg" variant="secondary">
              Contact Us
            </Button>
          </div>
        </div>
      </section>

      <section
        className="mx-auto grid max-w-7xl gap-8 px-5 pb-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8"
        id="about"
      >
        <div>
          <Badge>About Us</Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            About CoachFort
          </h2>
        </div>
        <Card className="p-6 sm:p-8">
          <div className="space-y-5 text-base leading-8 text-[#425B76]">
            <p>
              CoachFort is built by Nexus Valley to help coaches, trainers, and
              small academies run their business without complexity.
            </p>
            <p>
              From managing students and courses to tracking payments and
              preparing follow-up workflows, CoachFort brings everything into
              one simple platform.
            </p>
            <p>
              We focus on practical, real-world workflows so coaches can spend
              less time on operations and more time teaching and growing their
              business.
            </p>
          </div>
        </Card>
      </section>

      <section className="border-y border-[#D8E8F0] bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <Badge>FAQ</Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
              Questions before you explore?
            </h2>
            <p className="mt-4 leading-7 text-[#425B76]">
              CoachFort is designed to feel familiar for non-technical teams while
              still being structured enough for serious operations.
            </p>
          </div>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <details
                className="group rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-5 shadow-sm shadow-[#0B2A3D]/5"
                key={faq.question}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-[#0B1F33]">
                  {faq.question}
                  <span className="text-xl text-[#145DA0] transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-4 leading-7 text-[#425B76]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section
        className="border-b border-[#D8E8F0] bg-[#F3FAFD]"
        id="contact"
      >
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <Badge>Contact</Badge>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
              Contact Us
            </h2>
          </div>
          <Card className="p-6 sm:p-8">
            <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="text-lg font-semibold text-[#0B1F33]">
                  Nexus Valley Technologies
                </p>
                <address className="mt-4 not-italic leading-8 text-[#425B76]">
                  9/443-3 Pari Nagar Extension
                  <br />
                  CAK Road
                  <br />
                  Karur, Tamil Nadu 639002
                  <br />
                  India
                </address>
                <div className="mt-6">
                  <p className="text-sm font-semibold text-[#66788F]">
                    Support email
                  </p>
                  <a
                    className="mt-2 inline-block text-lg font-semibold text-[#145DA0] transition hover:text-[#0F4C81]"
                    href="mailto:support@coachfort.com"
                  >
                    support@coachfort.com
                  </a>
                </div>
                <div className="mt-6">
                  <p className="text-sm font-semibold text-[#66788F]">
                    Mobile / WhatsApp
                  </p>
                  <a
                    className="mt-2 inline-block text-lg font-semibold text-[#145DA0] transition hover:text-[#0F4C81]"
                    href="tel:+917338841434"
                  >
                    +91 7338841434
                  </a>
                </div>
              </div>
              <Button href="/support" size="lg">
                Get Support
              </Button>
            </div>
          </Card>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#0B2A3D,#145DA0)] p-8 text-white shadow-2xl shadow-[#0B2A3D]/20 sm:p-10 lg:p-12">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                Ready to Modernize Your Coaching Business?
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-cyan-50/80">
                Start with the live demo and experience how CoachFort simplifies
                coaching operations.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="border-white bg-white text-[#0B2A3D] hover:bg-[#EAF8FC]"
                href="/demo"
                size="lg"
              >
                Try Live Demo
              </Button>
              <Button
                className="border-white/25 bg-white/10 text-white hover:bg-white/15"
                href="/support"
                size="lg"
                variant="secondary"
              >
                Contact Support
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
