import type { Metadata } from "next";
import Link from "next/link";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Payment, Refund & Cancellation Policy | CoachFort",
  description:
    "Draft beta payment policy for CoachFort workspace subscriptions and the separation between CoachFort billing and coach-managed student program payments.",
  robots: {
    follow: false,
    index: false,
  },
};

const supportDetails = [
  "Registered coach or workspace email",
  "Selected plan and billing cycle",
  "Order ID, if shown",
  "Razorpay payment ID, if shown",
  "Approximate payment time",
  "Screenshot of the payment status, if available",
];

const neverAskFor = [
  "Card number",
  "CVV",
  "UPI PIN",
  "OTP",
  "Banking password",
  "Razorpay secret keys",
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
      <header className="border-b border-[#D8E8F0] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-6 lg:px-8">
          <Link className="flex shrink-0 items-center gap-3" href="/">
            <CoachFortBrandAsset
              className="h-12 w-44 sm:h-14 sm:w-52"
              variant="fullLogo"
            />
          </Link>
          <Link
            className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#145DA0] transition hover:border-[#9ADDEA] hover:bg-[#F3FAFD]"
            href="/"
          >
            Back to CoachFort
          </Link>
        </div>
      </header>

      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Draft for beta launch
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Payment, Refund & Cancellation Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This draft explains how CoachFort plans to handle workspace
            subscription payments, taxes, receipts, refunds, cancellations,
            renewals, payment verification, and payment support during beta. It
            also separates CoachFort subscription billing from student program
            payments handled directly between coaches and students.
          </p>
          <p className="mt-5 text-sm font-semibold text-[#66788F]">
            Last updated: Draft for beta launch
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-5 py-10 sm:px-6 lg:px-8">
        <PolicySection title="CoachFort Subscription Pricing and Taxes">
          <p>
            Prices shown for CoachFort plans are base subscription fees in INR
            and are exclusive of applicable taxes unless stated otherwise.
            Applicable taxes, if any, should be shown before payment when native
            subscription billing is enabled.
          </p>
          <p>
            Tax and GST handling should be reviewed by CoachFort&apos;s business,
            legal, or tax advisor before public paid launch.
          </p>
        </PolicySection>

        <PolicySection title="Student Program Payments Are Separate">
          <p>
            Student program payments are between the coach or coaching business
            and the student. CoachFort does not collect student program money as
            a marketplace, payment gateway, or instant course purchase platform.
          </p>
          <p>
            CoachFort currently helps coaches track invoices, manual payment
            records, and receipts for their own student program sales. Public
            program requests do not automatically create student accounts,
            collect payments, generate invoices, or activate access.
          </p>
          <p>
            Coaches approve access. If a coach uses an external payment page,
            that page is controlled by the coach or their provider and opens
            outside CoachFort.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort Subscription Payment Processing">
          <p>
            Payments are processed securely through Razorpay when online
            subscription payment is enabled. Native CoachFort subscription
            billing is not active during the current beta preparation stage.
          </p>
          <p>
            Premium is a contact-sales plan for larger coaching businesses and
            custom requirements. It is not available for self-serve subscription
            payment.
          </p>
        </PolicySection>

        <PolicySection title="Subscription Payment Verification and Plan Activation">
          <p>
            Your CoachFort plan activates only after server-side payment
            verification is completed. Browser payment success alone does not
            activate a plan.
          </p>
          <p>
            If Razorpay returns a payment success signal but CoachFort is still
            verifying the payment, please wait for server confirmation before
            retrying or contacting support.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort Subscription Receipts and GST Invoices">
          <p>
            A payment receipt will be available after successful payment
            verification.
          </p>
          <p>
            GST invoice support for CoachFort subscriptions may be handled
            manually during beta and depends on billing details provided by the
            customer. CoachFort should not be treated as offering automated GST
            invoice generation until that workflow is implemented and verified.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort Subscription Refund Policy">
          <p>
            Refund requests are reviewed case by case. For beta subscriptions,
            refund review requests should be raised within 7 days of payment.
          </p>
          <p>
            Duplicate payments, failed activation after a captured payment, or
            billing errors are eligible for priority review.
          </p>
          <p>
            Approved refunds are processed through the payment provider and may
            take additional bank or provider processing time.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort Subscription Cancellation Policy">
          <p>
            During beta, cancellation requests are handled through CoachFort
            support or platform operations. Self-serve cancellation is not
            available yet.
          </p>
          <p>
            Cancellation requests should be raised before the next renewal or
            extension date. Access handling after cancellation will be confirmed
            by support until automated subscription lifecycle management is
            available.
          </p>
        </PolicySection>

        <PolicySection title="CoachFort Subscription Renewal Policy">
          <p>
            During beta, CoachFort paid access may use one-time Razorpay orders
            or manual renewal flows.
          </p>
          <p>
            Automatic recurring renewal will be introduced only after
            subscription lifecycle support is implemented and communicated
            clearly.
          </p>
        </PolicySection>

        <PolicySection title="Failed or Pending Payments">
          <p>
            If payment failed, your CoachFort plan was not changed. You may
            retry later or contact support if money was debited.
          </p>
          <p>
            If payment is pending, please do not retry immediately. If the
            status does not update, contact support with your order or payment
            details.
          </p>
          <p>
            If money was debited or payment appears successful but the plan is
            not active, contact support with order and payment details so
            CoachFort can review the payment and activation status.
          </p>
        </PolicySection>

        <PolicySection title="Payment Support">
          <p>For payment support, please share:</p>
          <ul className="grid gap-2 pl-5 sm:grid-cols-2">
            {supportDetails.map((item) => (
              <li className="list-disc" key={item}>
                {item}
              </li>
            ))}
          </ul>
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

        <PolicySection title="Beta Policy Note">
          <p>
            This policy is a beta launch draft and may be updated before public
            paid launch.
          </p>
          <p>
            This page is informational and should not be treated as final legal
            or tax advice. Tax, GST, refund, cancellation, renewal, and public
            native subscription payment wording should be reviewed by the
            appropriate business, legal, or tax advisor before public launch.
          </p>
        </PolicySection>
      </section>
    </main>
  );
}
