import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getSafeStudentAttachmentUrls } from "@/src/lib/studentAssignmentModel";

export type StudentAssignmentStatus = "closed" | "published";
export type StudentSubmissionStatus =
  | "late"
  | "pending"
  | "reviewed"
  | "submitted";

export type StudentAssignmentSubmission = {
  attachment_urls_json: string[];
  feedback: string | null;
  id: string;
  reviewed_at: string | null;
  score: number | null;
  status: StudentSubmissionStatus;
  submission_text: string | null;
  submitted_at: string | null;
};

export type StudentAssignmentItem = {
  assignment: {
    attachment_urls_json: string[];
    cohort_id: string | null;
    course_id: string | null;
    description: string | null;
    due_at: string | null;
    id: string;
    instructions: string | null;
    max_score: number | null;
    status: StudentAssignmentStatus;
    title: string;
  };
  cohort: { id: string; name: string } | null;
  course: { id: string; title: string } | null;
  submission: StudentAssignmentSubmission | null;
};

type AssignmentRow = StudentAssignmentItem["assignment"] & {
  tenant_id: string;
};

type SubmissionRow = StudentAssignmentSubmission & {
  assignment_id: string;
  student_id: string;
  tenant_id: string;
};

type CohortRow = {
  course_id: string | null;
  id: string;
  name: string;
};

type CourseRow = {
  id: string;
  title: string;
};

export type StudentAssignmentErrorKind =
  | "assignment_closed"
  | "assignment_unavailable"
  | "temporary_failure";

export class StudentAssignmentError extends Error {
  kind: StudentAssignmentErrorKind;

  constructor(kind: StudentAssignmentErrorKind, message: string) {
    super(message);
    this.name = "StudentAssignmentError";
    this.kind = kind;
  }
}

const assignmentColumns =
  "id,tenant_id,course_id,cohort_id,title,description,instructions,attachment_urls_json,max_score,due_at,status";
const submissionColumns =
  "id,tenant_id,assignment_id,student_id,submission_text,attachment_urls_json,score,feedback,status,submitted_at,reviewed_at";

function contextIds(context: StudentPortalContext) {
  return {
    studentId: context.student.id,
    tenantId: context.tenant.id,
  };
}

function asErrorLike(caught: unknown) {
  return caught && typeof caught === "object"
    ? (caught as { code?: unknown; message?: unknown })
    : null;
}

function toSafeReadError(caught: unknown): StudentAssignmentError {
  const error = asErrorLike(caught);
  const code = typeof error?.code === "string" ? error.code : "";

  if (code === "42501" || code === "PGRST116") {
    return new StudentAssignmentError(
      "assignment_unavailable",
      "This assignment is not available for your account.",
    );
  }

  return new StudentAssignmentError(
    "temporary_failure",
    "Unable to load this assignment right now. Please try again.",
  );
}

function toSafeSubmitError(caught: unknown): StudentAssignmentError {
  const error = asErrorLike(caught);
  const code = typeof error?.code === "string" ? error.code : "";
  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (
    code === "22023" &&
    (message.includes("not open") || message.includes("closed"))
  ) {
    return new StudentAssignmentError(
      "assignment_closed",
      "This assignment has been closed and can no longer accept submissions.",
    );
  }

  if (code === "42501") {
    return new StudentAssignmentError(
      "assignment_unavailable",
      "Your access to this assignment is no longer available.",
    );
  }

  return new StudentAssignmentError(
    "temporary_failure",
    "Your submission could not be saved right now. Please try again.",
  );
}

function normalizeSubmission(row: SubmissionRow): StudentAssignmentSubmission {
  return {
    attachment_urls_json: getSafeStudentAttachmentUrls(
      row.attachment_urls_json,
    ),
    feedback: row.feedback,
    id: row.id,
    reviewed_at: row.reviewed_at,
    score: row.score === null ? null : Number(row.score),
    status: row.status,
    submission_text: row.submission_text,
    submitted_at: row.submitted_at,
  };
}

function normalizeAssignment(row: AssignmentRow) {
  return {
    attachment_urls_json: getSafeStudentAttachmentUrls(
      row.attachment_urls_json,
    ),
    cohort_id: row.cohort_id,
    course_id: row.course_id,
    description: row.description,
    due_at: row.due_at,
    id: row.id,
    instructions: row.instructions,
    max_score: row.max_score === null ? null : Number(row.max_score),
    status: row.status,
    title: row.title,
  } satisfies StudentAssignmentItem["assignment"];
}

