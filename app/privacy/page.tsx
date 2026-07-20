import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Privacy Policy | CoachFort",
  description:
    "CoachFort privacy policy for coaching workspace data, student data, subscription records, service providers, security, and retention.",
};

const sections = [
  {
    body: [
      "CoachFort may process account details, workspace settings, team user records, student records, programs, sessions, materials, assignments, certificates, messages, announcements, community posts, finance records, subscription details, technical logs, and support context.",
      "The exact information depends on what each coach or coaching business adds to its workspace and which modules it uses.",
    ],
    title: "Information CoachFort May Process",
  },
  {
    body: [
      "Workspace data can include branding details, program pages, enrollment requests, team roles, settings, invoices, receipts, manual payment records, reports, and operational activity.",
      "Workspace owners are responsible for the accuracy, permissions, and business use of the information they add.",
    ],
    title: "Coach And Workspace Data",
  },
  {
    body: [
      "Student data is entered or managed by coaches, coaching businesses, or their teams.",
      "Coaches are responsible for having permission to collect, upload, store, communicate with, and manage student information through CoachFort.",
      "CoachFort provides software and access controls; it does not independently verify student records or coach-student agreements.",
    ],
    title: "Student Data Entered By Workspaces",
  },
  {
    body: [
      "CoachFort may process records related to CoachFort SaaS subscriptions, billing status, payment verification, renewal tracking, support requests, and invoice or receipt readiness.",
      "Student program payments are separate. CoachFort does not currently collect, hold, settle, or refund student program payments.",
    ],
    title: "Payment And Subscription Records",
  },
  {
    body: [
      "CoachFort may use service providers for hosting, database services, authentication, storage, email delivery, monitoring, security, support, and payment processing if a payment workflow is enabled for a specific customer.",
      "These providers may process data for platform delivery, reliability, security, support, and operations.",
    ],
    title: "Service Providers",
  },
  {
    body: [
      "CoachFort uses tenant-scoped access patterns, authentication, role-based controls, and security-focused backend checks to protect workspace data.",
      "No system can guarantee absolute security. Users should protect passwords, OTPs, invite links, payment references, and privileged account access.",
    ],
    title: "Security And Access Controls",
  },
  {
    body: [
      "Workspace owners may delete or archive certain workspace data through the platform where supported.",
      "Some records may be retained for billing, audit, security, legal, backup, dispute-resolution, fraud-prevention, abuse-prevention, and operational reasons.",
      "Deletion and export requests can be raised through CoachFort support.",
    ],
    title: "Data Retention, Deletion, And Export",
  },
  {
    body: [
      "CoachFort operates from India and may be used by customers in other countries where permitted.",
      "International use may require additional review, customer-specific terms, or data processing documentation. CoachFort does not claim full legal, tax, or privacy compliance for every jurisdiction.",
    ],
    title: "International Users",
  },
  {
    body: [
      "CoachFort may use necessary cookies, authentication storage, analytics, monitoring, and security logs to operate and improve the platform.",
      "A separate Cookie Policy can be added later if CoachFort introduces advanced advertising, retargeting, or broader tracking tools.",
    ],
    title: "Cookies, Analytics, And Security Logs",
  },
  {
    body: ["For privacy, deletion, or export questions, contact support@coachfort.com."],
    title: "Contact",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            CoachFort privacy
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This policy explains how CoachFort expects to handle workspace,
            student, subscription, support, technical, and operational data
            during soft launch. It should still be reviewed by legal counsel
            before broad public paid launch.
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
