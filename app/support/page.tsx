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
    "Contact CoachFort support for testing, onboarding, login, invites, workspace setup, billing readiness, and payment policy questions.",
};

const supportTopics = [
  {
    description:
      "Public signup is enabled for testing and product exploration. Please set up branded program pages and student access flows carefully before live student operations.",
    title: "Testing and onboarding",
  },
  {
    description:
      "For invite issues, include the invited email, workspace name, role expected, and whether the invite link is expired or unavailable.",
    title: "Team invites and login",
  },
  {
    description:
      "For password reset or OTP issues, never share your OTP. Contact support with the account email and a short description of the issue.",
    title: "Password reset and OTP",
  },
  {
    description:
      "Billing profile setup prepares CoachFort subscription, invoice, receipt, renewal, and payment support readiness. It does not start a payment or change a plan.",
    title: "Billing profile readiness",
  },
  {
    description:
      "CoachFort subscription payment, refund, cancellation, and renewal details should be read with the payment policy. Student program payments remain between the coach and student.",
    title: "Payment support",
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
            Support and contact
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            CoachFort is currently under maintenance and testing. Support is
            focused on account access, workspace setup, billing readiness, and
            payment policy questions while coaches explore the platform.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button href="mailto:support@coachfort.com" size="lg">
              Email support
            </Button>
            <Button href="/payment-policy" size="lg" variant="secondary">
              Payment policy
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-5 py-10 sm:px-6 lg:px-8">
        <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
          <h2 className="text-2xl font-semibold text-[#0B1F33]">
            Contact options
          </h2>
          <div className="mt-4 grid gap-4 text-sm leading-7 text-[#425B76] md:grid-cols-2">
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F7FCFF] p-5">
              <p className="font-semibold text-[#0B1F33]">Support email</p>
              <a
                className="mt-2 inline-flex font-semibold text-[#145DA0] hover:text-[#0F4C81]"
                href="mailto:support@coachfort.com"
              >
                support@coachfort.com
              </a>
            </div>
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F7FCFF] p-5">
              <p className="font-semibold text-[#0B1F33]">
                Onboarding channel
              </p>
              <p className="mt-2">
                If you are already in a CoachFort testing or onboarding
                discussion, use that channel for faster context.
              </p>
            </div>
          </div>
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
            Helpful links
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
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/signup">
              Sign up
            </Link>
          </div>
          <p className="mt-4 text-sm leading-7 text-[#425B76]">
            This support page is provided for product transparency during beta
            and should be reviewed before broad public launch.
          </p>
        </Card>
      </section>
      <MarketingFooter />
    </main>
  );
}
