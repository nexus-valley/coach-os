import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getPlanDisplayName,
  getPlanDisplayPrice,
  planOrder,
} from "@/src/lib/plans";

export const metadata: Metadata = {
  title: "Payment, Refund & Cancellation Policy | CoachFort",
  description:
    "CoachFort policy for SaaS subscription payments, manual activation, refunds, cancellation, and student payment separation.",
};

const neverAskFor = [
  "Card number",
  "CVV",
  "UPI PIN",
  "OTP",
  "Banking password",
  "Payment gateway secret keys",
  "CoachFort account password",
];

function PolicySection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Card className="border-[#D8E8F0] bg-white p-6 shadow-sm shadow-[#0B2A3D]/5 sm:p-8">
      <h2 className="text-2xl font-semibold text-[#0B1F33]">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-7 text-[#425B76]">
        {children}
      </div>
    </Card>
  );
}

export default function PaymentPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            CoachFort payments
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Payment, Refund & Cancellation Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This policy explains CoachFort SaaS subscription payments, manual
            activation, refunds, cancellation, taxes, and the separation between
            CoachFort billing and student program payments.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-5 py-10 sm:px-6 lg:px-8">
        <PolicySection title="CoachFort SaaS Subscription Payments">
          <p>
            CoachFort subscription fees are paid by the coach, coaching
            business, or workspace customer for use of the CoachFort platform.
          </p>
          <p>
            During soft launch, CoachFort SaaS subscription payment may be
            handled manually through founder-approved payment instructions.
            Native online checkout is not live unless CoachFort explicitly
            confirms it for that customer.
          </p>
        </PolicySection>

        <PolicySection title="Current Starter And Growth Pricing">
          <ul className="grid gap-2 pl-5">
            {planOrder.map((plan) => (
              <li className="list-disc" key={plan}>
                {getPlanDisplayName(plan)}: {getPlanDisplayPrice(plan, "monthly")}{" "}
                or {getPlanDisplayPrice(plan, "yearly")}.
              </li>
            ))}
          </ul>
          <p>
            Premium remains a custom/contact-sales plan. Premium is available
            only after CoachFort confirms scope, pricing, limits, onboarding,
            and activation terms.
          </p>
        </PolicySection>

        <PolicySection title="Manual Activation During Soft Launch">
          <p>
            A CoachFort SaaS subscription may require founder or CoachFort team
            verification after payment. Browser success screens, screenshots,
            or external payment confirmations do not by themselves activate a
            subscription.
          </p>
          <p>
            CoachFort will confirm activation status through support or the
            agreed onboarding channel.
          </p>
        </PolicySection>

        <PolicySection title="Student Program Payments Are Separate">
          <p>
            Student program payments are between the coach or coaching business
            and the student. CoachFort does not currently collect, hold, settle,
            or refund student program payments.
          </p>
          <p>
            CoachFort helps coaches track invoices, manual payment records,
            receipts, balances, and access decisions for their own student
            program sales. Coaches remain responsible for their own payment
            instructions, refund promises, and student communication.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort SaaS Refund Policy">
          <p>
            CoachFort SaaS refund requests are reviewed case by case. For soft
            launch subscriptions, refund review requests should be raised within
            7 days of payment.
          </p>
          <p>
            Duplicate payments, billing errors, or verified payment without
            successful activation are prioritized for review.
          </p>
          <p>
            Approved refunds may be processed manually or through the relevant
            payment method, depending on how the original payment was collected.
          </p>
        </PolicySection>

        <PolicySection title="Cancellation Policy">
          <p>
            Customers can request cancellation or non-renewal by contacting
            support@coachfort.com before the next renewal date.
          </p>
          <p>
            Unless CoachFort approves otherwise, access continues until the end
            of the paid billing period and automatic prorated refunds are not
            provided.
          </p>
        </PolicySection>

        <PolicySection title="Taxes, Invoices, And Receipts">
          <p>
            Prices are base subscription fees and may be exclusive of applicable
            taxes unless CoachFort states otherwise for a specific customer.
          </p>
          <p>
            GST, tax invoice, and receipt handling may be manual during soft
            launch. CoachFort should not be treated as offering automated GST
            invoice generation until that workflow is implemented and verified.
          </p>
        </PolicySection>

        <PolicySection title="Payment Support">
          <p>
            For CoachFort SaaS billing, subscription, refund, or cancellation
            questions, email support@coachfort.com with your workspace email,
            selected plan, billing cycle, payment method, payment reference if
            available, and a short description of the issue.
          </p>
        </PolicySection>

        <PolicySection title="Information CoachFort Will Never Ask For">
          <p>
            CoachFort support will never ask for sensitive payment credentials
            or account secrets. Do not share:
          </p>
          <ul className="grid gap-2 pl-5 sm:grid-cols-2">
            {neverAskFor.map((item) => (
              <li className="list-disc" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </PolicySection>

        <PolicySection title="Related Policies">
          <div className="flex flex-wrap gap-3 font-semibold">
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/terms">
              Terms
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/refund-policy"
            >
              Refund Policy
            </Link>
            <Link
              className="text-[#145DA0] hover:text-[#0F4C81]"
              href="/support-policy"
            >
              Support Policy
            </Link>
          </div>
          <p>
            This page is founder-approved soft-launch wording and should still
            be reviewed by legal, tax, or business advisors before broad public
            paid launch.
          </p>
        </PolicySection>
      </section>
      <MarketingFooter />
    </main>
  );
}
