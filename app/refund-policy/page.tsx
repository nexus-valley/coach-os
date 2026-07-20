import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | CoachFort",
  description:
    "CoachFort refund and cancellation policy for SaaS subscriptions and student payment responsibility separation.",
};

const sections = [
  {
    body: [
      "CoachFort SaaS refund requests are reviewed case by case.",
      "For soft-launch subscriptions, refund review requests should be raised within 7 days of payment.",
      "Duplicate payments, billing errors, or verified payment without successful activation are prioritized for review.",
    ],
    title: "CoachFort SaaS Refunds",
  },
  {
    body: [
      "Monthly or yearly customers can request cancellation or non-renewal by contacting support@coachfort.com before the next renewal date.",
      "Unless CoachFort approves otherwise, access continues until the end of the paid billing period.",
      "Automatic prorated refunds are not provided unless CoachFort approves a specific case.",
    ],
    title: "Monthly And Yearly Cancellation",
  },
  {
    body: [
      "If setup, onboarding, migration, or custom service fees are introduced later, their refund treatment should be confirmed in writing before payment.",
      "CoachFort does not currently publish a separate setup fee as part of the Starter or Growth soft-launch pricing.",
    ],
    title: "Setup Or Onboarding Fees",
  },
  {
    body: [
      "Student program refunds are handled by the coach or coaching business under the coach's own policy.",
      "CoachFort does not currently collect, hold, settle, or refund student program payments.",
    ],
    title: "Student Program Refunds",
  },
  {
    body: [
      "Email support@coachfort.com with your workspace email, selected plan, billing cycle, payment reference if available, and a short description of the refund or cancellation request.",
    ],
    title: "How To Contact Support",
  },
];

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Refunds and cancellation
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Refund & Cancellation Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This policy explains how CoachFort reviews SaaS subscription refund
            and cancellation requests during soft launch.
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
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/payment-policy"
            >
              Payment Policy
            </Link>
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/terms">
              Terms
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
