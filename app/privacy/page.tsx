import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Privacy | CoachFort",
  description:
    "Draft CoachFort privacy overview for coaching workspace data, student records, authentication, support, billing readiness, processors, and deletion requests.",
};

const sections = [
  {
    body: [
      "CoachFort may process coaching workspace details, team user accounts, student records, programs, live sessions, assignments, documents, messages, announcements, community posts, billing profile details, technical logs, and support context.",
      "The exact data depends on what each coach or coaching business adds to its workspace and which modules it chooses to use.",
    ],
    title: "Information processed in CoachFort",
  },
  {
    body: [
      "CoachFort uses this information to provide the platform, authenticate users, support student portal access, secure tenant workspaces, operate coaching workflows, prepare billing readiness, and help with support requests.",
      "CoachFort does not sell coach, workspace, or student data.",
    ],
    title: "How information is used",
  },
  {
    body: [
      "Student data is controlled by the coach, coaching business, or customer that adds it to CoachFort. Workspace owners should only add student information they are allowed to process and should respond to student or guardian requests according to their own policies and applicable obligations.",
      "CoachFort provides the software workspace and access controls, while each coaching business remains responsible for the accuracy and appropriateness of the student information it stores.",
    ],
    title: "Student data responsibility",
  },
  {
    body: [
      "CoachFort may use service providers for hosting, database services, authentication, email delivery, monitoring, storage, and payment processing when payment features are enabled.",
      "Data may be processed through these providers for platform delivery, security, reliability, support, and future billing operations.",
    ],
    title: "Service providers and international processing",
  },
  {
    body: [
      "CoachFort uses tenant-scoped access controls, authentication, role-based UI, and security-focused backend patterns to protect workspace information.",
      "No system can guarantee absolute security, so workspace owners should use strong passwords, protect OTPs and invite links, and remove access for users who no longer need it.",
    ],
    title: "Security",
  },
  {
    body: [
      "CoachFort sends transactional emails such as OTP verification and may send invitation emails when configured. These are operational emails, not marketing campaigns.",
      "Do not share OTPs, passwords, invite links, or payment secrets with anyone who should not access your account or workspace.",
    ],
    title: "Email and invitations",
  },
  {
    body: [
      "Coaches and workspace owners may request support for account, workspace, billing readiness, or data deletion questions through CoachFort support.",
      "Retention and deletion workflows should be reviewed before broad public launch, especially for legal, tax, audit, student, and payment-related records.",
    ],
    title: "Retention and deletion requests",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Draft privacy overview
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Privacy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This draft privacy page explains how CoachFort expects to handle
            workspace, student, billing readiness, support, and technical data
            during controlled beta. It should be reviewed before broad public
            launch.
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
            Privacy contact
          </h2>
          <p className="mt-4 text-sm leading-7 text-[#425B76]">
            For privacy or deletion questions, contact CoachFort support from
            your onboarding channel or email{" "}
            <a
              className="font-semibold text-[#145DA0] hover:text-[#0F4C81]"
              href="mailto:support@coachfort.com"
            >
              support@coachfort.com
            </a>
            .
          </p>
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
