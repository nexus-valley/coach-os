import type {
  AssignmentWithRelations,
  UpdateAssignmentInput,
} from "@/src/lib/assignments";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import type { MemberRole } from "@/src/lib/permissions";

export type AssignmentEditForm = {
  attachmentUrls: string[];
  cohortId: string;
  courseId: string;
  description: string;
  dueAt: string;
  instructions: string;
  maxScore: string;
  title: string;
  trainerUserId: string;
};

export type AssignmentEditCapability = {
  canEdit: boolean;
  canEditAttachments: boolean;
  canEditContent: boolean;
  canEditDueAndMax: boolean;
  canEditRelationships: boolean;
  canRetargetTrainer: boolean;
};

type CapabilityInput = {
  canManage: boolean;
  canMoveRelationships: boolean;
  hasPersistedSubmissions: boolean;
  role: MemberRole | null;
  status: unknown;
};

const failClosedCapability: AssignmentEditCapability = {
  canEdit: false,
  canEditAttachments: false,
  canEditContent: false,
  canEditDueAndMax: false,
  canEditRelationships: false,
  canRetargetTrainer: false,
};

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function getAssignmentEditCapability({
  canManage,
  canMoveRelationships,
  hasPersistedSubmissions,
  role,
  status,
}: CapabilityInput): AssignmentEditCapability {
  if (!canManage || (status !== "draft" && status !== "published")) {
    return failClosedCapability;
  }

  const draft = status === "draft";

  return {
    canEdit: true,
    canEditAttachments: true,
    canEditContent: true,
    canEditDueAndMax: draft || !hasPersistedSubmissions,
    canEditRelationships: draft && canMoveRelationships,
    canRetargetTrainer: draft && (role === "owner" || role === "admin"),
  };
}

export function assignmentIsoToDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

export function assignmentDateTimeLocalToIso(value: string) {
  if (!value) {
    return null;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);

  if (!match) {
    throw new Error("Due date must be a valid date and time.");
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute) ||
    date.getSeconds() !== Number(second)
  ) {
    throw new Error("Due date must be a valid date and time.");
  }

  return date.toISOString();
}

export function parseAssignmentMaxScore(value: string) {
  if (!value.trim()) {
    return null;
  }

  const score = Number(value);

  if (!Number.isFinite(score) || score < 0) {
    throw new Error("Maximum score must be a non-negative number.");
  }

  return score;
}

export function validateAssignmentAttachmentUrls(urls: string[]) {
  if (urls.length > 10) {
    throw new Error("Add no more than 10 attachment links.");
  }

  return urls.flatMap((url) => {
    const normalized = url.trim();

    if (!normalized) {
      return [];
    }

    if (normalized.length > 1000) {
      throw new Error("Each attachment link must be 1,000 characters or fewer.");
    }

    if (!/^https?:\/\//i.test(normalized) || /[<>]/.test(normalized)) {
      throw new Error("Attachment links must use HTTP or HTTPS and contain no angle brackets.");
    }

    return [normalized];
  });
}

export function createAssignmentEditForm(
  assignment: AssignmentWithRelations,
): AssignmentEditForm {
  return {
    attachmentUrls: [...assignment.attachment_urls_json],
    cohortId: assignment.cohort_id ?? "",
    courseId: assignment.course_id ?? "",
    description: assignment.description ?? "",
    dueAt: assignmentIsoToDateTimeLocal(assignment.due_at),
    instructions: assignment.instructions ?? "",
    maxScore: assignment.max_score?.toString() ?? "",
    title: assignment.title,
    trainerUserId: assignment.trainer_user_id ?? "",
  };
}

export function isAssignmentEditDirty(
  initial: AssignmentEditForm,
  current: AssignmentEditForm,
) {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

export function getCohortsForAssignmentProgram(
  cohorts: Pick<CohortWithCourse, "course_id" | "id" | "name">[],
  courseId: string,
) {
  return courseId
    ? cohorts.filter((cohort) => cohort.course_id === courseId)
    : [];
}

export function changeAssignmentEditProgram(
  form: AssignmentEditForm,
  courseId: string,
  cohorts: Pick<CohortWithCourse, "course_id" | "id" | "name">[],
): AssignmentEditForm {
  const selectedCohort = cohorts.find((cohort) => cohort.id === form.cohortId);

  return {
    ...form,
    cohortId:
      selectedCohort?.course_id === courseId ? form.cohortId : "",
    courseId,
  };
}

function validateText(value: string, label: string, limit: number, required = false) {
  const normalized = value.trim();

  if (required && !normalized) {
    throw new Error(`${label} is required.`);
  }

  if (normalized.length > limit) {
    throw new Error(`${label} must be ${limit.toLocaleString()} characters or fewer.`);
  }
}

export function buildAssignmentUpdateInput(params: {
  assignment: AssignmentWithRelations;
  capability: AssignmentEditCapability;
  form: AssignmentEditForm;
}): UpdateAssignmentInput {
  const { assignment, capability, form } = params;

  if (!capability.canEdit) {
    throw new Error("This assignment cannot be edited.");
  }

  validateText(form.title, "Assignment title", 180, true);
  validateText(form.description, "Description", 2000);
  validateText(form.instructions, "Instructions", 4000);

  const courseId = capability.canEditRelationships
    ? form.courseId || null
    : assignment.course_id;
  const cohortId = capability.canEditRelationships
    ? form.cohortId || null
    : assignment.cohort_id;

  if (!courseId && !cohortId) {
    throw new Error("Select a program or cohort for this assignment.");
  }

  const initial = createAssignmentEditForm(assignment);
  const dueAt = capability.canEditDueAndMax
    ? form.dueAt === initial.dueAt
      ? assignment.due_at
      : assignmentDateTimeLocalToIso(form.dueAt)
    : assignment.due_at;
  const maxScore = capability.canEditDueAndMax
    ? parseAssignmentMaxScore(form.maxScore)
    : assignment.max_score;
  const attachmentUrls =
    JSON.stringify(form.attachmentUrls) ===
    JSON.stringify(initial.attachmentUrls)
      ? [...assignment.attachment_urls_json]
      : validateAssignmentAttachmentUrls(form.attachmentUrls);

  return {
    assignmentId: assignment.id,
    attachmentUrls,
    cohortId,
    courseId,
    description: form.description,
    dueAt: dueAt ?? "",
    instructions: form.instructions,
    maxScore,
    tenantId: assignment.tenant_id,
    title: form.title,
    trainerUserId: capability.canRetargetTrainer
      ? form.trainerUserId || null
      : assignment.trainer_user_id,
  };
}
