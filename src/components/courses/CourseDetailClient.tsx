"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  createCourseSection,
  createLesson,
  deleteCourseSection,
  deleteLesson,
  getCourseById,
  getCourseStructure,
  publishCourse,
  updateCourseSection,
  updateCourseSalesSettings,
  updateLesson,
  type Course,
  type CoursePricingType,
  type CourseSectionWithLessons,
  type CourseSalesPaymentMode,
  type Lesson,
  type LessonType,
} from "@/src/lib/courses";
import {
  getEnrollmentsForCourse,
  type EnrollmentWithRelations,
} from "@/src/lib/enrollments";
import {
  approvePublicProgramEnrollmentRequest,
  getEnrollmentRequestStudentCandidates,
  getPublicSiteLeadsForCourse,
  type EnrollmentRequestStudentCandidate,
  type PublicSiteLead,
} from "@/src/lib/publicSite";
import {
  getStudentPortalInvitationStatus,
  sendStudentPortalInvitation,
  type StudentPortalInvitationSummary,
} from "@/src/lib/studentPortalInvitations";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManageCourses,
  canDeleteRecords,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CourseDetailClientProps = {
  courseId: string;
};

type SectionModalState = {
  mode: "create" | "edit";
  sectionId?: string;
  title: string;
};

type LessonModalState = {
  content: string;
  isPreview: boolean;
  lessonId?: string;
  lessonType: LessonType;
  mode: "create" | "edit";
  resourceUrl: string;
  sectionId: string;
  title: string;
  videoUrl: string;
};

type DeleteTarget =
  | {
      kind: "section";
      sectionId: string;
      title: string;
    }
  | {
      kind: "lesson";
      lessonId: string;
      sectionId: string;
      title: string;
    };

type SalesSettingsForm = {
  accessDurationLabel: string;
  externalPaymentUrl: string;
  paymentInstructions: string;
  priceAmount: string;
  pricingType: CoursePricingType;
  publicSalesEnabled: boolean;
  salesCurrency: "INR";
  salesHeadline: string;
  salesPaymentMode: CourseSalesPaymentMode;
  salesSummary: string;
};

type ReviewRequestModalState = {
  conversionNote: string;
  error: string;
  existingStudentId: string;
  request: PublicSiteLead;
  studentAction: "create" | "existing";
  studentEmail: string;
  studentName: string;
  studentPhone: string;
};

