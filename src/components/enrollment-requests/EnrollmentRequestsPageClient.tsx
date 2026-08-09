"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { TableShell } from "@/src/components/ui/TableShell";
import { getCoursesForTenant, type Course } from "@/src/lib/courses";
import {
  buildEnrollmentRequestActivity,
  getEnrollmentRequestRecovery,
  type EnrollmentRequestRecovery,
} from "@/src/lib/enrollmentRequestActivity";
import {
  canApproveEnrollmentRequest,
  canRejectEnrollmentRequest,
  enrollmentRequestStatusFilters,
  filterEnrollmentRequests,
  getEnrollmentRequestEmptyTitle,
  getEnrollmentRequestLifecycleStatus,
  getEnrollmentRequestStatusLabel,
  getNeedsAttentionGuidance,
  type EnrollmentRequestStatusFilter,
} from "@/src/lib/enrollmentRequestInbox";
import {
  approvePublicProgramEnrollmentRequest,
  getEnrollmentRequests,
  rejectPublicProgramEnrollmentRequest,
  type EnrollmentRequestLifecycleStatus,
  type PublicSiteLead,
} from "@/src/lib/publicSite";
import {
  getStudentPortalInvitationStatus,
  sendStudentPortalInvitation,
  type StudentPortalInvitationSummary,
} from "@/src/lib/studentPortalInvitations";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type EnrollmentRequestsPageClientProps = {
  initialCourseId?: string;
};

type FeedbackState = {
  message: string;
  tone: "error" | "success";
};

const statusTone: Record<
  EnrollmentRequestLifecycleStatus,
  "info" | "neutral" | "success" | "warning"
