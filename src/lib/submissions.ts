import { logActivity } from "@/src/lib/auditLogger";
import {
  assignmentColumns,
  ensureCanManageAssignment,
  ensureCanReviewAssignment,
  getAssignmentById,
  logAssignmentDelegatedUse,
  normalizeAssignment,
  type AssignmentWithRelations,
} from "@/src/lib/assignments";
import { createNotificationForTenantRoles } from "@/src/lib/notifications";
import { getMemberRoleForTenant } from "@/src/lib/permissions";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type SubmissionStatus = "late" | "pending" | "reviewed" | "submitted";

export type AssignmentSubmission = {
  assignment_id: string;
  attachment_urls_json: string[];
  created_at: string;
  feedback: string | null;
  id: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  score: number | null;
  status: SubmissionStatus;
  student_id: string;
  submission_text: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  tenant_id: string;
  updated_at: string;
};

export type AssignmentSubmissionWithStudent = AssignmentSubmission & {
  student:
    | (Pick<Student, "email" | "full_name" | "id" | "phone"> & {
        status: Student["status"] | null;
      })
    | null;
};

export type AssignmentRosterItem = {
  student: Pick<Student, "email" | "full_name" | "id" | "phone"> & {
    status: Student["status"] | null;
  };
  submission: AssignmentSubmission | null;
};

export type AssignmentSubmissionSummary = {
  averageScore: number | null;
  late: number;
  pending: number;
  reviewed: number;
  submitted: number;
  submissionRate: number | null;
  total: number;
};

export const staleAssignmentReviewMessage =
  "This submission changed since you opened it. Review the latest submission before saving feedback.";

export class StaleAssignmentReviewError extends Error {
  constructor() {
    super(staleAssignmentReviewMessage);
    this.name = "StaleAssignmentReviewError";
  }
}

const submissionColumns =
  "id,tenant_id,assignment_id,student_id,submitted_by,submission_text,attachment_urls_json,score,feedback,status,submitted_at,reviewed_at,reviewed_by,created_at,updated_at";

function normalizeSubmission(row: AssignmentSubmission) {
  return {
    ...row,
    attachment_urls_json: Array.isArray(row.attachment_urls_json)
      ? row.attachment_urls_json
      : [],
    score:
      row.score === null || typeof row.score === "undefined"
        ? null
        : Number(row.score),
  } satisfies AssignmentSubmission;
}

function normalizeAttachmentUrls(urls: string[] | undefined) {
  return (urls ?? []).map((url) => url.trim()).filter(Boolean);
}

function throwReviewRpcError(error: unknown): never {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; details?: unknown })
      : null;

  if (
    candidate?.code === "P0001" &&
    candidate.details === "assignment_submission_stale"
  ) {
    throw new StaleAssignmentReviewError();
  }

  throw error;
}

export function isStaleAssignmentReviewError(
  error: unknown,
): error is StaleAssignmentReviewError {
  return error instanceof StaleAssignmentReviewError;
}

function calculateSummary(
  total: number,
  submissions: AssignmentSubmission[],
): AssignmentSubmissionSummary {
  const summary: AssignmentSubmissionSummary = {
    averageScore: null,
    late: 0,
    pending: Math.max(total - submissions.length, 0),
    reviewed: 0,
    submitted: 0,
    submissionRate: total > 0 ? Math.round((submissions.length / total) * 100) : null,
    total,
  };
  let scoreTotal = 0;
  let scoredCount = 0;

  for (const submission of submissions) {
    summary[submission.status] += 1;

    if (submission.score !== null) {
      scoreTotal += submission.score;
      scoredCount += 1;
    }
  }

  summary.averageScore =
    scoredCount > 0 ? Math.round((scoreTotal / scoredCount) * 10) / 10 : null;

  return summary;
}

