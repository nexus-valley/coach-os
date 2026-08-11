import type { Cohort, CohortMember } from "@/src/lib/cohorts";
import type { Enrollment } from "@/src/lib/enrollments";
import { hasEffectivePermission, getMemberRoleForTenant } from "@/src/lib/permissions";
import {
  getStudentPortalInvitationStatus,
} from "@/src/lib/studentPortalInvitations";
import {
  canCreateStudentDetailEnrollment,
  deriveStudentDetailPortalEvidence,
  getStudentDetailRelationshipCapabilities,
  groupStudentDetailRelationships,
  type StudentDetailCohort,
  type StudentDetailModel,
  type StudentDetailProgram,
  type StudentDetailRelationship,
} from "@/src/lib/studentDetailModel";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getTrainerAssignedCohortIds,
  getTrainerAssignedCourseIds,
} from "@/src/lib/trainerAssignments";

type StudentDetailProgramRow = StudentDetailProgram & {
  tenant_id: string;
};

const studentColumns =
  "id,tenant_id,full_name,email,phone,status,source,notes,portal_enabled,created_by,created_at,updated_at";
const enrollmentColumns =
  "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at";
const cohortColumns =
  "id,tenant_id,course_id,name,description,start_date,end_date,created_at";
const cohortMemberColumns =
  "id,tenant_id,cohort_id,student_id,enrolled_at";

export async function getStudentDetail(params: {
  studentId: string;
  tenantId: string;
}): Promise<StudentDetailModel | null> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("Authentication required.");
  }

  const role = await getMemberRoleForTenant(params.tenantId, user.id);

  if (!role) {
    return null;
  }

  const [studentResult, trainerCourseIds, trainerCohortIds] = await Promise.all([
    supabase
      .from("students")
      .select(studentColumns)
      .eq("tenant_id", params.tenantId)
      .eq("id", params.studentId)
      .maybeSingle(),
    role === "trainer"
      ? getTrainerAssignedCourseIds(params.tenantId, user.id)
      : Promise.resolve([]),
    role === "trainer"
      ? getTrainerAssignedCohortIds(params.tenantId, user.id)
      : Promise.resolve([]),
  ]);

  if (studentResult.error) {
    throw studentResult.error;
  }

  const student = (studentResult.data as Student | null) ?? null;

  if (!student) {
    return null;
  }

  const portalSummaryPromise =
    role === "owner" || role === "admin"
      ? getStudentPortalInvitationStatus({
          studentId: params.studentId,
          tenantId: params.tenantId,
        }).catch(() => null)
      : Promise.resolve(null);
  const financePermissionPromise =
    role === "trainer"
      ? Promise.resolve(false)
      : hasEffectivePermission({
          action: "view_student_finance",
          entityId: params.studentId,
          entityType: "student",
          logUsage: false,
          permission: "view_payments",
          scopeId: params.studentId,
          scopeType: "student",
          tenantId: params.tenantId,
          userId: user.id,
        }).catch(() => false);

  const [enrollmentsResult, membershipsResult, portalSummary, canViewFinance] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select(enrollmentColumns)
        .eq("tenant_id", params.tenantId)
        .eq("student_id", params.studentId)
        .order("enrolled_at", { ascending: false }),
      supabase
        .from("cohort_members")
        .select(cohortMemberColumns)
        .eq("tenant_id", params.tenantId)
        .eq("student_id", params.studentId)
        .order("enrolled_at", { ascending: false }),
      portalSummaryPromise,
      financePermissionPromise,
    ]);

  if (enrollmentsResult.error) {
    throw enrollmentsResult.error;
  }

  if (membershipsResult.error) {
    throw membershipsResult.error;
  }

  const enrollments = (enrollmentsResult.data ?? []) as Enrollment[];
  const memberships = (membershipsResult.data ?? []) as CohortMember[];
  const membershipCohortIds = memberships.map(
    (membership) => membership.cohort_id,
  );
  const cohortIds = Array.from(
    new Set([...membershipCohortIds, ...trainerCohortIds]),
  );
  const cohortsResult = cohortIds.length
    ? await supabase
        .from("cohorts")
        .select(cohortColumns)
        .eq("tenant_id", params.tenantId)
        .in("id", cohortIds)
    : { data: [], error: null };

  if (cohortsResult.error) {
    throw cohortsResult.error;
  }

  const cohorts = (cohortsResult.data ?? []) as Cohort[];
  const courseIds = Array.from(
    new Set([
      ...enrollments.map((enrollment) => enrollment.course_id),
      ...cohorts.map((cohort) => cohort.course_id),
    ]),
  );
  const programsResult = courseIds.length
    ? await supabase
        .from("courses")
        .select("id,tenant_id,title,status")
        .eq("tenant_id", params.tenantId)
        .in("id", courseIds)
    : { data: [], error: null };

  if (programsResult.error) {
    throw programsResult.error;
  }

  const programById = new Map(
    ((programsResult.data ?? []) as StudentDetailProgramRow[]).map((program) => [
      program.id,
      {
        id: program.id,
        status: program.status,
        title: program.title,
      } satisfies StudentDetailProgram,
    ]),
  );
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const trainerCohortCourseIds = Array.from(
    new Set(
      cohorts
        .filter((cohort) => trainerCohortIds.includes(cohort.id))
        .map((cohort) => cohort.course_id),
    ),
  );
  const detailCohorts = memberships.map((membership) => {
    const cohort = cohortById.get(membership.cohort_id) ?? null;

    return {
      ...membership,
      canOpenCohort:
        role !== "trainer" || trainerCohortIds.includes(membership.cohort_id),
      cohort,
      program: cohort ? programById.get(cohort.course_id) ?? null : null,
    } satisfies StudentDetailCohort;
  });
  const relationships = enrollments.map((enrollment) => {
    const relationshipCapabilities =
      getStudentDetailRelationshipCapabilities({
        courseId: enrollment.course_id,
        enrollmentStatus: enrollment.status,
        role,
        studentStatus: student.status,
        trainerCohortCourseIds,
        trainerCourseIds,
      });

    return {
      ...relationshipCapabilities,
      cohorts: detailCohorts.filter(
        (membership) => membership.cohort?.course_id === enrollment.course_id,
      ),
      enrollment,
      program: programById.get(enrollment.course_id) ?? null,
    } satisfies StudentDetailRelationship;
  });
  const enrollmentCourseIds = new Set(
    enrollments.map((enrollment) => enrollment.course_id),
  );
  const groupedRelationships = groupStudentDetailRelationships(relationships);

  return {
    capabilities: {
      canCreateEnrollment: canCreateStudentDetailEnrollment({
        role,
        studentStatus: student.status,
        trainerCourseIds,
      }),
      canDeleteStudent: role === "owner" || role === "admin",
      canEditProfile: role !== "trainer",
      canPreviewPortal: true,
      canViewFinance,
    },
    currentRelationships: groupedRelationships.currentRelationships,
    historyRelationships: groupedRelationships.historyRelationships,
    portal: deriveStudentDetailPortalEvidence({
      role,
      student,
      summary: portalSummary,
    }),
    role,
    student,
    unmatchedCohorts: detailCohorts.filter(
      (membership) =>
        !membership.cohort ||
        !enrollmentCourseIds.has(membership.cohort.course_id),
    ),
  };
}
