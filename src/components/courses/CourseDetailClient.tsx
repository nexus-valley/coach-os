"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EnrollmentStatusBadge } from "@/src/components/enrollments/EnrollmentStatusBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  createCourseSection,
  createLesson,
  deleteCourseSection,
  deleteLesson,
  getCourseById,
  getCourseStructure,
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

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function CourseDetailClient({ courseId }: CourseDetailClientProps) {
  const [actionError, setActionError] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>([]);
  const [error, setError] = useState("");
  const [lessonModal, setLessonModal] = useState<LessonModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [salesFeedback, setSalesFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [salesForm, setSalesForm] = useState<SalesSettingsForm | null>(null);
  const [salesSaving, setSalesSaving] = useState(false);
  const [sectionModal, setSectionModal] = useState<SectionModalState | null>(
    null,
  );
  const [sections, setSections] = useState<CourseSectionWithLessons[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const canDelete = canDeleteRecords(currentRole);
  const canManage = canManageCourses(currentRole);

  useEffect(() => {
    let active = true;

    async function loadCourse() {
      try {
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

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourse(currentCourse);
        setSalesForm(currentCourse ? createSalesSettingsForm(currentCourse) : null);
        setCurrentRole(memberRole);
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
        }
      }
    }

    loadCourse();

    return () => {
      active = false;
    };
  }, [courseId]);

  async function refreshStructure() {
    if (!tenant) {
      return;
    }

    setSections(await getCourseStructure(courseId, tenant.id));
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
        message: "Sales settings saved.",
        tone: "success",
      });
    } catch (caught) {
      setSalesFeedback({
        message: getErrorMessage(caught, "Unable to save sales settings."),
        tone: "error",
      });
    } finally {
      setSalesSaving(false);
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
  const publicSalesReady =
    Boolean(publicProgramPath) &&
    course.status === "published" &&
    course.public_sales_enabled;
  const salesReadinessItems = [
    {
      complete: course.status === "published",
      label: "Publish program",
    },
    {
      complete: course.public_sales_enabled,
      label: "Enable public sales page",
    },
    {
      complete: Boolean(
        course.sales_headline?.trim() || course.sales_summary?.trim(),
      ),
      label: "Add sales headline or summary",
    },
    {
      complete: Boolean(
        course.payment_instructions?.trim() ||
          (course.sales_payment_mode === "external" &&
            course.external_payment_url?.trim()),
      ),
      label: "Add payment guidance",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-slate-400 transition hover:text-white"
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
            <CourseStatusBadge status={course.status} />
          </div>

          <p className="mt-6 max-w-3xl text-base leading-7 text-slate-400">
            {course.description || "No description added yet."}
          </p>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-slate-500">Workspace</p>
              <p className="mt-2 font-semibold">{tenant?.name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Slug</p>
              <p className="mt-2 font-semibold">/{course.slug}</p>
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

      {actionError ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {actionError}
        </div>
      ) : null}

      <section className="mt-6">
        <Card className="border-white/10 bg-[#101214] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div>
              <Badge className="border-[#2ECBEA]/20 bg-[#2ECBEA]/10 text-[#A7F3FF]">
                Sales settings
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold">
                Program sales readiness
              </h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                Set the public sales copy, price, and payment instructions for
                this program. Online checkout is not enabled yet. Use manual
                instructions or an external payment link for now.
              </p>
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#15181b] p-4">
                <p className="text-sm font-semibold text-white">
                  Public program link
                </p>
                {publicSalesReady ? (
                  <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <p className="break-all rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100">
                      {publicProgramPath}
                    </p>
                    <Button
                      className="shrink-0 border-white/15 bg-transparent text-white hover:bg-white/10"
                      href={publicProgramPath}
                      size="sm"
                      variant="secondary"
                    >
                      Open public page
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {salesReadinessItems.map((item) => (
                      <div
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#101214] px-4 py-3 text-sm"
                        key={item.label}
                      >
                        <span
                          className={[
                            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                            item.complete
                              ? "bg-emerald-400 text-[#052E1A]"
                              : "bg-white/10 text-slate-400",
                          ].join(" ")}
                        >
                          {item.complete ? "OK" : "-"}
                        </span>
                        <span
                          className={
                            item.complete ? "text-slate-200" : "text-slate-400"
                          }
                        >
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  The public page lets visitors request enrollment. It does not
                  collect payment, generate invoices, or activate access.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-white/10 bg-white/10 text-slate-200">
                {formatProgramPrice(course)}
              </Badge>
              <Badge
                className={
                  course.public_sales_enabled
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                    : "border-white/10 bg-white/10 text-slate-300"
                }
              >
                {course.public_sales_enabled ? "Public sales on" : "Sales off"}
              </Badge>
              <Badge className="border-white/10 bg-white/10 text-slate-300">
                {course.sales_payment_mode === "external" ? "External" : "Manual"}
              </Badge>
            </div>
          </div>

          {salesFeedback ? (
            <div
              className={[
                "mt-5 rounded-2xl border p-4 text-sm font-medium",
                salesFeedback.tone === "success"
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                  : "border-red-400/30 bg-red-500/10 text-red-100",
              ].join(" ")}
            >
              {salesFeedback.message}
            </div>
          ) : null}

          {salesForm ? (
            <form className="mt-6 grid gap-5" onSubmit={handleSalesSettingsSubmit}>
              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block text-sm font-semibold text-slate-200">
                  Pricing type
                  <select
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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
                <label className="block text-sm font-semibold text-slate-200">
                  Price amount
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10 disabled:text-slate-500"
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
                <label className="block text-sm font-semibold text-slate-200">
                  Currency
                  <select
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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
                <label className="flex min-h-24 items-start gap-3 rounded-2xl border border-white/10 bg-[#15181b] p-4 text-sm">
                  <input
                    checked={salesForm.publicSalesEnabled}
                    className="mt-1 h-4 w-4"
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
                    <span className="block font-semibold text-white">
                      Enable public sales page
                    </span>
                    <span className="mt-1 block leading-6 text-slate-400">
                      Marks this program ready for a future public sales page.
                    </span>
                  </span>
                </label>
                <label className="block text-sm font-semibold text-slate-200 lg:col-span-2">
                  Payment mode
                  <select
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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
                    <option value="manual">Manual instructions</option>
                    <option value="external">External payment link</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-200">
                  Sales headline
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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
                <label className="block text-sm font-semibold text-slate-200">
                  Access duration label
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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

              <label className="block text-sm font-semibold text-slate-200">
                Sales summary
                <textarea
                  className="mt-2 min-h-28 w-full resize-none rounded-xl border border-white/10 bg-[#15181b] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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

              <label className="block text-sm font-semibold text-slate-200">
                Payment instructions
                <textarea
                  className="mt-2 min-h-32 w-full resize-none rounded-xl border border-white/10 bg-[#15181b] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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

              {salesForm.salesPaymentMode === "external" ? (
                <label className="block text-sm font-semibold text-slate-200">
                  External payment URL
                  <input
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#15181b] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#2ECBEA]/60 focus:ring-4 focus:ring-[#2ECBEA]/10"
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

              <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-slate-400">
                  Saving these settings does not collect payment, generate an
                  invoice, or activate student access.
                </p>
                {canManage ? (
                  <Button
                    className="bg-teal-400 text-black hover:bg-teal-300"
                    disabled={salesSaving}
                    type="submit"
                  >
                    {salesSaving ? "Saving..." : "Save Sales Settings"}
                  </Button>
                ) : (
                  <Badge className="border-white/10 bg-white/10 text-slate-300">
                    Read only
                  </Badge>
                )}
              </div>
            </form>
          ) : null}
        </Card>
      </section>

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
                  className="grid gap-4 bg-[#101214] p-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center"
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
