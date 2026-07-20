import type { Metadata } from "next";
import Link from "next/link";

import { MarketingFooter } from "@/src/components/layout/MarketingFooter";
import { MarketingHeader } from "@/src/components/layout/MarketingHeader";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Acceptable Use Policy | CoachFort",
  description:
    "CoachFort acceptable use policy for lawful platform use, student data protection, security, and coach content responsibility.",
};

const sections = [
  {
    body: [
      "CoachFort must be used only for lawful coaching, training, learning, program delivery, student access, community, communication, and workspace operations.",
      "Users are responsible for following laws and obligations that apply to their business, students, content, and communications.",
    ],
    title: "Lawful Use",
  },
  {
    body: [
      "Do not use CoachFort for spam, credential harvesting, deceptive activity, unauthorized access attempts, platform abuse, scraping, malware, security bypassing, or activity that interferes with platform reliability.",
      "Do not share passwords, OTPs, invite links, privileged accounts, or payment secrets with unauthorized people.",
    ],
    title: "No Misuse Or Unauthorized Access",
  },
  {
    body: [
      "Do not upload, publish, sell, or distribute harmful, illegal, abusive, deceptive, infringing, exploitative, or discriminatory content through CoachFort.",
      "CoachFort may remove access to content or accounts that appear to create safety, legal, abuse, or platform-risk concerns.",
    ],
    title: "No Harmful Or Illegal Content",
  },
  {
    body: [
      "Student information should be used only for legitimate coaching operations and student support.",
      "Coaches and workspace owners are responsible for having permission to collect, upload, manage, and communicate with students through CoachFort.",
    ],
    title: "No Misuse Of Student Information",
  },
  {
    body: [
      "Coaches are responsible for the legality, accuracy, quality, suitability, and promises made in their programs, pricing, live sessions, materials, messages, and student communications.",
      "CoachFort provides software and does not verify or endorse coach-created content.",
    ],
    title: "Coach Content Responsibility",
  },
  {
    body: [
      "CoachFort may restrict, suspend, or remove access if a workspace, user, or activity creates security, abuse, legal, payment, student-safety, or platform-integrity concerns.",
      "For urgent safety or abuse concerns, contact support@coachfort.com.",
    ],
    title: "Enforcement",
  },
];

export default function AcceptableUsePage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <MarketingHeader />
      <section className="border-b border-[#D8E8F0] bg-[linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF8FC_100%)]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 lg:px-8">
          <Badge className="border-[#9ADDEA] bg-white text-[#0B6F87] shadow-sm">
            Platform safety
          </Badge>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-[#0B1F33] sm:text-5xl">
            Acceptable Use Policy
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[#425B76] sm:text-lg">
            This policy describes the basic safety and use boundaries for
            CoachFort workspaces, content, communications, and student data.
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
            <Link className="text-[#145DA0] hover:text-[#0F4C81]" href="/privacy">
              Privacy
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
