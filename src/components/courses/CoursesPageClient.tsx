"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import {
  createCourse,
  getCoursesForTenant,
  type Course,
  type CreateCourseInput,
} from "@/src/lib/courses";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  canManageCourses,
  getCurrentMemberRole,
  type MemberRole,
} from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type CourseFormStatus = CreateCourseInput["status"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: Course["status"] }) {
  if (status === "published") {
    return <Badge tone="success">Published</Badge>;
  }

  return (
    <Badge className="border-amber-200 bg-amber-50 text-amber-800">Draft</Badge>
  );
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

function getPaymentModeLabel(course: Course) {
  if (course.pricing_type === "free") {
    return "No payment required";
  }

  return course.sales_payment_mode === "external"
    ? "Coach payment link"
    : "Coach handled";
}

function isPublicProgramAvailable(course: Course) {
  return course.status === "published" && course.public_sales_enabled;
}

function hasStudentFacingSummary(course: Course) {
  return Boolean(
    course.sales_headline?.trim() ||
      course.sales_summary?.trim() ||
      course.description?.trim(),
  );
}

function hasPaymentGuidance(course: Course) {
  return (
    course.pricing_type === "free" ||
    Boolean(
      course.payment_instructions?.trim() ||
        (course.sales_payment_mode === "external" &&
          course.external_payment_url?.trim()),
    )
  );
}

function isPublicProgramReady(course: Course) {
  return (
    isPublicProgramAvailable(course) &&
    hasStudentFacingSummary(course) &&
    hasPaymentGuidance(course)
  );
}

function getPublicProgramStatus(course: Course) {
  if (course.status !== "published") {
    return "Private draft";
  }

  if (!course.public_sales_enabled) {
    return "Public request page off";
  }

  return isPublicProgramReady(course)
    ? "Ready to share"
    : "Public page needs review";
}

function getProgramNextStep(course: Course, canManage: boolean) {
  if (!canManage) {
    return isPublicProgramAvailable(course)
      ? "Preview the student page or review the program details."
      : "Review the program details; an owner or admin manages public visibility.";
  }

  if (course.status !== "published") {
    return "This draft is private. Complete its details before publishing.";
  }

  if (!course.public_sales_enabled) {
    return "Configure the public request page before sharing.";
  }

  if (!isPublicProgramReady(course)) {
    return "Complete the student summary and payment guidance, then preview the page.";
  }

  return "Preview the student page, copy its link, and review new requests.";
}

export function CoursesPageClient() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CourseFormStatus>("draft");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let active = true;

    async function loadCourses() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const [tenantCourses, role] = await Promise.all([
          getCoursesForTenant(currentTenant.id),
          user ? getCurrentMemberRole(currentTenant.id, user.id) : null,
        ]);

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setCourses(tenantCourses);
        setCurrentRole(role);
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load programs right now.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCourses();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleCreateCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    if (!title.trim()) {
      setFormError("Program title is required.");
      return;
    }

    setSaving(true);
    setError("");
    setFormError("");

    try {
      const course = await createCourse({
        description,
        status,
        tenantId: tenant.id,
        title,
      });

      setFormOpen(false);
      setDescription("");
      setStatus("draft");
      setTitle("");
      router.push(`/app/courses/${course.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create program. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canManage = canManageCourses(currentRole);
  const publishedCourses = courses.filter((course) => course.status === "published")
    .length;
  const draftCourses = courses.filter((course) => course.status === "draft").length;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge tone="owner">Programs</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Create, publish, and share programs
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Build each coaching offer, prepare the page students will see, and
            follow enrollment requests through to access.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setFormOpen(true)} size="lg" type="button">
            Create program
          </Button>
        ) : null}
      </div>

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-[#5D7185]">Current workspace</p>
            <p className="mt-1 text-xl font-semibold">
              {tenant?.name ?? "Loading workspace..."}
            </p>
            <p className="mt-3 text-sm leading-6 text-[#425B76]">
              Open a program to prepare its public request page, preview what
              students will see, and review enrollment requests.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-4">
              <p className="text-2xl font-semibold">{courses.length}</p>
              <p className="mt-1 text-sm text-[#5D7185]">Total programs</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-2xl font-semibold text-emerald-800">
                {publishedCourses}
              </p>
              <p className="mt-1 text-sm text-emerald-700">Published</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-2xl font-semibold text-amber-800">
                {draftCourses}
              </p>
              <p className="mt-1 text-sm text-amber-700">Private drafts</p>
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => window.location.reload()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card
              className="border-[#D8E8F0] bg-white p-6"
              key={item}
            >
              <span className="sr-only">Loading program</span>
              <Skeleton className="h-6 w-24 bg-[#D8E8F0]" />
              <Skeleton className="mt-8 h-8 w-3/4 bg-[#D8E8F0]" />
              <Skeleton className="mt-5 h-4 w-full bg-[#D8E8F0]" />
              <Skeleton className="mt-3 h-4 w-5/6 bg-[#D8E8F0]" />
              <Skeleton className="mt-10 h-10 w-full bg-[#D8E8F0]" />
            </Card>
          ))}
        </section>
      ) : courses.length === 0 ? (
        <Card className="mt-6 border-dashed border-[#BFD7E6] bg-white p-7 text-center text-[#0B1F33] shadow-sm sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[#EAF7FC] text-sm font-bold text-[#0E7490]">
            01
          </div>
          <h2 className="mt-5 text-2xl font-semibold">Create your first program</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#425B76]">
            Start with the offer students will request. After creation, add the
            public summary, pricing or payment guidance, and shareable page.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            {canManage ? (
              <Button onClick={() => setFormOpen(true)} type="button">
                Create program
              </Button>
            ) : null}
            {canManage ? (
              <Button
                href="/app/settings/public-site"
                type="button"
                variant="secondary"
              >
                Configure public page
              </Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <section className="mt-6">
          <SectionHeader
            actions={
              draftCourses > 0 ? (
                <Badge tone="warning">{draftCourses} drafts</Badge>
              ) : (
                <Badge tone="success">All programs published</Badge>
              )
            }
            className="mb-4"
            description={
              <span className="text-[#425B76]">
                Open a program to prepare its public page, preview the student
                experience, and follow enrollment requests.
              </span>
            }
            title={<span className="text-[#0B1F33]">Your programs</span>}
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => {
              const publicAvailable = isPublicProgramAvailable(course);
              const publicReady = isPublicProgramReady(course);
              const publicProgramPath = tenant
                ? `/site/${tenant.slug}/programs/${course.slug}`
                : "";

              return (
                <Card
                  className="h-full border-[#D8E8F0] bg-white p-5 text-[#0B1F33] shadow-sm shadow-[#0B2A3D]/5"
                  key={course.id}
                >
                  <article className="flex h-full min-h-72 flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <StatusBadge status={course.status} />
                        <span className="text-xs text-[#71839A]">
                          {formatDate(course.created_at)}
                        </span>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <Badge className="border-[#A9E7F2] bg-[#EAFBFE] text-[#075E6F]">
                          {formatProgramPrice(course)}
                        </Badge>
                        <Badge
                          className={
                            publicReady
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-[#D8E8F0] bg-[#F6FBFE] text-[#526A80]"
                          }
                        >
                          {getPublicProgramStatus(course)}
                        </Badge>
                        <Badge className="border-[#D8E8F0] bg-[#F6FBFE] text-[#526A80]">
                          {getPaymentModeLabel(course)}
                        </Badge>
                      </div>
                      <h3 className="mt-6 text-2xl font-semibold leading-tight">
                        {course.title}
                      </h3>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#425B76]">
                        {course.description || "No description added yet."}
                      </p>
                      <p className="mt-4 rounded-lg border border-[#D8E8F0] bg-[#F6FBFE] p-3 text-sm leading-6 text-[#425B76]">
                        <span className="font-semibold text-[#0B1F33]">Next:</span>{" "}
                        {getProgramNextStep(course, canManage)}
                      </p>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-2 border-t border-[#D8E8F0] pt-5">
                      <Button href={`/app/courses/${course.id}`} size="sm">
                        {canManage ? "Manage program" : "View program"}
                      </Button>
                      {publicAvailable && publicProgramPath ? (
                        <Button
                          href={publicProgramPath}
                          size="sm"
                          variant="secondary"
                        >
                          Preview student page
                        </Button>
                      ) : canManage ? (
                        <Button
                          href={`/app/courses/${course.id}#public-program-setup`}
                          size="sm"
                          variant="secondary"
                        >
                          Prepare public page
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Link
                          className="inline-flex h-10 items-center px-2 text-sm font-semibold text-[#145DA0] hover:underline"
                          href={`/app/courses/${course.id}#enrollment-requests`}
                        >
                          Review requests
                        </Link>
                      ) : null}
                    </div>
                  </article>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#475569]">
                  New program
                </p>
                <h3 className="mt-2 text-2xl font-semibold">Create a program</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#5D7185]">
                  Start private while preparing details, or publish immediately
                  only when the program is ready to appear on your public page.
                </p>
              </div>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#CBD5E1] text-sm font-semibold text-[#475569] transition hover:bg-[#F8FAFC] hover:text-[#0B1F33]"
                onClick={() => setFormOpen(false)}
                type="button"
              >
                X
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleCreateCourse}>
              <FormField
                error={formError}
                htmlFor="course-title"
                label="Program title"
                required
              >
                <input
                  id="course-title"
                  className="mt-2 h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Signature coaching program"
                  required
                  type="text"
                  value={title}
                />
              </FormField>

              <FormField
                htmlFor="course-description"
                label="Description"
              >
                <textarea
                  id="course-description"
                  className="mt-2 min-h-32 w-full resize-none rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition placeholder:text-[#64748B] focus:border-[#145DA0]/60 focus:ring-4 focus:ring-[#145DA0]/10"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the promise, audience, and outcome."
                  value={description}
                />
              </FormField>

              <FormField label="Starting visibility">
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] p-1">
                  {(["draft", "published"] as const).map((item) => (
                    <button
                      className={[
                        "h-11 rounded-lg text-sm font-semibold transition",
                        status === item
                          ? "bg-[#145DA0] text-white shadow-sm shadow-[#145DA0]/20"
                          : "text-[#475569] hover:bg-white hover:text-[#0B1F33]",
                      ].join(" ")}
                      key={item}
                      onClick={() => setStatus(item)}
                      type="button"
                    >
                      {item === "draft" ? "Draft" : "Published"}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5 text-[#5D7185]">
                  Draft stays private. Published makes the program eligible for
                  public display; its request page still needs separate setup.
                </p>
              </FormField>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={saving} type="submit">
                  {saving ? "Creating..." : "Create program"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
