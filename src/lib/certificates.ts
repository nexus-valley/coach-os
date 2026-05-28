import { logActivity } from "@/src/lib/auditLogger";
import { runAutomationTrigger } from "@/src/lib/automationTriggers";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CourseCompletionStatus = {
  completed_lessons: number;
  is_completed: boolean;
  progress_percentage: number;
  total_lessons: number;
};

export type CertificateData = {
  certificate_number: string;
  completion_date: string;
  course_title: string;
  enrollment_id: string;
  student_name: string;
  tenant_id: string;
};

const enrollmentSelect =
  "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at";

function formatCertificateSequence(value: number) {
  return String(value).padStart(4, "0");
}

function getProgressPercentage(completed: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((completed / total) * 100);
}

export async function getCourseCompletionStatus(
  studentId: string,
  courseId: string,
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const [lessonsResult, progressResult] = await Promise.all([
    supabase
      .from("lessons")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId),
    supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .eq("status", "completed"),
  ]);

  if (lessonsResult.error) {
    throw lessonsResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  const totalLessons = lessonsResult.data?.length ?? 0;
  const completedLessons = progressResult.data?.length ?? 0;
  const progressPercentage = getProgressPercentage(
    completedLessons,
    totalLessons,
  );

  return {
    completed_lessons: completedLessons,
    is_completed: totalLessons > 0 && completedLessons >= totalLessons,
    progress_percentage: progressPercentage,
    total_lessons: totalLessons,
  } satisfies CourseCompletionStatus;
}

export async function syncEnrollmentCompletion(
  studentId: string,
  courseId: string,
  tenantId: string,
) {
  const completionStatus = await getCourseCompletionStatus(
    studentId,
    courseId,
    tenantId,
  );

  if (!completionStatus.is_completed) {
    return completionStatus;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("enrollments")
    .update({
      completed_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .neq("status", "completed");

  if (error) {
    throw error;
  }

  return completionStatus;
}

export async function generateCertificateData(
  enrollmentId: string,
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const { data: enrollment, error: enrollmentError } = await supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", tenantId)
    .eq("id", enrollmentId)
    .maybeSingle();

  if (enrollmentError) {
    throw enrollmentError;
  }

  if (!enrollment) {
    return null;
  }

  if (enrollment.status !== "completed" || !enrollment.completed_at) {
    throw new Error("Certificate is available after course completion.");
  }

  const [studentResult, courseResult, completedEnrollmentsResult] =
    await Promise.all([
      supabase
        .from("students")
        .select("id,full_name")
        .eq("tenant_id", tenantId)
        .eq("id", enrollment.student_id)
        .maybeSingle(),
      supabase
        .from("courses")
        .select("id,title")
        .eq("tenant_id", tenantId)
        .eq("id", enrollment.course_id)
        .maybeSingle(),
      supabase
        .from("enrollments")
        .select("id,completed_at,created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (studentResult.error) {
    throw studentResult.error;
  }

  if (courseResult.error) {
    throw courseResult.error;
  }

  if (completedEnrollmentsResult.error) {
    throw completedEnrollmentsResult.error;
  }

  if (!studentResult.data || !courseResult.data) {
    throw new Error("Certificate data is incomplete.");
  }

  const completedEnrollments = completedEnrollmentsResult.data ?? [];
  const enrollmentIndex = completedEnrollments.findIndex(
    (item) => item.id === enrollmentId,
  );
  const sequence = formatCertificateSequence(
    enrollmentIndex >= 0 ? enrollmentIndex + 1 : completedEnrollments.length + 1,
  );
  const year = new Date(enrollment.completed_at).getFullYear();

  const certificate = {
    certificate_number: `CERT-${year}-${sequence}`,
    completion_date: enrollment.completed_at,
    course_title: courseResult.data.title,
    enrollment_id: enrollment.id,
    student_name: studentResult.data.full_name,
    tenant_id: tenantId,
  } satisfies CertificateData;

  await logActivity({
    action: "certificate_generated",
    description: "Generated course completion certificate",
    entityId: certificate.enrollment_id,
    entityName: certificate.certificate_number,
    entityType: "certificate",
    metadata: {
      courseTitle: certificate.course_title,
      studentName: certificate.student_name,
    },
    tenantId,
  });
  await runAutomationTrigger("certificate_issued", {
    entityId: certificate.enrollment_id,
    entityType: "certificate",
    metadata: {
      certificate_number: certificate.certificate_number,
      course_id: enrollment.course_id,
      course_title: certificate.course_title,
      student_id: enrollment.student_id,
      student_name: certificate.student_name,
    },
    tenantId,
  });

  return certificate;
}
