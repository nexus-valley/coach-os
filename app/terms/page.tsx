import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Terms of Service | CoachFort",
  description:
    "CoachFort soft-launch terms for coaching workspaces, student data, subscriptions, acceptable use, and payment responsibility.",
};

const sections = [
  {
    body: [
      "CoachFort is a white-label online coaching platform for coaches, trainers, mentors, course creators, and coaching businesses.",
      "CoachFort is operated by Nexus Valley / founder-owned business entity. The final registered legal entity name may be updated later.",
      "These terms are practical soft-launch terms for founder-approved customers and are not final legal advice.",
    ],
    title: "Introduction",
  },
  {
    body: [
      "CoachFort is designed for branded program pages, enrollment requests, student access, live classes, materials, community, announcements, finance records, invoices, receipts, reports, and workspace operations.",
      "CoachFort is not positioned as a school ERP, marketplace, escrow provider, payment aggregator, or legal, tax, or accounting advisor.",
    ],
    title: "Who CoachFort Is For",
  },
  {
    body: [
      "Workspace owners are responsible for inviting the right team members, assigning roles, protecting account credentials, and removing access when users no longer need it.",
      "Do not share passwords, OTPs, invite links, or privileged account access with people who should not access your workspace.",
    ],
    title: "Account And Workspace Responsibility",
  },
  {
    body: [
      "Coaches are responsible for their own programs, materials, live sessions, community posts, announcements, messages, student communication, pricing, refund promises, and business decisions.",
      "CoachFort provides software tools and does not verify, endorse, or guarantee coach-created content or student outcomes.",
    ],
    title: "Coach Content And Communication Responsibility",
  },
  {
    body: [
      "Coaches and workspace owners are responsible for having permission to add, process, and communicate with students or other people whose information is stored in CoachFort.",
      "CoachFort provides tenant-scoped software, access controls, and operational tooling; each workspace owner remains responsible for the accuracy and lawful use of the data they add.",
    ],
    title: "Student Data Responsibility",
  },
  {
    body: [
      "CoachFort must not be used for unlawful content, spam, deceptive activity, unauthorized access, credential sharing, security bypassing, misuse of student information, or activity that interferes with platform reliability.",
      "See the Acceptable Use Policy for more detail.",
    ],
    link: { href: "/acceptable-use", label: "Acceptable Use Policy" },
    title: "Acceptable Use Summary",
  },
  {
    body: [
      "CoachFort SaaS subscription fees are paid by the coach, coaching business, or workspace customer for use of the CoachFort platform.",
      "During soft launch, subscription payment and activation may be handled manually by the CoachFort founder or team after payment verification.",
      "Automatic checkout or browser-based payment success does not activate a subscription unless CoachFort explicitly confirms that workflow for that customer.",
    ],
    title: "CoachFort SaaS Subscription Terms",
  },
  {
    body: [
      "Student program payments are between the coach or coaching business and the student.",
      "CoachFort does not currently collect, hold, settle, or refund student program payments. Coaches are responsible for their own student payment instructions, receipts, refund promises, and access decisions.",
    ],
    title: "Student Payment Separation",
  },
  {
    body: [
      "CoachFort aims to keep the platform reliable, but there is no guaranteed uptime SLA during soft launch.",
      "Support targets and support coverage are described in the Support Policy.",
    ],
    link: { href: "/support-policy", label: "Support Policy" },
    title: "Service Availability",
  },
  {
    body: [
      "Workspace owners may delete or archive certain workspace data through the platform where supported.",
      "Some records may be retained for billing, audit, security, legal, backup, dispute-resolution, fraud-prevention, abuse-prevention, and operational reasons.",
    ],
    title: "Data Deletion And Export Requests",
  },
  {
    body: [
      "CoachFort operates from India and may be available to customers across countries where permitted.",
      "International use may require additional review, customer-specific terms, tax handling, or privacy/data processing documentation. CoachFort does not claim full global legal, tax, or privacy compliance for every jurisdiction.",
    ],
    title: "International Availability",
  },
  {
    body: ["For support or policy questions, contact support@coachfort.com."],
    title: "Contact",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            CoachFort terms
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            These soft-launch terms explain the responsibilities for using
            CoachFort as a coaching workspace. They are founder-approved product
            terms and should still be reviewed by legal counsel before broad
            public paid launch.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-5 py-10 sm:px-6 lg:px-8">
        {sections.map((section) => (
          <Card
            className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8"
            key={section.title}
          >
            <h2 className="text-2xl font-semibold text-[#0B1F33]">
              {section.title}
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-[#425B76]">
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {"link" in section && section.link ? (
                <Link
                  className="inline-flex font-semibold text-[#145DA0] hover:text-[#0F4C81]"
                  href={section.link.href}
                >
                  Read the {section.link.label}
                </Link>
              ) : null}
            </div>
          </Card>
        ))}

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
          <h2 className="text-2xl font-semibold text-[#0B1F33]">
            Related Policies
          </h2>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/privacy">
              Privacy
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/payment-policy"
            >
              Payment Policy
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/refund-policy"
            >
              Refund Policy
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/acceptable-use"
            >
              Acceptable Use
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/support-policy"
            >
              Support Policy
            </Link>
          </div>
        </Card>
      </section>
      <MarketingFooter />
    </main>
  );
}