async function getStudentRows(
  studentIds: string[],
  tenantId: string,
): Promise<AssignmentRosterItem["student"][]> {
  if (studentIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .select("id,full_name,email,phone,status")
    .eq("tenant_id", tenantId)
    .in("id", studentIds)
    .order("full_name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as AssignmentRosterItem["student"][];
}

async function getEligibleStudentIdsForAssignment(
  assignment: AssignmentWithRelations,
) {
  const supabase = getSupabaseClient();

  if (assignment.cohort_id) {
    const { data, error } = await supabase
      .from("cohort_members")
      .select("student_id")
      .eq("tenant_id", assignment.tenant_id)
      .eq("cohort_id", assignment.cohort_id);

    if (error) {
      throw error;
    }

    return new Set(
      ((data ?? []) as { student_id: string }[]).map(
        (member) => member.student_id,
      ),
    );
  }

  if (assignment.course_id) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("tenant_id", assignment.tenant_id)
      .eq("course_id", assignment.course_id);

    if (error) {
      throw error;
    }

    return new Set(
      ((data ?? []) as { student_id: string }[]).map(
        (enrollment) => enrollment.student_id,
      ),
    );
  }

  return new Set<string>();
}

async function ensureStudentsBelongToAssignment(
  assignment: AssignmentWithRelations,
  studentIds: string[],
) {
  const eligibleStudentIds = await getEligibleStudentIdsForAssignment(assignment);
  const invalidStudentId = studentIds.find(
    (studentId) => !eligibleStudentIds.has(studentId),
  );

  if (invalidStudentId) {
    await logActivity({
      action: "access_denied",
      description: "Blocked assignment submission outside assignment roster.",
      entityId: assignment.id,
      entityName: assignment.title,
      entityType: "security",
      metadata: {
        assignmentId: assignment.id,
        invalidStudentId,
      },
      severity: "warning",
      tenantId: assignment.tenant_id,
    });
    throw new Error("Submissions can only be managed for students in this assignment roster.");
  }
}

async function getCurrentUser() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to manage submissions.");
  }

  return user;
}

async function ensureCanCreateSubmission(tenantId: string) {
  const user = await getCurrentUser();
  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "owner" && role !== "admin") {
    await logActivity({
      action: "access_denied",
      description: "Blocked assignment submission creation without admin permission.",
      entityName: "Assignment submission",
      entityType: "security",
      metadata: { role },
      severity: "warning",
      tenantId,
    });
    throw new Error("Only owner/admin users can create student submissions.");
  }

  return { role, user };
}