> = {
  enrolled: "success",
  needs_attention: "warning",
  new: "info",
  processing: "neutral",
  rejected: "neutral",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatActivityTimestamp(value: string | null) {
  if (!value) {
    return "Current state";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getInvitationCopy(
  summary: StudentPortalInvitationSummary | null | undefined,
) {
  if (!summary) {
    return "Portal status unavailable";
  }

  switch (summary.status) {
    case "access_active":
      return "Access active";
    case "invitation_expired":
      return "Invitation expired";
    case "invitation_pending":
      return "Invitation pending";
    case "invitation_sent":
      return "Invitation sent";
    case "needs_attention":
      return "Invitation needs retry";
    default:
      return "Invitation not sent";
  }
}

function getSafeActionError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : "";

  if (
    message.startsWith("Only workspace owners and admins") ||
    message.startsWith("Enrolled requests cannot be rejected") ||
    message.startsWith("This enrollment request is no longer available") ||
    message.startsWith("Rejection reason must be") ||
    message.startsWith("This request needs attention") ||
    message.startsWith("Student name is required") ||
    message.startsWith("Student email or phone is required") ||
    message.startsWith("Unable to send the portal invitation")
  ) {
    return message;
  }

  return fallback;
}

async function loadInvitationStatuses(
  requests: PublicSiteLead[],
  tenantId: string,
) {
  const enrolledRequests = requests.filter(
    (request) =>
      getEnrollmentRequestLifecycleStatus(request) === "enrolled" &&
      Boolean(request.converted_student_id),
  );
  const entries = await Promise.all(
    enrolledRequests.map(async (request) => {
      try {
        const summary = await getStudentPortalInvitationStatus({
          studentId: request.converted_student_id as string,
          tenantId,
        });
        return [request.id, summary] as const;
      } catch {
        return [request.id, null] as const;
      }
    }),
  );

  return Object.fromEntries(entries) as Record<
    string,
    StudentPortalInvitationSummary | null
  >;
}

export function EnrollmentRequestsPageClient({
  initialCourseId = "",
}: EnrollmentRequestsPageClientProps) {
  const [accessDenied, setAccessDenied] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseFilter, setCourseFilter] = useState(initialCourseId);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [invitationStatuses, setInvitationStatuses] = useState<
    Record<string, StudentPortalInvitationSummary | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [requests, setRequests] = useState<PublicSiteLead[]>([]);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [search, setSearch] = useState("");
  const [selectedRequest, setSelectedRequest] =
    useState<PublicSiteLead | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<EnrollmentRequestStatusFilter>("all");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const canMutate = role === "owner" || role === "admin";
  const selectedInvitation = selectedRequest
    ? invitationStatuses[selectedRequest.id]
    : null;
  const selectedActivity = selectedRequest
    ? buildEnrollmentRequestActivity({
        invitation: selectedInvitation,
        request: selectedRequest,
      })
    : [];
  const selectedRecovery = selectedRequest
    ? getEnrollmentRequestRecovery({
        invitation: selectedInvitation,
        request: selectedRequest,
      })
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setError("Workspace context is not available.");
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("Please sign in again to review enrollment requests.");
        return;
      }

      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

      setRole(currentRole);
      setTenant(currentTenant);

      if (currentRole !== "owner" && currentRole !== "admin") {
        setAccessDenied(true);
        setRequests([]);
        return;
      }

      setAccessDenied(false);
      const [currentRequests, currentCourses] = await Promise.all([
        getEnrollmentRequests({ tenantId: currentTenant.id }),
        getCoursesForTenant(currentTenant.id),
      ]);
      const statuses = await loadInvitationStatuses(
        currentRequests,
        currentTenant.id,
      );

      setCourses(currentCourses);
      setRequests(currentRequests);
      setInvitationStatuses(statuses);
      setCourseFilter((current) =>
        current && currentCourses.some((course) => course.id === current)
          ? current
          : "",
      );
    } catch {
      setError("Unable to load enrollment requests right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (!selectedRequest) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mutatingId) {
        setRejecting(false);
        setRejectionReason("");
        setSelectedRequest(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mutatingId, selectedRequest]);

  const courseTitleById = useMemo(
    () => Object.fromEntries(courses.map((course) => [course.id, course.title])),
    [courses],
  );
  const filteredRequests = useMemo(
    () =>
      filterEnrollmentRequests({
        courseId: courseFilter,
        courseTitleById,
        requests,
        search,
        status: statusFilter,
      }),
    [courseFilter, courseTitleById, requests, search, statusFilter],
  );
  const statusCounts = useMemo(
    () =>
      requests.reduce<Record<EnrollmentRequestStatusFilter, number>>(
        (counts, request) => {
          const status = getEnrollmentRequestLifecycleStatus(request);
          counts.all += 1;

          if (status !== "processing") {
            counts[status] += 1;
          }

          return counts;
        },
        { all: 0, enrolled: 0, needs_attention: 0, new: 0, rejected: 0 },
      ),
    [requests],
  );

  function closeDialog() {
    if (mutatingId) {
      return;
    }

    setRejecting(false);
    setRejectionReason("");
    setSelectedRequest(null);
  }

  async function handleApprove(request: PublicSiteLead) {
    if (!tenant || !canMutate) {
      return;
    }

    setMutatingId(request.id);
    setFeedback(null);

    try {
      await approvePublicProgramEnrollmentRequest({
        leadId: request.id,
        studentEmail: request.email ?? undefined,
        studentName: request.name,
        studentPhone: request.phone ?? undefined,
        tenantId: tenant.id,
      });
      setRejecting(false);
      setRejectionReason("");
      setSelectedRequest(null);
      await load();
      setFeedback({
        message:
          "Request approved and student enrolled. Portal access remains a separate next step.",
        tone: "success",
      });
    } catch (caught) {
      const message = getSafeActionError(
        caught,
        "Unable to approve this request right now.",
      );

      if (message.startsWith("This request needs attention")) {
        setRejecting(false);
        setRejectionReason("");
        setSelectedRequest(null);
      }

      await load();
      setFeedback({
        message,
        tone: "error",
      });
    } finally {
      setMutatingId("");
    }
  }

  async function handleReject(request: PublicSiteLead) {
    if (!tenant || !canMutate) {
      return;
    }

    setMutatingId(request.id);
    setFeedback(null);

    try {
      await rejectPublicProgramEnrollmentRequest({
        leadId: request.id,
        reason: rejectionReason,
        tenantId: tenant.id,
      });
      setRejecting(false);
      setRejectionReason("");
      setSelectedRequest(null);
      await load();
      setFeedback({ message: "Request rejected.", tone: "success" });
    } catch (caught) {
      setFeedback({
        message: getSafeActionError(
          caught,
          "Unable to reject this request right now.",
        ),
        tone: "error",
      });
    } finally {
      setMutatingId("");
    }
  }

  async function handleInvitation(request: PublicSiteLead) {
    if (!tenant || !canMutate || !request.converted_student_id) {
      return;
    }

    setMutatingId(request.id);
    setFeedback(null);

    try {
      const result = await sendStudentPortalInvitation({
        enrollmentRequestId: request.id,
        tenantId: tenant.id,
      });
      await load();
      setFeedback({ message: result.message, tone: "success" });
    } catch (caught) {
      await load();
      setFeedback({
        message: getSafeActionError(
          caught,
          "Unable to send the portal invitation right now.",
        ),
        tone: "error",
      });
    } finally {
      setMutatingId("");
    }
  }

  function renderRecoveryAction(
    request: PublicSiteLead,
    recovery: EnrollmentRequestRecovery,
  ) {
    switch (recovery.action) {
      case "retry_invitation":
        return (
          <Button
            isLoading={mutatingId === request.id}
            loadingText="Retrying..."
            onClick={() => void handleInvitation(request)}
            size="sm"
            type="button"
          >
            Retry invitation
          </Button>
        );
      case "review_student":
        return request.converted_student_id ? (
          <Button
            href={`/app/students/${request.converted_student_id}`}
            size="sm"
            variant="secondary"
          >
            Review student
          </Button>
        ) : null;
      case "review_enrollment":
        return (
          <Button href="/app/enrollments" size="sm" variant="secondary">
            Review enrollments
          </Button>
        );
      case "open_program":
        return request.interested_course_id ? (
          <Button
            href={`/app/courses/${request.interested_course_id}`}
            size="sm"
            variant="secondary"
          >
            Open program
          </Button>
        ) : null;
      default:
        return null;
    }
  }

  function renderRowAction(request: PublicSiteLead) {
    const lifecycleStatus = getEnrollmentRequestLifecycleStatus(request);
    const invitation = invitationStatuses[request.id];
    const canSendInvitation =
      lifecycleStatus === "enrolled" &&
      Boolean(request.converted_student_id) &&
      Boolean(request.converted_enrollment_id) &&
      invitation !== null &&
      (invitation?.status === "invitation_not_sent" ||
        invitation?.status === "invitation_expired" ||
        (invitation?.status === "needs_attention" && invitation.can_resend));

    if (canApproveEnrollmentRequest(lifecycleStatus)) {
      return (
        <Button
          onClick={() => setSelectedRequest(request)}
          size="sm"
          type="button"
        >
          Review
        </Button>
      );
    }

    if (canSendInvitation) {
      const isRetry = invitation?.status === "needs_attention";
      const isResend = invitation?.status === "invitation_expired";

      return (
        <Button
          isLoading={mutatingId === request.id}
          loadingText={isRetry ? "Retrying..." : "Sending..."}
          onClick={() => void handleInvitation(request)}
          size="sm"
          type="button"
        >
          {isRetry
            ? "Retry invitation"
            : isResend
              ? "Send new invitation"
              : "Send invitation"}
        </Button>
      );
    }

    return (
      <Button
        onClick={() => setSelectedRequest(request)}
        size="sm"
        type="button"
        variant="secondary"
      >
        View details
      </Button>
    );
  }

  if (accessDenied) {
    return (
      <EmptyState
        description="Only workspace owners and admins can review or change enrollment requests."
        eyebrow="Access restricted"
        title="Enrollment requests are not available for your role."
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        description="Review new student requests and move approved students into your programs."
        eyebrow="Student operations"
        metadata={
          <>
            <Badge tone="info">{statusCounts.new} new</Badge>
            <Badge tone="warning">
              {statusCounts.needs_attention} need attention
            </Badge>
          </>
        }
        title="Enrollment Requests"
      />

      {feedback ? (
        <FeedbackAlert className="mt-6" tone={feedback.tone}>
          {feedback.message}
        </FeedbackAlert>
      ) : null}

      <section aria-label="Request filters" className="mt-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
          {enrollmentRequestStatusFilters.map((filter) => (
            <button
              aria-pressed={statusFilter === filter.value}
              className={[
                "h-10 rounded-lg border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA]",
                statusFilter === filter.value
                  ? "border-[#145DA0] bg-[#145DA0] text-white"
                  : "border-[#CBD5E1] bg-white text-[#334155] hover:border-[#2ECBEA] hover:bg-[#F3FAFD]",
              ].join(" ")}
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              type="button"
            >
              {filter.label} {statusCounts[filter.value]}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)]">
          <label className="block">
            <span className="sr-only">Search enrollment requests</span>
            <input
              className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none placeholder:text-[#64748B] focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, or program"
              type="search"
              value={search}
            />
          </label>
          <label className="block">
            <span className="sr-only">Filter by program</span>
            <select
              className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-medium text-[#334155] outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
              onChange={(event) => setCourseFilter(event.target.value)}
              value={courseFilter}
            >
              <option value="">All programs</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <EmptyState
          action={{ label: "Try again", onClick: () => void load() }}
          description="Your request information is unchanged. Reload this view to try again."
          eyebrow="Unable to load"
          title={error}
        />
      ) : loading ? (
        <div className="mt-6 space-y-3" aria-label="Loading enrollment requests">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          description="Requests will appear here when prospective students submit a program request."
          title={getEnrollmentRequestEmptyTitle({
            courseId: courseFilter,
            search,
            status: statusFilter,
          })}
        />
      ) : (
        <TableShell
          className="mt-6 border-[#CBD5E1] shadow-sm shadow-slate-950/5"
          description={`${filteredRequests.length} request${filteredRequests.length === 1 ? "" : "s"} in this view`}
          title="Request inbox"
        >
          <div className="hidden min-w-[900px] lg:block">
            <div className="grid grid-cols-[1.25fr_1fr_0.8fr_0.8fr_1fr_auto] gap-4 border-b border-[#CBD5E1] bg-[#F8FAFC] px-5 py-3 text-xs font-semibold text-[#475569]">
              <span>Prospect</span>
              <span>Program</span>
              <span>Submitted</span>
              <span>Status</span>
              <span>Access</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {filteredRequests.map((request) => {
                const lifecycleStatus =
                  getEnrollmentRequestLifecycleStatus(request);

                return (
                  <div
                    className="grid grid-cols-[1.25fr_1fr_0.8fr_0.8fr_1fr_auto] items-center gap-4 px-5 py-4"
                    key={request.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#0B1F33]">
                        {request.name}
                      </p>
                      <p className="mt-1 truncate text-sm text-[#526A80]">
                        {request.email || "No email provided"}
                      </p>
                    </div>
                    <Link
                      className="truncate text-sm font-semibold text-[#145DA0] hover:underline"
                      href={
                        request.interested_course_id
                          ? `/app/courses/${request.interested_course_id}`
                          : "/app/courses"
                      }
                    >
                      {request.interested_course_id
                        ? courseTitleById[request.interested_course_id] ||
                          "Program unavailable"
                        : "No program selected"}
                    </Link>
                    <span className="text-sm text-[#526A80]">
                      {formatDate(request.created_at)}
                    </span>
                    <Badge tone={statusTone[lifecycleStatus]}>
                      {getEnrollmentRequestStatusLabel(lifecycleStatus)}
                    </Badge>
                    <span className="text-sm font-medium text-[#334155]">
                      {lifecycleStatus === "enrolled"
                        ? getInvitationCopy(invitationStatuses[request.id])
                        : lifecycleStatus === "needs_attention"
                          ? getNeedsAttentionGuidance(request.last_error_code)
                          : "Not started"}
                    </span>
                    <div className="flex justify-end">
                      {renderRowAction(request)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0] lg:hidden">
            {filteredRequests.map((request) => {
              const lifecycleStatus = getEnrollmentRequestLifecycleStatus(request);

              return (
                <article className="p-4" key={request.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-[#0B1F33]">
                        {request.name}
                      </h2>
                      <p className="mt-1 truncate text-sm text-[#526A80]">
                        {request.email || "No email provided"}
                      </p>
                    </div>
                    <Badge tone={statusTone[lifecycleStatus]}>
                      {getEnrollmentRequestStatusLabel(lifecycleStatus)}
                    </Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs font-semibold text-[#64748B]">
                        Program
                      </dt>
                      <dd className="mt-1 font-medium text-[#0B1F33]">
                        {request.interested_course_id
                          ? courseTitleById[request.interested_course_id] ||
                            "Program unavailable"
                          : "No program selected"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-[#64748B]">
                        Submitted
                      </dt>
                      <dd className="mt-1 text-[#334155]">
                        {formatDate(request.created_at)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm font-medium text-[#334155]">
                    {lifecycleStatus === "enrolled"
                      ? getInvitationCopy(invitationStatuses[request.id])
                      : lifecycleStatus === "needs_attention"
                        ? getNeedsAttentionGuidance(request.last_error_code)
                        : "Portal access begins after enrollment."}
                  </p>
                  <div className="mt-4 flex justify-end">
                    {renderRowAction(request)}
                  </div>
                </article>
              );
            })}
          </div>
        </TableShell>
      )}

      {selectedRequest ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/70 p-3 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            aria-describedby="request-dialog-description"
            aria-labelledby="request-dialog-title"
            aria-modal="true"
            className="max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl sm:max-h-[calc(100vh-3rem)] sm:p-7"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge
                  tone={
                    statusTone[getEnrollmentRequestLifecycleStatus(selectedRequest)]
                  }
                >
                  {getEnrollmentRequestStatusLabel(
                    getEnrollmentRequestLifecycleStatus(selectedRequest),
                  )}
                </Badge>
                <h2 className="mt-4 text-2xl font-semibold" id="request-dialog-title">
                  {rejecting ? "Reject request" : "Review enrollment request"}
                </h2>
                <p
                  className="mt-2 text-sm leading-6 text-[#526A80]"
                  id="request-dialog-description"
                >
                  {rejecting
                    ? "The request stays in the inbox and no student or enrollment is created."
                    : "Review the prospect and program before taking the next step."}
                </p>
              </div>
              <button
                aria-label="Close request review"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-xl text-[#526A80] transition hover:bg-[#F1F5F9]"
                disabled={Boolean(mutatingId)}
                onClick={closeDialog}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className="mt-6 grid gap-4 border-y border-[#E2E8F0] py-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-[#64748B]">Prospect</p>
                <p className="mt-2 font-semibold">{selectedRequest.name}</p>
                <p className="mt-1 text-sm text-[#526A80]">
                  {selectedRequest.email || "No email provided"}
                </p>
                <p className="mt-1 text-sm text-[#526A80]">
                  {selectedRequest.phone || "No phone provided"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#64748B]">Program</p>
                <p className="mt-2 font-semibold">
                  {selectedRequest.interested_course_id
                    ? courseTitleById[selectedRequest.interested_course_id] ||
                      "Program unavailable"
                    : "No program selected"}
                </p>
                <p className="mt-1 text-sm text-[#526A80]">
                  Submitted {formatDate(selectedRequest.created_at)}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-[#64748B]">Message</p>
                <p className="mt-2 text-sm leading-6 text-[#334155]">
                  {selectedRequest.message || "No message was included."}
                </p>
              </div>
            </div>

            <section aria-labelledby="request-history-title" className="mt-6">
              <h3
                className="text-sm font-semibold text-[#0B1F33]"
                id="request-history-title"
              >
                Request history
              </h3>
              <ol className="mt-3 border-l border-[#CBD5E1] pl-4">
                {selectedActivity.map((event) => (
                  <li className="relative pb-4 last:pb-0" key={event.key}>
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.31rem] top-1.5 h-2 w-2 rounded-full bg-[#145DA0] ring-4 ring-white"
                    />
                    <p className="text-sm font-semibold text-[#0B1F33]">
                      {event.label}
                    </p>
                    {event.timestamp ? (
                      <time
                        className="mt-1 block text-xs text-[#64748B]"
                        dateTime={event.timestamp}
                      >
                        {formatActivityTimestamp(event.timestamp)}
                      </time>
                    ) : (
                      <span className="mt-1 block text-xs text-[#64748B]">
                        Current state
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>

            {rejecting ? (
              <label className="mt-5 block text-sm font-semibold text-[#334155]">
                Reason (optional)
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-lg border border-[#CBD5E1] px-4 py-3 text-sm font-normal leading-6 outline-none focus:border-[#145DA0] focus:ring-4 focus:ring-[#145DA0]/10"
                  maxLength={1000}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Add concise internal context."
                  value={rejectionReason}
                />
              </label>
            ) : getEnrollmentRequestLifecycleStatus(selectedRequest) === "new" ? (
              <FeedbackAlert className="mt-5" tone="info">
                Approve &amp; enroll safely matches or creates the student and
                creates or reuses the program enrollment. Payment remains
                separate, and portal access starts only after an invitation is
                accepted.
              </FeedbackAlert>
            ) : selectedRecovery ? (
              <div className="mt-5 border-l-4 border-[#F59E0B] bg-[#FFF7ED] px-4 py-3 text-[#7C2D12]">
                <p className="text-sm font-semibold">{selectedRecovery.title}</p>
                <p className="mt-1 text-sm leading-6">
                  {selectedRecovery.description}
                </p>
                {selectedRecovery.action ? (
                  <div className="mt-3">
                    {renderRecoveryAction(selectedRequest, selectedRecovery)}
                  </div>
                ) : null}
              </div>
            ) : getEnrollmentRequestLifecycleStatus(selectedRequest) ===
              "enrolled" ? (
              <FeedbackAlert className="mt-5" tone="info">
                Enrolled. {getInvitationCopy(invitationStatuses[selectedRequest.id])}.
              </FeedbackAlert>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Button
                  disabled={Boolean(mutatingId)}
                  onClick={closeDialog}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                {selectedRequest.interested_course_id &&
                selectedRecovery?.action !== "open_program" ? (
                  <Button
                    href={`/app/courses/${selectedRequest.interested_course_id}`}
                    variant="ghost"
                  >
                    Open program
                  </Button>
                ) : null}
                {selectedRequest.converted_student_id &&
                selectedRecovery?.action !== "review_student" ? (
                  <Button
                    href={`/app/students/${selectedRequest.converted_student_id}`}
                    variant="ghost"
                  >
                    Review student
                  </Button>
                ) : null}
              </div>
              {canMutate &&
              canRejectEnrollmentRequest(
                getEnrollmentRequestLifecycleStatus(selectedRequest),
              ) ? (
                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  {rejecting ? (
                    <Button
                      isLoading={mutatingId === selectedRequest.id}
                      loadingText="Rejecting..."
                      onClick={() => void handleReject(selectedRequest)}
                      type="button"
                      variant="destructive"
                    >
                      Reject request
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => setRejecting(true)}
                        type="button"
                        variant="outline"
                      >
                        Reject
                      </Button>
                      {canApproveEnrollmentRequest(
                        getEnrollmentRequestLifecycleStatus(selectedRequest),
                      ) ? (
                        <Button
                          isLoading={mutatingId === selectedRequest.id}
                          loadingText="Approving..."
                          onClick={() => void handleApprove(selectedRequest)}
                          type="button"
                        >
                          Approve &amp; enroll
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
