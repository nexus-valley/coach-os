"use client";

import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { useStudentPortalOverview } from "@/src/components/portal/useStudentPortalOverview";

export function formatPortalDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatPortalDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function formatPortalCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    currency,
    style: "currency",
  }).format(value);
}

export function PortalLoadingCard({ label = "Loading portal" }: { label?: string }) {
  return (
    <Card className="h-56 animate-pulse border-[#D8E8F0] bg-white p-6">
      <span className="sr-only">{label}</span>
    </Card>
  );
}

export function PortalEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
      {children}
    </p>
  );
}

export function usePortalSection(context: StudentPortalContext) {
  return useStudentPortalOverview(context);
}

export function PortalError({ message }: { message: string }) {
  return <FeedbackAlert>{message}</FeedbackAlert>;
}