async function notifySubmissionEvent(params: {
  assignment: AssignmentWithRelations;
  message: string;
  severity?: "info" | "warning";
  title: string;
}) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/assignments/${params.assignment.id}`,
      entityId: params.assignment.id,
      entityType: "assignment_submission",
      message: params.message,
      metadata: {
        assignmentId: params.assignment.id,
        cohortId: params.assignment.cohort_id,
        courseId: params.assignment.course_id,
      },
      roles: ["owner", "admin"],
      severity: params.severity ?? "info",
      tenantId: params.assignment.tenant_id,
      title: params.title,
      type: "assignment_notice",
    });
  } catch {
    // Submission notifications are non-blocking.
  }
}

async function reviewDelegatedSubmissionWithRpc(params: {
  assignmentId: string;
  expectedSubmissionUpdatedAt: string;
  feedback: string;
  score?: string | number | null;
  studentId: string;
  tenantId: string;
}) {
  const rawScore =
    params.score === null || typeof params.score === "undefined" || params.score === ""
      ? null
      : Number(params.score);

  if (rawScore !== null && !Number.isFinite(rawScore)) {
    throw new Error("Score must be a valid number.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("review_delegated_assignment_submission", {
      p_assignment_id: params.assignmentId,
      p_expected_submission_updated_at: params.expectedSubmissionUpdatedAt,
      p_feedback: params.feedback.trim() || null,
      p_score: rawScore,
      p_student_id: params.studentId,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throwReviewRpcError(error);
  }

  return normalizeSubmission(data as AssignmentSubmission);
}

export async function getAssignmentSubmissions(params: {
  assignmentId: string;
  tenantId: string;
}) {
  const assignment = await getAssignmentById(params);

  if (!assignment) {
    throw new Error("Assignment not found in this workspace.");
  }

  const submissions = await getAssignmentSubmissionsForKnownAssignment(params);
  const studentIds = Array.from(
    new Set(submissions.map((item) => item.student_id)),
  );
  const students = await getStudentRows(studentIds, params.tenantId);
  const studentById = new Map(students.map((student) => [student.id, student]));

  return submissions.map((submission) => ({
    ...submission,
    student: studentById.get(submission.student_id) ?? null,
  })) satisfies AssignmentSubmissionWithStudent[];
}

async function getAssignmentSubmissionsForKnownAssignment(params: {
  assignmentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("assignment_submissions")
    .select(submissionColumns)
    .eq("tenant_id", params.tenantId)
    .eq("assignment_id", params.assignmentId)
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as AssignmentSubmission[]).map(normalizeSubmission);
}

export async function getAssignmentSubmissionRoster(params: {
  assignmentId: string;
  tenantId: string;
}) {
  const assignment = await getAssignmentById(params);

  if (!assignment) {
    throw new Error("Assignment not found in this workspace.");
  }

  const [submissions, eligibleStudentIds] = await Promise.all([
    getAssignmentSubmissionsForKnownAssignment(params),
    getEligibleStudentIdsForAssignment(assignment),
  ]);
  const submissionStudentIds = submissions.map(
    (submission) => submission.student_id,
  );
  const rosterStudentIds = Array.from(
    new Set([...eligibleStudentIds, ...submissionStudentIds]),
  );
  const students = await getStudentRows(
    rosterStudentIds,
    params.tenantId,
  );
  const studentById = new Map(students.map((student) => [student.id, student]));
  const submissionByStudentId = new Map(
    submissions.map((submission) => [submission.student_id, submission]),
  );
  const roster = rosterStudentIds
    .map((studentId) => ({
      student:
        studentById.get(studentId) ??
        ({
          email: null,
          full_name: "Former student",
          id: studentId,
          phone: null,
          status: null,
        } satisfies AssignmentRosterItem["student"]),
      submission: submissionByStudentId.get(studentId) ?? null,
    }))
    .sort((left, right) =>
      left.student.full_name.localeCompare(right.student.full_name) ||
      left.student.id.localeCompare(right.student.id),
    );

  return {
    assignment,
    hasPersistedSubmissions: submissions.length > 0,
    roster,
    summary: calculateSummary(roster.length, submissions),
  };
}

export async function submitAssignment(params: {
  assignmentId: string;
  attachmentUrls?: string[];
  studentId: string;
  submissionText: string;
  tenantId: string;
}) {
  const assignment = await getAssignmentById({
    assignmentId: params.assignmentId,
    tenantId: params.tenantId,
  });

  if (!assignment) {
    throw new Error("Assignment not found in this workspace.");
  }

  await ensureCanCreateSubmission(params.tenantId);
  await ensureCanManageAssignment({
    cohortId: assignment.cohort_id,
    courseId: assignment.course_id,
    tenantId: params.tenantId,
  });
  await ensureStudentsBelongToAssignment(assignment, [params.studentId]);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("submit_assignment_secure", {
      p_assignment_id: params.assignmentId,
      p_attachment_urls_json: normalizeAttachmentUrls(params.attachmentUrls),
      p_student_id: params.studentId,
      p_submission_text: params.submissionText.trim() || null,
      p_tenant_id: params.tenantId,
    });

  if (error) {
    throw error;
  }

  const submission = normalizeSubmission(data as AssignmentSubmission);

  await logActivity({
    action: "assignment_submitted",
    description: "Recorded assignment submission",
    entityId: submission.id,
    entityName: assignment.title,
    entityType: "assignment_submission",
    metadata: {
      assignmentId: assignment.id,
      status: submission.status,
      studentId: submission.student_id,
    },
    tenantId: submission.tenant_id,
  });
  await notifySubmissionEvent({
    assignment,
    message: `Submission received for ${assignment.title}.`,
    severity: submission.status === "late" ? "warning" : "info",
    title: "Assignment submission received",
  });

  return submission;
}

export async function updateSubmission(params: {
  assignmentId: string;
  attachmentUrls?: string[];
  studentId: string;
  submissionText: string;
  tenantId: string;
}) {
  return submitAssignment(params);
}

export async function reviewSubmission(params: {
  assignmentId: string;
  expectedSubmissionUpdatedAt: string;
  feedback: string;
  score?: string | number | null;
  studentId: string;
  tenantId: string;
}) {
  if (!params.expectedSubmissionUpdatedAt) {
    throw new Error("Submission revision is not available. Reload before reviewing.");
  }

  const assignment = await getAssignmentById({
    assignmentId: params.assignmentId,
    tenantId: params.tenantId,
  });

  if (!assignment) {
    return reviewDelegatedSubmissionWithRpc(params);
  }

  const { decision, user } = await ensureCanReviewAssignment({
    assignmentId: assignment.id,
    assignmentTrainerUserId: assignment.trainer_user_id,
    cohortId: assignment.cohort_id,
    courseId: assignment.course_id,
    studentId: params.studentId,
    tenantId: params.tenantId,
  });

  const rawScore =
    params.score === null || typeof params.score === "undefined" || params.score === ""
      ? null
      : Number(params.score);

  if (rawScore !== null && (!Number.isFinite(rawScore) || rawScore < 0)) {
    throw new Error("Score must be a positive number.");
  }

  if (
    rawScore !== null &&
    assignment.max_score !== null &&
    rawScore > assignment.max_score
  ) {
    throw new Error("Score cannot be greater than max score.");
  }

  if (decision.source === "delegated") {
    const submission = await reviewDelegatedSubmissionWithRpc(params);

    await logActivity({
      action: "assignment_reviewed",
      description: "Reviewed assignment submission",
      entityId: submission.id,
      entityName: assignment.title,
      entityType: "assignment_submission",
      metadata: {
        assignmentId: assignment.id,
        score: submission.score,
        studentId: submission.student_id,
      },
      tenantId: submission.tenant_id,
    });
    await notifySubmissionEvent({
      assignment,
      message: `Submission reviewed for ${assignment.title}.`,
      title: "Assignment submission reviewed",
    });

    return submission;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("review_assignment_submission_secure", {
      p_assignment_id: params.assignmentId,
      p_expected_submission_updated_at: params.expectedSubmissionUpdatedAt,
      p_feedback: params.feedback.trim() || null,
      p_score: rawScore,
      p_student_id: params.studentId,
      p_tenant_id: params.tenantId,
    });

  if (error) {
    throwReviewRpcError(error);
  }

  const submission = normalizeSubmission(data as AssignmentSubmission);

  await logActivity({
    action: "assignment_reviewed",
    description: "Reviewed assignment submission",
    entityId: submission.id,
    entityName: assignment.title,
    entityType: "assignment_submission",
    metadata: {
      assignmentId: assignment.id,
      score: submission.score,
      studentId: submission.student_id,
    },
    tenantId: submission.tenant_id,
  });
  await logAssignmentDelegatedUse({
    action: "review_assignment_submission",
    decision,
    entityId: submission.id,
    entityType: "assignment_submission",
    tenantId: submission.tenant_id,
    userId: user.id,
  });
  await notifySubmissionEvent({
    assignment,
    message: `Submission reviewed for ${assignment.title}.`,
    title: "Assignment submission reviewed",
  });

  return submission;
}

export async function getStudentSubmissionHistory(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("assignment_submissions")
    .select(`${submissionColumns}, assignments (${assignmentColumns})`)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as (AssignmentSubmission & { assignments?: unknown })[]).map(
    (row) => ({
      ...normalizeSubmission(row),
      assignment: row.assignments
        ? normalizeAssignment(row.assignments as Parameters<typeof normalizeAssignment>[0])
        : null,
    }),
  );
}

export { calculateSummary as calculateAssignmentSubmissionSummary };
