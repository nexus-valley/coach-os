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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "recalculate_student_course_progress_secure",
    {
      p_course_id: courseId,
      p_student_id: studentId,
      p_tenant_id: tenantId,
    },
  );

  if (error) {
    throw error;
  }

  return data as CourseCompletionStatus;
}

export async function generateCertificateData(
  enrollmentId: string,
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("get_certificate_data_secure", {
      p_enrollment_id: enrollmentId,
      p_tenant_id: tenantId,
    })
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as CertificateData | null) ?? null;
}
