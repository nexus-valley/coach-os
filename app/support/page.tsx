import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Support | CoachFort",
  description:
    "Contact CoachFort support for account access, onboarding, billing, workspace setup, and platform questions.",
};

const supportTopics = [
  {
    description:
      "Support can help with login, workspace access, onboarding questions, and setup guidance for founder-approved customers.",
    title: "Access And Onboarding",
  },
  {
    description:
      "Support can help workspace owners understand programs, enrollment requests, student access, finance records, live classes, materials, community, and team roles.",
    title: "Workspace Usage",
  },
  {
    description:
      "CoachFort SaaS subscription, payment, refund, cancellation, and renewal questions should be sent to CoachFort support. Student program payments and refunds remain between the coach and student.",
    title: "Billing And Payment Questions",
  },
  {
    description:
      "Privacy, deletion, export, abuse, and acceptable-use questions can be raised through support for review.",
    title: "Privacy And Safety",
  },
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            CoachFort support
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Support And Contact
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            CoachFort support helps with account access, onboarding, workspace
            usage, billing and subscription questions, and policy-related
            requests during soft launch.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button href="mailto:support@coachfort.com" size="lg">
              Email support
            </Button>
            <Button href="/support-policy" size="lg" variant="secondary">
              Support policy
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-5 py-10 sm:px-6 lg:px-8">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
          <h2 className="text-2xl font-semibold text-[#0B1F33]">
            Contact
          </h2>
          <p className="mt-4 text-sm leading-7 text-[#425B76]">
            Email{" "}
            <a
              className="font-semibold text-[#145DA0] hover:text-[#0F4C81]"
              href="mailto:support@coachfort.com"
            >
              support@coachfort.com
            </a>{" "}
            with your workspace name, account email, user role, and a short
            description of the issue.
          </p>
          <p className="mt-4 text-sm leading-7 text-[#425B76]">
            CoachFort aims to respond within 24 business hours. Critical access
            or CoachFort SaaS payment issues are prioritized same business day
            where possible. CoachFort does not provide a guaranteed uptime SLA
            during soft launch.
          </p>
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          {supportTopics.map((topic) => (
            <Card
              className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5"
              key={topic.title}
            >
              <h2 className="text-xl font-semibold text-[#0B1F33]">
                {topic.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#425B76]">
                {topic.description}
              </p>
            </Card>
          ))}
        </div>

        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
          <h2 className="text-2xl font-semibold text-[#0B1F33]">
            Helpful Links
          </h2>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/terms">
              Terms
            </Link>
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
