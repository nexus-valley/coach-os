"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalDate,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalProfile({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading profile" />;
  if (error || !overview) return <PortalError message={error || "Unable to load profile."} />;

  const rows = [
    ["Name", overview.student.full_name],
    ["Email", overview.student.email ?? "Not provided"],
    ["Phone", overview.student.phone ?? "Not provided"],
    ["Status", overview.student.status],
    ["Joined", formatPortalDate(overview.student.created_at)],
    ["Portal email", context.account.email],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        description="These details are maintained by your coach and linked to your student portal login."
        eyebrow="My details"
        metadata={<Badge tone="success">Linked account</Badge>}
        title="Profile"
      />

      <Card className="border-[#D8E8F0] bg-white p-6">
        <SectionHeader
          description="Contact your coach if any profile detail needs correction."
          title="Student profile"
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{overview.student.full_name}</h2>
            <p className="mt-2 text-sm text-[#425B76]">
              Student profile details maintained by your coach.
            </p>
          </div>
          <Badge tone="success">Linked</Badge>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4" key={label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#66788F]">
                {label}
              </p>
              <p className="mt-2 font-semibold text-[#0B1F33]">{value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
