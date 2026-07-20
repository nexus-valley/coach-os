import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Support Policy | CoachFort",
  description:
    "CoachFort support policy for channels, response targets, support scope, critical issues, and soft-launch SLA boundaries.",
};

const sections = [
  {
    body: [
      "CoachFort support is available at support@coachfort.com.",
      "Customers should include the workspace name, account email, user role, affected route or workflow, and a short description of the issue.",
    ],
    title: "Support Channels",
  },
  {
    body: [
      "CoachFort aims to respond within 24 business hours.",
      "Critical access or CoachFort SaaS payment issues are prioritized same business day where possible.",
      "These are support targets, not a guaranteed uptime or resolution SLA.",
    ],
    title: "Response Targets",
  },
  {
    body: [
      "Support covers account access, onboarding, workspace setup, subscription and billing questions, platform usage, policy questions, and suspected product bugs.",
      "Founder-led onboarding and support may be used for early soft-launch customers.",
    ],
    title: "What Support Covers",
  },
  {
    body: [
      "CoachFort support does not provide legal, tax, accounting, or business advice.",
      "CoachFort does not handle student program refunds, content disputes, or coach-student commercial disputes unless separately agreed in writing.",
      "Coaches remain responsible for their own student communication, programs, pricing, refunds, and content.",
    ],
    title: "What Support Does Not Cover",
  },
  {
    body: [
      "CoachFort does not provide a guaranteed uptime SLA during soft launch.",
      "If a formal SLA is introduced later, it should be documented separately and confirmed for the relevant plan or customer agreement.",
    ],
    title: "No Guaranteed Uptime SLA During Soft Launch",
  },
  {
    body: [
      "Student refund requests, program content disputes, student access expectations, and coach-student payment questions are handled by the coach or coaching business.",
      "CoachFort can provide platform support for the software workflow, but it does not currently collect, hold, settle, or refund student program payments.",
    ],
    title: "Student Refund And Content Disputes",
  },
];

export default function SupportPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Support policy
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Support Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This policy explains CoachFort support channels, response targets,
            support scope, and soft-launch service boundaries.
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
            </div>
          </Card>
        ))}

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
          <h2 className="text-2xl font-semibold text-[#0B1F33]">
            Related Policies
          </h2>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/support">
              Contact Support
            </Link>
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/terms">
              Terms
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/payment-policy"
            >
              Payment Policy
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/acceptable-use"
            >
              Acceptable Use
            </Link>
          </div>
        </Card>
      </section>
      <MarketingFooter />
    </main>
  );
}
