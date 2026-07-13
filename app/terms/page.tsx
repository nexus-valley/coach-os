import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Terms of Use | CoachFort",
  description:
    "Draft CoachFort terms for controlled beta use, academy responsibilities, acceptable use, service availability, and payment policy references.",
};

const sections = [
  {
    body: [
      "CoachFort is currently under maintenance and testing. Users may explore the platform, but should not use it for live academy operations yet.",
      "These terms are provided for product transparency and should be reviewed before broad public launch. They are not a substitute for legal advice.",
    ],
    title: "Testing status",
  },
  {
    body: [
      "Academies are responsible for the student records, course content, documents, messages, announcements, community posts, billing details, and user access they add to CoachFort.",
      "Each academy should make sure it has the right permission to upload, process, and share information about its students, team members, and customers.",
    ],
    title: "Academy responsibility",
  },
  {
    body: [
      "Workspace owners and admins are responsible for inviting the right users, assigning appropriate roles, protecting account credentials, and removing access when team members leave.",
      "Do not share passwords, OTPs, invite links, or privileged account access with people who should not access your workspace.",
    ],
    title: "Accounts and security",
  },
  {
    body: [
      "CoachFort must not be used to upload unlawful content, send spam, attempt unauthorized access, bypass tenant isolation, misuse student information, or interfere with platform reliability.",
      "Community, messaging, announcement, and document features should be used for academy operations and student support, not public social networking or bulk marketing unless a future reviewed module enables that capability.",
    ],
    title: "Acceptable use",
  },
  {
    body: [
      "Features may change during beta as CoachFort improves the product, strengthens safety checks, and prepares billing and payment readiness.",
      "Online checkout and payment gateway activation are not promised by these terms. Payment-related details are handled separately in the payment policy.",
    ],
    title: "Service changes and availability",
  },
  {
    body: [
      "Subscription, refund, cancellation, renewal, tax, and checkout information should be read together with the CoachFort payment policy.",
      "Public checkout is not active until CoachFort completes the required payment-provider setup, testing, and review.",
    ],
    title: "Subscriptions and payments",
  },
  {
    body: [
      "CoachFort is provided during controlled beta on a practical best-effort basis. The platform is designed to support academy operations, but each academy remains responsible for its business decisions, student communication, financial records, and compliance obligations.",
      "Any final limitation of liability, warranty, jurisdiction, or dispute language should be reviewed before broad public launch.",
    ],
    title: "Practical disclaimer",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Draft beta terms
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Terms of Use
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            These draft terms explain the expected responsibilities for
            controlled beta use of CoachFort. This page is provided for product
            transparency and should be reviewed before broad public launch.
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
            Related pages
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
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/support">
              Support
            </Link>
          </div>
        </Card>
      </section>
      <MarketingFooter />
    </main>
  );
}