async function getAssignmentContext(
  tenantId: string,
  assignments: AssignmentRow[],
) {
  const supabase = getSupabaseClient();
  const cohortIds = Array.from(
    new Set(
      assignments
        .map((assignment) => assignment.cohort_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const cohortResult = cohortIds.length
    ? await supabase
        .from("cohorts")
        .select("id,name,course_id")
        .eq("tenant_id", tenantId)
        .in("id", cohortIds)
    : { data: [], error: null };

  if (cohortResult.error) {
    throw toSafeReadError(cohortResult.error);
  }

  const cohorts = (cohortResult.data ?? []) as CohortRow[];
  const courseIds = Array.from(
    new Set(
      [
        ...assignments.map((assignment) => assignment.course_id),
        ...cohorts.map((cohort) => cohort.course_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  const courseResult = courseIds.length
    ? await supabase
        .from("courses")
        .select("id,title")
        .eq("tenant_id", tenantId)
        .in("id", courseIds)
    : { data: [], error: null };

  if (courseResult.error) {
    throw toSafeReadError(courseResult.error);
  }

  return {
    cohortById: new Map(cohorts.map((cohort) => [cohort.id, cohort])),
    courseById: new Map(
      ((courseResult.data ?? []) as CourseRow[]).map((course) => [
        course.id,
        course,
      ]),
    ),
  };
}

function assembleItem(params: {
  assignment: AssignmentRow;
  cohortById: Map<string, CohortRow>;
  courseById: Map<string, CourseRow>;
  submission: SubmissionRow | null;
}): StudentAssignmentItem {
  const cohort = params.assignment.cohort_id
    ? params.cohortById.get(params.assignment.cohort_id) ?? null
    : null;
  const courseId = params.assignment.course_id ?? cohort?.course_id ?? null;

  return {
    assignment: normalizeAssignment(params.assignment),
    cohort: cohort ? { id: cohort.id, name: cohort.name } : null,
    course: courseId ? params.courseById.get(courseId) ?? null : null,
    submission: params.submission
      ? normalizeSubmission(params.submission)
      : null,
  };
}

export async function getStudentAssignments(context: StudentPortalContext) {
  const { studentId, tenantId } = contextIds(context);
  const supabase = getSupabaseClient();
  const assignmentResult = await supabase
    .from("assignments")
    .select(assignmentColumns)
    .eq("tenant_id", tenantId)
    .in("status", ["published", "closed"])
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (assignmentResult.error) {
    throw toSafeReadError(assignmentResult.error);
  }

  const assignments = (assignmentResult.data ?? []) as AssignmentRow[];

  if (assignments.length === 0) {
    return [];
  }

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [submissionResult, contextResult] = await Promise.all([
    supabase
      .from("assignment_submissions")
      .select(submissionColumns)
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .in("assignment_id", assignmentIds),
    getAssignmentContext(tenantId, assignments),
  ]);

  if (submissionResult.error) {
    throw toSafeReadError(submissionResult.error);
  }

  const submissionByAssignment = new Map(
    ((submissionResult.data ?? []) as SubmissionRow[]).map((submission) => [
      submission.assignment_id,
      submission,
    ]),
  );

  return assignments.map((assignment) =>
    assembleItem({
      assignment,
      ...contextResult,
      submission: submissionByAssignment.get(assignment.id) ?? null,
    }),
  );
}

export async function getStudentAssignmentDetail(
  context: StudentPortalContext,
  assignmentId: string,
) {
  const { studentId, tenantId } = contextIds(context);
  const supabase = getSupabaseClient();
  const assignmentResult = await supabase
    .from("assignments")
    .select(assignmentColumns)
    .eq("tenant_id", tenantId)
    .eq("id", assignmentId)
    .in("status", ["published", "closed"])
    .maybeSingle();

  if (assignmentResult.error) {
    throw toSafeReadError(assignmentResult.error);
  }

  if (!assignmentResult.data) {
    return null;
  }

  const assignment = assignmentResult.data as AssignmentRow;
  const [submissionResult, contextResult] = await Promise.all([
    supabase
      .from("assignment_submissions")
      .select(submissionColumns)
      .eq("tenant_id", tenantId)
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle(),
    getAssignmentContext(tenantId, [assignment]),
  ]);

  if (submissionResult.error) {
    throw toSafeReadError(submissionResult.error);
  }

  return assembleItem({
    assignment,
    ...contextResult,
    submission: (submissionResult.data as SubmissionRow | null) ?? null,
  });
}

export async function submitStudentAssignment(params: {
  assignmentId: string;
  attachmentUrls?: string[];
  context: StudentPortalContext;
  submissionText: string;
}) {
  const { studentId, tenantId } = contextIds(params.context);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("submit_assignment_secure", {
    p_assignment_id: params.assignmentId,
    p_attachment_urls_json: getSafeStudentAttachmentUrls(
      params.attachmentUrls ?? [],
    ),
    p_student_id: studentId,
    p_submission_text: params.submissionText.trim() || null,
    p_tenant_id: tenantId,
  });

  if (error) {
    throw toSafeSubmitError(error);
  }

  return normalizeSubmission(data as SubmissionRow);
}

export function getStudentAssignmentErrorMessage(caught: unknown) {
  return caught instanceof StudentAssignmentError
    ? caught.message
    : "Unable to load this assignment right now. Please try again.";
}
