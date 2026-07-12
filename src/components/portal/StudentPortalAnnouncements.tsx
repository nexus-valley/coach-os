"use client";

import { useEffect, useState } from "react";

import {
  formatAnnouncementDate,
  getStudentAnnouncements,
  type StudentAnnouncement,
} from "@/src/lib/announcements";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { PortalEmptyState, PortalError, PortalLoadingCard } from "@/src/components/portal/StudentPortalShared";

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function StudentPortalAnnouncements({
  context,
}: {
  context: StudentPortalContext;
}) {
  const [announcements, setAnnouncements] = useState<StudentAnnouncement[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadAnnouncements() {
      setError("");
      setLoading(true);

      try {
        const nextAnnouncements = await getStudentAnnouncements();

        if (active) {
          setAnnouncements(nextAnnouncements);
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load announcements."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAnnouncements();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <PortalLoadingCard label="Loading announcements" />;
  }

  if (error) {
    return <PortalError message={error} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description={`Read official updates shared by ${context.tenant.name}. Announcements are read-only for students.`}
        eyebrow="Academy updates"
        metadata={<Badge tone="light">{announcements.length} published</Badge>}
        title="Announcements"
      />

      <SectionHeader
        description="Published academy notices, schedule updates, and student-facing information."
        title="Latest announcements"
      />

      <div className="space-y-4">
        {announcements.length === 0 ? (
          <PortalEmptyState>
            No announcements have been published for your student portal yet.
          </PortalEmptyState>
        ) : (
          announcements.map((announcement) => (
            <Card
              className="border-[#D8E8F0] bg-white p-5"
              key={announcement.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Badge tone="info">Academy announcement</Badge>
                  <h2 className="mt-3 text-xl font-semibold text-[#0B1F33]">
                    {announcement.title}
                  </h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                    {announcement.body}
                  </p>
                </div>
                <div className="shrink-0 rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] px-4 py-3 text-sm text-[#425B76] sm:min-w-52">
                  <p className="font-semibold text-[#0B1F33]">Published</p>
                  <p className="mt-1">
                    {formatAnnouncementDate(announcement.published_at)}
                  </p>
                  {announcement.expires_at ? (
                    <>
                      <p className="mt-3 font-semibold text-[#0B1F33]">
                        Available until
                      </p>
                      <p className="mt-1">
                        {formatAnnouncementDate(announcement.expires_at)}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