const lessonTypes: LessonType[] = ["text", "video", "pdf", "quiz", "assignment"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function CourseStatusBadge({ status }: { status: Course["status"] }) {
  if (status === "published") {
    return <Badge tone="success">Published</Badge>;
  }

  if (status === "archived") {
    return <Badge className="border-white/15 bg-white/10 text-slate-300">Archived</Badge>;
  }

  return <Badge className="border-white/10 bg-white/10 text-white">Draft</Badge>;
}

function createSalesSettingsForm(course: Course): SalesSettingsForm {
  return {
    accessDurationLabel: course.access_duration_label ?? "",
    externalPaymentUrl: course.external_payment_url ?? "",
    paymentInstructions: course.payment_instructions ?? "",
    priceAmount:
      course.pricing_type === "paid" && course.price_amount
        ? String(course.price_amount)
        : "",
    pricingType: course.pricing_type ?? "free",
    publicSalesEnabled: course.public_sales_enabled ?? false,
    salesCurrency: course.sales_currency ?? "INR",
    salesHeadline: course.sales_headline ?? "",
    salesPaymentMode: course.sales_payment_mode ?? "manual",
    salesSummary: course.sales_summary ?? "",
  };
}

function formatProgramPrice(course: Course) {
  if (course.pricing_type === "free") {
    return "Free";
  }

  return new Intl.NumberFormat("en-IN", {
    currency: course.sales_currency || "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(course.price_amount ?? 0);
}

function getLeadSourceLabel(source: string | null) {
  if (source === "program_sales_page") {
    return "Public program page";
  }

  if (source === "public_site") {
    return "Public coach page";
  }

  return "Public inquiry";
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

async function getInvitationStatusesForRequests(
  requests: PublicSiteLead[],
  tenantId: string,
) {
  const enrolledRequests = requests.filter(
    (request) =>
      request.enrollment_request_status === "enrolled" &&
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

function getInvitationStatusCopy(
  summary: StudentPortalInvitationSummary | null | undefined,
) {
  if (!summary) {
    return "Portal invitation status is unavailable.";
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

export function CourseDetailClient({ courseId }: CourseDetailClientProps) {
  const [actionError, setActionError] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [enrollmentRequests, setEnrollmentRequests] = useState<
    PublicSiteLead[]
  >([]);
  const [enrollmentRequestsLoading, setEnrollmentRequestsLoading] =
    useState(true);
  const [error, setError] = useState("");
  const [lessonModal, setLessonModal] = useState<LessonModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<{
    message: string;
    tone: "error" | "info" | "success";
  } | null>(null);
  const publishFeedbackRef = useRef<HTMLDivElement>(null);
  const focusPublishFeedbackAfterSuccessRef = useRef(false);
  const [publishSaving, setPublishSaving] = useState(false);
  const [portalInvitationSavingId, setPortalInvitationSavingId] = useState("");
  const [portalInvitationStatuses, setPortalInvitationStatuses] = useState<
    Record<string, StudentPortalInvitationSummary | null>
  >({});
  const [salesFeedback, setSalesFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [salesForm, setSalesForm] = useState<SalesSettingsForm | null>(null);
  const [salesSaving, setSalesSaving] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const [requestFeedback, setRequestFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [reviewModal, setReviewModal] =
    useState<ReviewRequestModalState | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [sectionModal, setSectionModal] = useState<SectionModalState | null>(
    null,
  );
  const [sections, setSections] = useState<CourseSectionWithLessons[]>([]);
  const [studentCandidates, setStudentCandidates] = useState<
    EnrollmentRequestStudentCandidate[]
  >([]);
  const [studentCandidatesLoading, setStudentCandidatesLoading] =
    useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const canDelete = canDeleteRecords(currentRole);
  const canManage = canManageCourses(currentRole);
  const canApproveRequests = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    let active = true;

    async function loadCourse() {
      try {
        setEnrollmentRequestsLoading(true);
        setStudentCandidatesLoading(true);
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          setError("Workspace context is not available.");
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        const [currentCourse, currentStructure, courseEnrollments, memberRole] =
          await Promise.all([
            getCourseById({
              courseId,
              tenantId: currentTenant.id,
            }),
            getCourseStructure(courseId, currentTenant.id),
            getEnrollmentsForCourse({
              courseId,
              tenantId: currentTenant.id,
            }),
            user
              ? getCurrentMemberRole(currentTenant.id, user.id)
              : Promise.resolve(null),
          ]);
        const canReviewRequests =
          memberRole === "owner" || memberRole === "admin";
        const [courseEnrollmentRequests, activeStudentCandidates] =
          currentCourse && canReviewRequests
            ? await Promise.all([
                getPublicSiteLeadsForCourse({
                  courseId,
                  tenantId: currentTenant.id,
                }),
                getEnrollmentRequestStudentCandidates({
                  tenantId: currentTenant.id,
                }),
              ])
            : [[], []];
        const invitationStatuses = canReviewRequests
          ? await getInvitationStatusesForRequests(
              courseEnrollmentRequests,
              currentTenant.id,
            )
          : {};

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourse(currentCourse);
        setSalesForm(currentCourse ? createSalesSettingsForm(currentCourse) : null);
        setCurrentRole(memberRole);
        setEnrollmentRequests(courseEnrollmentRequests);
        setPortalInvitationStatuses(invitationStatuses);
        setStudentCandidates(activeStudentCandidates);
        setSections(currentCourse ? currentStructure : []);
        setEnrollments(currentCourse ? courseEnrollments : []);

        if (!currentCourse) {
          setError("Program not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          getErrorMessage(caught, "Unable to load this program right now."),
        );
      } finally {
        if (active) {
          setLoading(false);
          setEnrollmentRequestsLoading(false);
          setStudentCandidatesLoading(false);
        }
      }
    }

    loadCourse();

    return () => {
      active = false;
    };
  }, [courseId]);

  useEffect(() => {
    if (!publishConfirmOpen) {
      return;
    }

    const dialog = document.getElementById("publish-course-dialog");
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    dialog?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !publishSaving) {
        setPublishConfirmOpen(false);
        window.requestAnimationFrame(() => {
          document.getElementById("publish-course-trigger")?.focus();
        });
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDialogKeyDown);
    };
  }, [publishConfirmOpen, publishSaving]);

  useEffect(() => {
    if (
      publishConfirmOpen ||
      !publishFeedback ||
      publishFeedback.tone === "error" ||
      !focusPublishFeedbackAfterSuccessRef.current
    ) {
      return;
    }

    focusPublishFeedbackAfterSuccessRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      publishFeedbackRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [publishConfirmOpen, publishFeedback]);

  async function refreshStructure() {
    if (!tenant) {
      return;
    }

    setSections(await getCourseStructure(courseId, tenant.id));
  }

  async function refreshEnrollmentRequests() {
    if (!tenant || !course || !canApproveRequests) {
      return;
    }

    setEnrollmentRequestsLoading(true);

    try {
      const requests = await getPublicSiteLeadsForCourse({
        courseId: course.id,
        tenantId: tenant.id,
      });
      const statuses = await getInvitationStatusesForRequests(
        requests,
        tenant.id,
      );

      setEnrollmentRequests(requests);
      setPortalInvitationStatuses(statuses);
    } finally {
      setEnrollmentRequestsLoading(false);
    }
  }

  async function refreshEnrollments() {
    if (!tenant || !course) {
      return;
    }

    setEnrollments(
      await getEnrollmentsForCourse({
        courseId: course.id,
        tenantId: tenant.id,
      }),
    );
  }

  function openReviewRequest(request: PublicSiteLead) {
    setRequestFeedback(null);
    setReviewModal({
      conversionNote: "",
      error: "",
      existingStudentId: "",
      request,
      studentAction: "create",
      studentEmail: request.email ?? "",
      studentName: request.name,
      studentPhone: request.phone ?? "",
    });
  }

  function getNextSectionOrder() {
    if (sections.length === 0) {
      return 0;
    }

    return Math.max(...sections.map((section) => section.sort_order)) + 1;
  }

  function getNextLessonOrder(sectionId: string) {
    const section = sections.find((item) => item.id === sectionId);

    if (!section || section.lessons.length === 0) {
      return 0;
    }

    return Math.max(...section.lessons.map((lesson) => lesson.sort_order)) + 1;
  }

  function openCreateLesson(sectionId: string) {
    setLessonModal({
      content: "",
      isPreview: false,
      lessonType: "text",
      mode: "create",
      resourceUrl: "",
      sectionId,
      title: "",
      videoUrl: "",
    });
  }

  function openEditLesson(lesson: Lesson) {
    setLessonModal({
      content: lesson.content ?? "",
      isPreview: lesson.is_preview,
      lessonId: lesson.id,
      lessonType: lesson.lesson_type,
      mode: "edit",
      resourceUrl: lesson.resource_url ?? "",
      sectionId: lesson.section_id,
      title: lesson.title,
      videoUrl: lesson.video_url ?? "",
    });
  }

  async function handleSectionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !sectionModal) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      if (sectionModal.mode === "edit" && sectionModal.sectionId) {
        await updateCourseSection({
          courseId,
          sectionId: sectionModal.sectionId,
          tenantId: tenant.id,
          title: sectionModal.title,
        });
      } else {
        await createCourseSection({
          courseId,
          sortOrder: getNextSectionOrder(),
          tenantId: tenant.id,
          title: sectionModal.title,
        });
      }

      setSectionModal(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save section right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleLessonSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant || !lessonModal) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      const payload = {
        content: lessonModal.content,
        courseId,
        isPreview: lessonModal.isPreview,
        lessonType: lessonModal.lessonType,
        resourceUrl: lessonModal.resourceUrl,
        sectionId: lessonModal.sectionId,
        tenantId: tenant.id,
        title: lessonModal.title,
        videoUrl: lessonModal.videoUrl,
      };

      if (lessonModal.mode === "edit" && lessonModal.lessonId) {
        await updateLesson({
          ...payload,
          lessonId: lessonModal.lessonId,
        });
      } else {
        await createLesson({
          ...payload,
          sortOrder: getNextLessonOrder(lessonModal.sectionId),
        });
      }

      setLessonModal(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to save lesson right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!tenant || !deleteTarget) {
      return;
    }

    setActionError("");
    setMutating(true);

    try {
      if (deleteTarget.kind === "section") {
        await deleteCourseSection({
          courseId,
          sectionId: deleteTarget.sectionId,
          tenantId: tenant.id,
        });
      } else {
        await deleteLesson({
          courseId,
          lessonId: deleteTarget.lessonId,
          sectionId: deleteTarget.sectionId,
          tenantId: tenant.id,
        });
      }

      setDeleteTarget(null);
      await refreshStructure();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, "Unable to delete this item right now."),
      );
    } finally {
      setMutating(false);
    }
  }

  async function handleSalesSettingsSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!tenant || !course || !salesForm) {
      return;
    }

    setSalesFeedback(null);
    setShareFeedback("");
    setSalesSaving(true);

    try {
      const normalizedPrice =
        salesForm.pricingType === "paid" ? Number(salesForm.priceAmount) : null;

      if (
        salesForm.pricingType === "paid" &&
        (!Number.isFinite(normalizedPrice) || !normalizedPrice || normalizedPrice <= 0)
      ) {
        throw new Error("Paid programs require a price greater than zero.");
      }

      if (
        salesForm.salesPaymentMode === "external" &&
        salesForm.externalPaymentUrl.trim() &&
        !salesForm.externalPaymentUrl.trim().startsWith("https://")
      ) {
        throw new Error("External payment links must start with https://.");
      }

      const updatedCourse = await updateCourseSalesSettings({
        accessDurationLabel: salesForm.accessDurationLabel,
        courseId: course.id,
        externalPaymentUrl: salesForm.externalPaymentUrl,
        paymentInstructions: salesForm.paymentInstructions,
        priceAmount: normalizedPrice,
        pricingType: salesForm.pricingType,
        publicSalesEnabled: salesForm.publicSalesEnabled,
        salesCurrency: salesForm.salesCurrency,
        salesHeadline: salesForm.salesHeadline,
        salesPaymentMode: salesForm.salesPaymentMode,
        salesSummary: salesForm.salesSummary,
        tenantId: tenant.id,
      });

      setCourse(updatedCourse);
      setSalesForm(createSalesSettingsForm(updatedCourse));
      setSalesFeedback({
        message: "Public program settings saved.",
        tone: "success",
      });
    } catch (caught) {
      setSalesFeedback({
        message: getErrorMessage(
          caught,
          "Unable to save public program settings.",
        ),
        tone: "error",
      });
    } finally {
      setSalesSaving(false);
    }
  }

  function closePublishConfirmation() {
    if (publishSaving) {
      return;
    }

    setPublishConfirmOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById("publish-course-trigger")?.focus();
    });
  }

  async function handlePublishCourse() {
    if (
      !course ||
      !canManage ||
      course.status !== "draft" ||
      publishSaving
    ) {
      return;
    }

    focusPublishFeedbackAfterSuccessRef.current = false;
    setPublishFeedback(null);
    setPublishSaving(true);

    try {
      const result = await publishCourse(course.id);
      const refreshedCourse = await getCourseById({
        courseId: result.courseId,
        tenantId: result.tenantId,
      }).catch(() => null);

      if (refreshedCourse) {
        setCourse(refreshedCourse);
        setSalesForm(createSalesSettingsForm(refreshedCourse));
      } else {
        setCourse((current) =>
          current && current.id === result.courseId
            ? {
                ...current,
                slug: result.slug,
                status: result.status,
                title: result.title,
                updated_at: result.updatedAt,
              }
            : current,
        );
      }
      focusPublishFeedbackAfterSuccessRef.current = true;
      setPublishConfirmOpen(false);
      setPublishFeedback({
        message:
          result.publicationResult === "already_published"
            ? "This program is already published. Its latest status has been refreshed."
            : "Program published successfully.",
        tone: result.publicationResult === "already_published" ? "info" : "success",
      });
    } catch (caught) {
      setPublishFeedback({
        message: getErrorMessage(
          caught,
          "This program could not be published. Refresh the page to check its latest status.",
        ),
        tone: "error",
      });
    } finally {
      setPublishSaving(false);
    }
  }

  async function handleCopyPublicProgramLink() {
    if (!publicProgramReady || !publicProgramPath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${publicProgramPath}`,
      );
      setShareFeedback("Public program link copied.");
    } catch {
      setShareFeedback(
        "Unable to copy automatically. Open the student page and copy its address.",
      );
    }
  }

  async function handleApproveRequestSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!tenant || !course || !reviewModal) {
      return;
    }

    setReviewSaving(true);
    setReviewModal((current) => (current ? { ...current, error: "" } : current));

    try {
      await approvePublicProgramEnrollmentRequest({
        conversionNote: reviewModal.conversionNote,
        existingStudentId:
          reviewModal.studentAction === "existing"
            ? reviewModal.existingStudentId
            : null,
        leadId: reviewModal.request.id,
        studentAction: reviewModal.studentAction,
        studentEmail: reviewModal.studentEmail,
        studentName: reviewModal.studentName,
        studentPhone: reviewModal.studentPhone,
        tenantId: tenant.id,
      });

      await Promise.all([refreshEnrollmentRequests(), refreshEnrollments()]);
      setReviewModal(null);
      setRequestFeedback({
        message:
          "Request approved and student enrolled. Portal access remains separate until an invitation is accepted.",
        tone: "success",
      });
    } catch (caught) {
      setReviewModal((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(
                caught,
                "Unable to approve this request right now.",
              ),
            }
          : current,
      );
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleSendPortalInvitation(request: PublicSiteLead) {
    if (!tenant || !request.converted_student_id) {
      return;
    }

    setPortalInvitationSavingId(request.id);
    setRequestFeedback(null);

    try {
      const result = await sendStudentPortalInvitation({
        enrollmentRequestId: request.id,
        tenantId: tenant.id,
      });
      const summary = await getStudentPortalInvitationStatus({
        studentId: request.converted_student_id,
        tenantId: tenant.id,
      });

      setPortalInvitationStatuses((current) => ({
        ...current,
        [request.id]: summary,
      }));
      setRequestFeedback({
        message: result.message,
        tone: "success",
      });
    } catch (caught) {
      try {
        const summary = await getStudentPortalInvitationStatus({
          studentId: request.converted_student_id,
          tenantId: tenant.id,
        });
        setPortalInvitationStatuses((current) => ({
          ...current,
          [request.id]: summary,
        }));
      } catch {
        // Keep the last safe summary when refresh is unavailable.
      }

      setRequestFeedback({
        message: getErrorMessage(
          caught,
          "Unable to send the portal invitation right now.",
        ),
        tone: "error",
      });
    } finally {
      setPortalInvitationSavingId("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-[#101214]">
          <span className="sr-only">Loading program</span>
        </Card>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-[#101214] p-8 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-500">Program detail</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Program not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-teal-400 px-5 text-sm font-semibold text-black"
            href="/app/courses"
          >
            Back to programs
          </Link>
        </Card>
      </div>
    );
  }

  const publicProgramPath = tenant
    ? `/site/${tenant.slug}/programs/${course.slug}`
    : "";
  const studentSummaryReady = Boolean(
    course.sales_headline?.trim() ||
      course.sales_summary?.trim() ||
      course.description?.trim(),
  );
  const paymentGuidanceReady =
    course.pricing_type === "free" ||
    Boolean(
      course.payment_instructions?.trim() ||
        (course.sales_payment_mode === "external" &&
          course.external_payment_url?.trim()),
    );
  const publicPageAvailable =
    Boolean(publicProgramPath) &&
    course.status === "published" &&
    course.public_sales_enabled;
  const publicProgramReady =
    publicPageAvailable && studentSummaryReady && paymentGuidanceReady;
  const lessonCount = sections.reduce(
    (total, section) => total + section.lessons.length,
    0,
  );
  const publishReadinessItems = [
    {
      complete: studentSummaryReady,
      label: studentSummaryReady
        ? "Student-facing summary is ready"
        : "Add a student-facing summary before sharing",
    },
    {
      complete: sections.length > 0 && lessonCount > 0,
      label:
        sections.length > 0 && lessonCount > 0
          ? "Program structure has content"
          : "Add sections and lessons before sharing",
    },
    {
      complete: course.public_sales_enabled,
      label: course.public_sales_enabled
        ? "Public request page is enabled"
        : "Public request page will remain off",
    },
    {
      complete: paymentGuidanceReady,
      label: paymentGuidanceReady
        ? "Payment guidance is ready"
        : "Review payment guidance before sharing",
    },
  ];
  const salesReadinessItems = [
    {
      complete: course.status === "published",
      label: "Program is published",
    },
    {
      complete: course.public_sales_enabled,
      label: "Public request page is enabled",
    },
    {
      complete: studentSummaryReady,
      label: "Student-facing summary is ready",
    },
    {
      complete: paymentGuidanceReady,
      label:
        course.pricing_type === "free"
          ? "No payment instructions needed"
          : "Student payment guidance is ready",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-[#425B76] transition hover:text-[#0B1F33] hover:underline"
        href="/app/courses"
      >
        Back to programs
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Program overview
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {course.title}
              </h2>
            </div>
            <div className="flex max-w-xs flex-col items-start gap-3 sm:items-end">
              <CourseStatusBadge status={course.status} />
              <p className="text-left text-xs leading-5 text-slate-400 sm:text-right">
                {course.status === "published"
                  ? "Published programs are visible only when current public-page settings allow it."
                  : course.status === "archived"
                    ? "Archived programs cannot be published."
                    : "This program stays private until an owner or admin publishes it."}
              </p>
              {canManage && course.status === "draft" ? (
                <Button
                  className="bg-teal-400 text-black hover:bg-teal-300"
                  disabled={publishSaving}
                  id="publish-course-trigger"
                  onClick={() => {
                    focusPublishFeedbackAfterSuccessRef.current = false;
                    setPublishFeedback(null);
                    setPublishConfirmOpen(true);
                  }}
                  size="sm"
                  type="button"
                >
                  Publish program
                </Button>
              ) : null}
            </div>
          </div>

          <p className="mt-6 max-w-3xl text-base leading-7 text-slate-400">
            {course.description || "No description added yet."}
          </p>

          {publishFeedback ? (
            <div
              aria-live="polite"
              className="mt-6 focus:outline-none"
              ref={publishFeedbackRef}
              tabIndex={-1}
            >
              <FeedbackAlert tone={publishFeedback.tone}>
                {publishFeedback.message}
              </FeedbackAlert>
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-slate-500">Workspace</p>
              <p className="mt-2 font-semibold">{tenant?.name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Public page</p>
              <p className="mt-2 font-semibold">
                {publicProgramReady
                  ? "Ready to share"
                  : publicPageAvailable
                    ? "Available, needs review"
                    : "Not available"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(course.created_at)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-slate-500">
            Structure summary
          </p>
          <h3 className="mt-3 text-2xl font-semibold">
            {sections.length} {sections.length === 1 ? "section" : "sections"}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {sections.reduce(
              (total, section) => total + section.lessons.length,
              0,
            )}{" "}
            lessons created across this program.
          </p>
        </Card>
      </section>

      {publishConfirmOpen && canManage && course.status === "draft" ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#0B1F33]/75 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card
            aria-describedby="publish-course-description"
            aria-labelledby="publish-course-title"
            aria-modal="true"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:p-7"
            id="publish-course-dialog"
            role="dialog"
            tabIndex={-1}
          >
            <Badge className="border-amber-200 bg-amber-50 text-amber-800">
              Draft to published
            </Badge>
            <h3 className="mt-4 text-2xl font-semibold" id="publish-course-title">
              Publish this program?
            </h3>
            <p
              className="mt-3 text-sm leading-6 text-[#425B76]"
              id="publish-course-description"
            >
              This changes the program from Draft to Published. Its public
              availability will still depend on your Public Page and enrollment
              settings.
            </p>

            {publishFeedback?.tone === "error" ? (
              <div aria-live="polite" className="mt-5">
                <FeedbackAlert>{publishFeedback.message}</FeedbackAlert>
              </div>
            ) : null}

            <div className="mt-5 rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-sm font-semibold text-[#0B1F33]">
                Before you publish
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {publishReadinessItems.map((item) => (
                  <div
                    className={[
                      "rounded-lg border px-3 py-2 text-sm",
                      item.complete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800",
                    ].join(" ")}
                    key={item.label}
                  >
                    {item.label}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#526A80]">
                These checks are guidance only and do not block publication.
              </p>
            </div>

            <FeedbackAlert className="mt-5" tone="warning">
              {course.public_sales_enabled
                ? "The public request page is enabled, so publishing may make this program available on your public site immediately."
                : "The public request page is off and will remain off after publication. You can enable it separately when the page is ready."}
            </FeedbackAlert>

            <p className="mt-5 text-sm leading-6 text-[#425B76]">
              Publishing does not collect payment, create a student or
              enrollment, generate an invoice, payment, or receipt, create a
              portal account, send an invitation, or activate student access.
            </p>

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={publishSaving}
                onClick={closePublishConfirmation}
                type="button"
                variant="secondary"
              >
                Keep as draft
              </Button>
              <Button
                isLoading={publishSaving}
                loadingText="Publishing..."
                onClick={handlePublishCourse}
                type="button"
              >
                Publish program
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6 scroll-mt-24" id="public-program-setup">
        <Card className="border-[#D8E8F0] bg-white p-6 text-[#0B1F33] shadow-xl shadow-[#0B2A3D]/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div>
              <Badge className="border-[#A9E7F2] bg-[#EAFBFE] text-[#075E6F]">
                Student-facing page
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Prepare the public enrollment page
              </h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#425B76]">
                Set what students will see, explain price and access clearly,
                then preview the page before sharing it. CoachFort does not
                collect, hold, or refund student program payments in this phase.
              </p>
              <div className="mt-5 rounded-2xl border border-[#CFE3EC] bg-[#F6FBFE] p-4 shadow-sm">
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Public program link
                </p>
                {publicPageAvailable ? (
                  <div className="mt-3">
                    <p className="break-all rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                      {publicProgramPath}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="border-[#0B2A3D] bg-[#0B2A3D] text-white hover:bg-[#123A52]"
                        href={publicProgramPath}
                        size="sm"
                        variant="secondary"
                      >
                        Preview student page
                      </Button>
                      {publicProgramReady ? (
                        <Button
                          onClick={handleCopyPublicProgramLink}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Copy share link
                        </Button>
                      ) : null}
                      <Button
                        href="#enrollment-requests"
                        size="sm"
                        variant="secondary"
                      >
                        Review requests
                      </Button>
                    </div>
                    {shareFeedback ? (
                      <p
                        aria-live="polite"
                        className="mt-3 text-sm font-medium text-[#425B76]"
                      >
                        {shareFeedback}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {salesReadinessItems.map((item) => (
                    <div
                      className={[
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm",
                        item.complete
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-[#D8E8F0] bg-white",
                      ].join(" ")}
                      key={item.label}
                    >
                      <span
                        className={[
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          item.complete
                            ? "bg-emerald-500 text-white"
                            : "bg-[#E8F1F5] text-[#425B76]",
                        ].join(" ")}
                      >
                        {item.complete ? "OK" : "-"}
                      </span>
                      <span
                        className={
                          item.complete
                            ? "font-semibold text-emerald-900"
                            : "font-semibold text-[#425B76]"
                        }
                      >
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs font-medium leading-5 text-[#526A80]">
                  The public page lets visitors request enrollment. It does not
                  collect payment, generate invoices, or activate access.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-[#CFE3EC] bg-[#F6FBFE] text-[#0B2A3D]">
                {formatProgramPrice(course)}
              </Badge>
              <Badge
                className={
                  course.public_sales_enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-[#D8E8F0] bg-[#F8FAFC] text-[#526A80]"
                }
              >
                {course.public_sales_enabled
                  ? "Public page enabled"
                  : "Public page off"}
              </Badge>
              <Badge className="border-[#CFE3EC] bg-[#F6FBFE] text-[#0B2A3D]">
                {course.pricing_type === "free"
                  ? "No payment required"
                  : course.sales_payment_mode === "external"
                    ? "Coach payment link"
                    : "Coach handled"}
              </Badge>
            </div>
          </div>

          {salesFeedback ? (
            <div
              className={[
                "mt-5 rounded-2xl border p-4 text-sm font-medium",
                salesFeedback.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-700",
              ].join(" ")}
            >
              {salesFeedback.message}
            </div>
          ) : null}

          {salesForm ? (
            <form className="mt-6 grid gap-5" onSubmit={handleSalesSettingsSubmit}>
              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Pricing type
                  <select
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              pricingType: event.target.value as CoursePricingType,
                              priceAmount:
                                event.target.value === "free"
                                  ? ""
                                  : current.priceAmount,
                            }
                          : current,
                      )
                    }
                    value={salesForm.pricingType}
                  >
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Price amount
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:border-[#D8E8F0] disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={
                      !canManage ||
                      salesSaving ||
                      salesForm.pricingType === "free"
                    }
                    min="0"
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? { ...current, priceAmount: event.target.value }
                          : current,
                      )
                    }
                    placeholder="4999"
                    step="0.01"
                    type="number"
                    value={salesForm.pricingType === "free" ? "" : salesForm.priceAmount}
                  />
                </label>
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Currency
                  <select
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              salesCurrency: event.target.value as "INR",
                            }
                          : current,
                      )
                    }
                    value={salesForm.salesCurrency}
                  >
                    <option value="INR">INR</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <label className="flex min-h-24 items-start gap-3 rounded-2xl border border-[#CFE3EC] bg-[#F6FBFE] p-4 text-sm shadow-sm">
                  <input
                    checked={salesForm.publicSalesEnabled}
                    className="mt-1 h-4 w-4 accent-[#0B6B7A]"
                    disabled={!canManage || salesSaving}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              publicSalesEnabled: event.target.checked,
                            }
                          : current,
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block font-semibold text-[#0B1F33]">
                      Enable public request page
                    </span>
                    <span className="mt-1 block leading-6 text-[#526A80]">
                      For a published program, this allows students to review
                      the page and request enrollment.
                    </span>
                  </span>
                </label>
                {salesForm.pricingType === "paid" ? (
                  <label className="block text-sm font-semibold text-[#0B1F33] lg:col-span-2">
                    Payment guidance
                    <select
                      className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                      disabled={!canManage || salesSaving}
                      onChange={(event) =>
                        setSalesForm((current) =>
                          current
                            ? {
                                ...current,
                                externalPaymentUrl:
                                  event.target.value === "external"
                                    ? current.externalPaymentUrl
                                    : "",
                                salesPaymentMode:
                                  event.target.value as CourseSalesPaymentMode,
                              }
                            : current,
                        )
                      }
                      value={salesForm.salesPaymentMode}
                    >
                      <option value="manual">Instructions from coach</option>
                      <option value="external">Coach payment link</option>
                    </select>
                  </label>
                ) : (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800 lg:col-span-2">
                    This is a free program, so students will not see payment
                    instructions.
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Public page headline
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    maxLength={140}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? { ...current, salesHeadline: event.target.value }
                          : current,
                      )
                    }
                    placeholder="Transform your coaching outcome"
                    value={salesForm.salesHeadline}
                  />
                </label>
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Access duration label
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    maxLength={80}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              accessDurationLabel: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="Lifetime access, 12 weeks, or coach-led cohort"
                    value={salesForm.accessDurationLabel}
                  />
                </label>
              </div>

              <label className="block text-sm font-semibold text-[#0B1F33]">
                Public page summary
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-xl border border-[#BFD7E3] bg-white px-4 py-3 text-sm font-medium leading-6 text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                  disabled={!canManage || salesSaving}
                  maxLength={600}
                  onChange={(event) =>
                    setSalesForm((current) =>
                      current
                        ? { ...current, salesSummary: event.target.value }
                        : current,
                    )
                  }
                  placeholder="Describe who this program is for and what outcome students can expect."
                  value={salesForm.salesSummary}
                />
              </label>

              {salesForm.pricingType === "paid" ? (
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  Payment instructions
                  <textarea
                    className="mt-2 min-h-32 w-full resize-none rounded-xl border border-[#BFD7E3] bg-white px-4 py-3 text-sm font-medium leading-6 text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    maxLength={2000}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              paymentInstructions: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="Share bank transfer, UPI, or offline payment steps students should follow."
                    value={salesForm.paymentInstructions}
                  />
                </label>
              ) : null}

              {salesForm.pricingType === "paid" &&
              salesForm.salesPaymentMode === "external" ? (
                <label className="block text-sm font-semibold text-[#0B1F33]">
                  External payment URL
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-[#BFD7E3] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none placeholder:text-[#71839A] focus:border-[#2ECBEA]/80 focus:ring-4 focus:ring-[#2ECBEA]/15 disabled:bg-[#EEF4F7] disabled:text-[#66788F]"
                    disabled={!canManage || salesSaving}
                    maxLength={500}
                    onChange={(event) =>
                      setSalesForm((current) =>
                        current
                          ? {
                              ...current,
                              externalPaymentUrl: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="https://"
                    type="url"
                    value={salesForm.externalPaymentUrl}
                  />
                </label>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-[#D8E8F0] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium leading-6 text-[#425B76]">
                  Saving these settings does not collect payment, generate an
                  invoice, or activate student access.
                </p>
                {canManage ? (
                  <Button
                    className="bg-[#0B2A3D] text-white hover:bg-[#123A52]"
                    disabled={salesSaving}
                    type="submit"
                  >
                    {salesSaving ? "Saving..." : "Save public page settings"}
                  </Button>
                ) : (
                  <Badge className="border-[#D8E8F0] bg-[#F8FAFC] text-[#526A80]">
                    Read only
                  </Badge>
                )}
              </div>
            </form>
          ) : null}
        </Card>
      </section>

      {canManage ? (
        <section className="mt-6 scroll-mt-24" id="enrollment-requests">
          <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <Badge className="border-[#2ECBEA]/20 bg-[#2ECBEA]/10 text-[#A7F3FF]">
                  Requests
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  Recent enrollment requests
                </h3>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                  Requests submitted from this program&apos;s public page appear
                  here. Approve and enroll the student, then send portal access
                  when the enrollment is ready.
                </p>
              </div>
              <Badge className="border-white/10 bg-white/10 text-slate-200">
                {enrollmentRequests.length} recent
              </Badge>
            </div>

            <p className="mt-5 rounded-2xl border border-white/10 bg-[#15181b] px-4 py-3 text-sm leading-6 text-slate-300">
              A request does not create enrollment, record payment, or activate
              access automatically. Enrollment, portal access, and payment are
              separate states.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button href="/app/enrollments" size="sm" variant="secondary">
                Open enrollments
              </Button>
              <Button href="/app/finance" size="sm" variant="secondary">
                Open Student Finance
              </Button>
            </div>

            {requestFeedback ? (
              <div
                aria-live="polite"
                className={[
                  "mt-5 rounded-2xl border p-4 text-sm font-medium",
                  requestFeedback.tone === "success"
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                    : "border-red-400/30 bg-red-500/10 text-red-100",
                ].join(" ")}
              >
                {requestFeedback.message}
              </div>
            ) : null}

            {enrollmentRequestsLoading ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-[#15181b] p-5">
                <div className="h-5 w-44 animate-pulse rounded-full bg-white/10" />
                <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded-full bg-white/10" />
                <div className="mt-3 h-4 w-2/3 animate-pulse rounded-full bg-white/10" />
              </div>
            ) : enrollmentRequests.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-white/15 bg-[#15181b] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-slate-300">
                  RE
                </div>
                <h4 className="mt-5 text-xl font-semibold">
                  No enrollment requests for this program yet.
                </h4>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  When a visitor requests enrollment from this program&apos;s
                  public page, the latest requests will appear here for review.
                </p>
              </div>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {enrollmentRequests.map((request) => {
                  const lifecycleStatus =
                    request.enrollment_request_status ??
                    (request.status === "converted" ? "enrolled" : request.status);
                  const canReviewRequest =
                    canApproveRequests &&
                    (lifecycleStatus === "new" ||
                      lifecycleStatus === "needs_attention") &&
                    !request.converted_student_id &&
                    !request.converted_enrollment_id;
                  const isEnrolled = lifecycleStatus === "enrolled";
                  const invitationSummary = portalInvitationStatuses[request.id];
                  const canSendInvitation =
                    isEnrolled &&
                    Boolean(request.converted_student_id) &&
                    Boolean(request.converted_enrollment_id) &&
                    invitationSummary !== null &&
                    (invitationSummary?.status === "invitation_not_sent" ||
                      invitationSummary?.status === "invitation_expired" ||
                      (invitationSummary?.status === "needs_attention" &&
                        invitationSummary.can_resend));
                  const isResend =
                    invitationSummary?.status === "invitation_expired";
                  const isRetry =
                    invitationSummary?.status === "needs_attention";

                  return (
                    <article
                      className="rounded-3xl border border-white/10 bg-[#15181b] p-5"
                      key={request.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold text-white">
                            {request.name}
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {formatDate(request.created_at)}
                          </p>
                        </div>
                        <Badge
                          className={
                            isEnrolled
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                              : lifecycleStatus === "rejected"
                                ? "border-white/10 bg-white/10 text-slate-300"
                                : "border-[#2ECBEA]/20 bg-[#2ECBEA]/10 text-[#A7F3FF]"
                          }
                        >
                          {lifecycleStatus.replace("_", " ")}
                        </Badge>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className="border-white/10 bg-white/10 text-slate-300">
                          {getLeadSourceLabel(request.source)}
                        </Badge>
                        {request.email ? (
                          <span className="max-w-full truncate rounded-full border border-white/10 bg-[#101214] px-3 py-1 text-xs font-semibold text-slate-300">
                            {request.email}
                          </span>
                        ) : null}
                        {request.phone ? (
                          <span className="rounded-full border border-white/10 bg-[#101214] px-3 py-1 text-xs font-semibold text-slate-300">
                            {request.phone}
                          </span>
                        ) : null}
                      </div>

                      {request.message ? (
                        <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-300">
                          {request.message}
                        </p>
                      ) : (
                        <p className="mt-4 text-sm leading-6 text-slate-500">
                          No message or goal was included.
                        </p>
                      )}

                      <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs leading-5 text-slate-500">
                          {isEnrolled
                            ? "Student enrollment is active. Portal access is managed separately."
                            : lifecycleStatus === "rejected"
                              ? "Closed requests are not available for approval."
                              : "Review is required before the student is enrolled."}
                          </p>
                          {isEnrolled ? (
                            <p className="mt-2 text-sm font-semibold text-slate-200">
                              {getInvitationStatusCopy(invitationSummary)}
                            </p>
                          ) : null}
                        </div>
                        {canReviewRequest ? (
                          <Button
                            className="shrink-0 bg-teal-400 text-black hover:bg-teal-300"
                            onClick={() => openReviewRequest(request)}
                            size="sm"
                            type="button"
                          >
                            Review request
                          </Button>
                        ) : null}
                        {canSendInvitation ? (
                          <Button
                            className="shrink-0 bg-teal-400 text-black hover:bg-teal-300"
                            isLoading={portalInvitationSavingId === request.id}
                            loadingText={
                              isRetry
                                ? "Retrying..."
                                : isResend
                                  ? "Resending..."
                                  : "Sending..."
                            }
                            onClick={() => handleSendPortalInvitation(request)}
                            size="sm"
                            type="button"
                          >
                            {isRetry
                              ? "Retry invitation"
                              : isResend
                                ? "Resend invitation"
                                : "Send invitation"}
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </section>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Program structure
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Sections and lessons
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Organize the program into ordered sections and lesson assets.
              </p>
            </div>
            <Button
              className="bg-teal-400 text-black hover:bg-teal-300"
              onClick={() => setSectionModal({ mode: "create", title: "" })}
              type="button"
            >
              Add Section
            </Button>
          </div>

          {sections.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                01
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No sections yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Add your first section to start building the program structure.
                Lessons can be added inside each section.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-5">
              {sections.map((section, sectionIndex) => (
                <div
                  className="rounded-3xl border border-white/10 bg-[#15181b] p-5"
                  key={section.id}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        Section {sectionIndex + 1}
                      </p>
                      <h4 className="mt-2 text-xl font-semibold">
                        {section.title}
                      </h4>
                      <p className="mt-2 text-sm text-slate-500">
                        {section.lessons.length}{" "}
                        {section.lessons.length === 1 ? "lesson" : "lessons"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="bg-teal-400 text-black hover:bg-teal-300"
                        onClick={() => openCreateLesson(section.id)}
                        size="sm"
                        type="button"
                      >
                        Add Lesson
                      </Button>
                      <Button
                        className="border-white/15 bg-transparent text-white hover:bg-white/10"
                        onClick={() =>
                          setSectionModal({
                            mode: "edit",
                            sectionId: section.id,
                            title: section.title,
                          })
                        }
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Edit
                      </Button>
                      {canDelete ? (
                        <Button
                          className="text-red-200 hover:bg-red-500/10 hover:text-red-100"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "section",
                              sectionId: section.id,
                              title: section.title,
                            })
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {section.lessons.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#101214] p-5 text-sm text-slate-500">
                      No lessons in this section yet.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {section.lessons.map((lesson, lessonIndex) => (
                        <div
                          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#15181b] p-4 sm:flex-row sm:items-center sm:justify-between"
                          key={lesson.id}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-slate-500">
                                {String(lessonIndex + 1).padStart(2, "0")}
                              </span>
                              <Badge className="border-white/10 bg-white/10 text-slate-300">
                                {lesson.lesson_type}
                              </Badge>
                              {lesson.is_preview ? (
                                <Badge tone="success">Preview</Badge>
                              ) : null}
                            </div>
                            <h5 className="mt-3 truncate text-base font-semibold">
                              {lesson.title}
                            </h5>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                              {lesson.content ||
                                lesson.video_url ||
                                lesson.resource_url ||
                                "No lesson content added yet."}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              className="border-white/15 bg-transparent text-white hover:bg-white/10"
                              onClick={() => openEditLesson(lesson)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Edit
                            </Button>
                            {canDelete ? (
                              <Button
                                className="text-red-200 hover:bg-red-500/10 hover:text-red-100"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "lesson",
                                    lessonId: lesson.id,
                                    sectionId: section.id,
                                    title: lesson.title,
                                  })
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 md:col-span-2">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Enrolled Students
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Program enrollment roster
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Enrollments are managed from each student profile. Open a
                student profile to add this program or adjust enrollment status.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button href="/app/students" size="sm" variant="secondary">
                View Students
              </Button>
              <Button href="/app/enrollments" size="sm" variant="secondary">
                Enrollment Overview
              </Button>
              {canApproveRequests ? (
                <Button href="/app/finance" size="sm" variant="secondary">
                  Open Student Finance
                </Button>
              ) : null}
              <div className="rounded-full border border-white/10 bg-[#101214] px-4 py-2 text-sm text-slate-300">
                {enrollments.length} enrolled
              </div>
            </div>
          </div>

          {enrollments.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-[#101214] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
                EN
              </div>
              <h4 className="mt-5 text-xl font-semibold">
                No enrolled students yet
              </h4>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                Add a student, then open that student profile to enroll them in
                this program. The enrollment overview lists records after they
                exist.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button href="/app/students" size="sm">
                  View Students
                </Button>
                <Button href="/app/enrollments" size="sm" variant="secondary">
                  Open Enrollment Overview
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
              {enrollments.map((enrollment) => (
                <div
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-center"
                  key={enrollment.id}
                >
                  <div>
                    <p className="font-semibold">
                      {enrollment.student?.full_name ?? "Student unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {enrollment.student?.email ||
                        enrollment.student?.phone ||
                        "No contact details"}
                    </p>
                  </div>
                  <p className="text-sm text-slate-400">
                    Enrolled {formatDate(enrollment.enrolled_at)}
                  </p>
                  <EnrollmentStatusBadge status={enrollment.status} />
                  {canApproveRequests ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                      <p className="leading-5">
                        Use Student Finance to record coach-managed payments,
                        create invoices, and issue receipts for this enrollment.
                      </p>
                      <Button
                        className="mt-3"
                        href="/app/finance"
                        size="sm"
                        variant="secondary"
                      >
                        Open Student Finance
                      </Button>
                    </div>
                  ) : null}
                  <Link
                    className="text-sm font-semibold text-white transition hover:text-slate-300"
                    href={`/app/students/${enrollment.student_id}`}
                  >
                    View student
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        {[
          {
            detail:
              "Use the program structure above to prepare the learning path before launch.",
            title: "Lessons",
          },
          {
            detail:
              "Publishing checks, previews, and launch workflows can build on this structure later.",
            title: "Publishing readiness",
          },
        ].map((item, index) => (
          <Card
            className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10"
            key={item.title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {item.detail}
            </p>
          </Card>
        ))}
      </section>

      {reviewModal && canApproveRequests ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Badge className="border-[#2ECBEA]/20 bg-[#2ECBEA]/10 text-[#A7F3FF]">
                  Enrollment request
                </Badge>
                <h3 className="mt-4 text-2xl font-semibold">
                  Review enrollment request
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Review the request, match or create the student, and create
                  the program enrollment. Payment and portal access remain
                  separate.
                </p>
              </div>
              <Badge className="border-white/10 bg-white/10 text-slate-300">
                {getLeadSourceLabel(reviewModal.request.source)}
              </Badge>
            </div>

            <div className="mt-6 grid gap-4 rounded-3xl border border-white/10 bg-[#15181b] p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Request
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {reviewModal.request.name}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {formatDate(reviewModal.request.created_at)}
                </p>
              </div>
              <div className="space-y-2 text-sm text-slate-300">
                <p>{reviewModal.request.email || "No email provided"}</p>
                <p>{reviewModal.request.phone || "No phone provided"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Message
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {reviewModal.request.message ||
                    "No message or goal was included."}
                </p>
              </div>
            </div>

            {reviewModal.error ? (
              <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm font-medium text-red-100">
                {reviewModal.error}
              </div>
            ) : null}

            <form className="mt-6 space-y-6" onSubmit={handleApproveRequestSubmit}>
              <section className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
                <h4 className="text-lg font-semibold text-white">Student</h4>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label
                    className={[
                      "flex cursor-pointer gap-3 rounded-2xl border p-4 text-sm transition",
                      reviewModal.studentAction === "create"
                        ? "border-teal-400/40 bg-teal-400/10 text-white"
                        : "border-white/10 bg-[#101214] text-slate-300",
                    ].join(" ")}
                  >
                    <input
                      checked={reviewModal.studentAction === "create"}
                      className="mt-1 h-4 w-4 accent-teal-400"
                      onChange={() =>
                        setReviewModal((current) =>
                          current
                            ? { ...current, studentAction: "create" }
                            : current,
                        )
                      }
                      type="radio"
                    />
                    <span>
                      <span className="block font-semibold">
                        Match using request details
                      </span>
                      <span className="mt-1 block leading-6 text-slate-400">
                        CoachFort reuses a matching student by email, or creates
                        one when no safe match exists. It does not create a login.
                      </span>
                    </span>
                  </label>

                  <label
                    className={[
                      "flex cursor-pointer gap-3 rounded-2xl border p-4 text-sm transition",
                      reviewModal.studentAction === "existing"
                        ? "border-teal-400/40 bg-teal-400/10 text-white"
                        : "border-white/10 bg-[#101214] text-slate-300",
                    ].join(" ")}
                  >
                    <input
                      checked={reviewModal.studentAction === "existing"}
                      className="mt-1 h-4 w-4 accent-teal-400"
                      onChange={() =>
                        setReviewModal((current) =>
                          current
                            ? { ...current, studentAction: "existing" }
                            : current,
                        )
                      }
                      type="radio"
                    />
                    <span>
                      <span className="block font-semibold">
                        Choose an existing active student
                      </span>
                      <span className="mt-1 block leading-6 text-slate-400">
                        Use this when the learner already exists in this
                        workspace.
                      </span>
                    </span>
                  </label>
                </div>

                {reviewModal.studentAction === "create" ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <label className="block text-sm font-semibold text-slate-200">
                      Student name
                      <input
                        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101214] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                        maxLength={160}
                        onChange={(event) =>
                          setReviewModal((current) =>
                            current
                              ? { ...current, studentName: event.target.value }
                              : current,
                          )
                        }
                        required
                        value={reviewModal.studentName}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-200">
                      Email
                      <input
                        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101214] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                        maxLength={254}
                        onChange={(event) =>
                          setReviewModal((current) =>
                            current
                              ? { ...current, studentEmail: event.target.value }
                              : current,
                          )
                        }
                        type="email"
                        value={reviewModal.studentEmail}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-200">
                      Phone
                      <input
                        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101214] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                        maxLength={40}
                        onChange={(event) =>
                          setReviewModal((current) =>
                            current
                              ? { ...current, studentPhone: event.target.value }
                              : current,
                          )
                        }
                        value={reviewModal.studentPhone}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="mt-5">
                    {studentCandidatesLoading ? (
                      <div className="rounded-2xl border border-white/10 bg-[#101214] p-4 text-sm text-slate-400">
                        Loading active students...
                      </div>
                    ) : studentCandidates.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/15 bg-[#101214] p-5 text-sm leading-6 text-slate-400">
                        No active students found. Create a new internal student
                        instead.
                      </div>
                    ) : (
                      <label className="block text-sm font-semibold text-slate-200">
                        Active student
                        <select
                          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101214] px-4 text-sm text-white outline-none focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                          onChange={(event) =>
                            setReviewModal((current) =>
                              current
                                ? {
                                    ...current,
                                    existingStudentId: event.target.value,
                                  }
                                : current,
                            )
                          }
                          required
                          value={reviewModal.existingStudentId}
                        >
                          <option value="">Select active student</option>
                          {studentCandidates.map((student) => (
                            <option key={student.id} value={student.id}>
                              {student.full_name}
                              {student.email ? ` - ${student.email}` : ""}
                              {!student.email && student.phone
                                ? ` - ${student.phone}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-white/10 bg-[#15181b] p-5">
                <h4 className="text-lg font-semibold text-white">
                  Enrollment note
                </h4>
                <label className="mt-4 block text-sm font-semibold text-slate-200">
                  Internal note
                  <textarea
                    className="mt-2 min-h-24 w-full resize-none rounded-xl border border-white/10 bg-[#101214] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-teal-400/50 focus:ring-4 focus:ring-teal-400/10"
                    maxLength={1000}
                    onChange={(event) =>
                      setReviewModal((current) =>
                        current
                          ? { ...current, conversionNote: event.target.value }
                          : current,
                      )
                    }
                    placeholder="Optional approval context for the team."
                    value={reviewModal.conversionNote}
                  />
                </label>
              </section>

              <div className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5 text-sm leading-6 text-amber-50">
                <p className="font-semibold">Approval warning</p>
                <p className="mt-2">
                  Approving creates or reuses the student and program enrollment.
                  It does not record payment, create a login account, send an
                  invitation, or activate portal access.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setReviewModal(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  className="bg-teal-400 text-black hover:bg-teal-300"
                  disabled={reviewSaving}
                  type="submit"
                >
                  {reviewSaving ? "Approving..." : "Approve & enroll"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {sectionModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-lg border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">
              {sectionModal.mode === "edit" ? "Edit section" : "Add Section"}
            </h3>
            <form className="mt-6 space-y-5" onSubmit={handleSectionSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Section title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setSectionModal({
                      ...sectionModal,
                      title: event.target.value,
                    })
                  }
                  placeholder="Welcome and foundations"
                  required
                  type="text"
                  value={sectionModal.title}
                />
              </label>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setSectionModal(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save section"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {lessonModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">
              {lessonModal.mode === "edit" ? "Edit lesson" : "Add Lesson"}
            </h3>
            <form className="mt-6 space-y-5" onSubmit={handleLessonSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Lesson title
                </span>
                <input
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      title: event.target.value,
                    })
                  }
                  placeholder="Lesson title"
                  required
                  type="text"
                  value={lessonModal.title}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Lesson type
                </span>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      lessonType: event.target.value as LessonType,
                    })
                  }
                  value={lessonModal.lessonType}
                >
                  {lessonTypes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-300">
                  Content
                </span>
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      content: event.target.value,
                    })
                  }
                  placeholder="Add lesson notes, prompt, or instructions."
                  value={lessonModal.content}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Video URL
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setLessonModal({
                        ...lessonModal,
                        videoUrl: event.target.value,
                      })
                    }
                    placeholder="https://..."
                    type="url"
                    value={lessonModal.videoUrl}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">
                    Resource URL
                  </span>
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
                    onChange={(event) =>
                      setLessonModal({
                        ...lessonModal,
                        resourceUrl: event.target.value,
                      })
                    }
                    placeholder="https://..."
                    type="url"
                    value={lessonModal.resourceUrl}
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 p-4">
                <input
                  checked={lessonModal.isPreview}
                  className="h-5 w-5 rounded border-white/20 accent-teal-400"
                  onChange={(event) =>
                    setLessonModal({
                      ...lessonModal,
                      isPreview: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span className="text-sm font-medium text-slate-300">
                  Preview lesson
                </span>
              </label>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setLessonModal(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save lesson"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {deleteTarget && canDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-300">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Delete {deleteTarget.title}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {deleteTarget.kind === "section"
                ? "This will also remove the lessons inside this section through the database cascade."
                : "This lesson will be removed from the program structure."}
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setDeleteTarget(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-500 shadow-red-950/30 hover:bg-red-600"
                disabled={mutating}
                onClick={handleDeleteConfirm}
                type="button"
              >
                {mutating ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
