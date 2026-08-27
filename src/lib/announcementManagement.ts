import type {
  AnnouncementAudience,
  AnnouncementWriteInput,
  TeamAnnouncementSummary,
} from "@/src/lib/announcements";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import type { Course } from "@/src/lib/courses";
import type { DelegatedPermission } from "@/src/lib/delegatedPermissions";
import type { MemberRole } from "@/src/lib/team";

export type AnnouncementCapabilityContext = {
  cohorts: CohortWithCourse[];
  permissions: DelegatedPermission[];
  programs: Course[];
  role: MemberRole | null;
  trainerCohortIds: string[];
  trainerCourseIds: string[];
};

export type AnnouncementAudienceOption = {
  courseId: string;
  id: string;
  label: string;
  programLabel?: string;
};

export type AnnouncementCapabilities = {
  allowedAudiences: AnnouncementAudience[];
  canCreate: boolean;
  cohorts: AnnouncementAudienceOption[];
  programs: AnnouncementAudienceOption[];
};

export type AnnouncementMutationOutcome =
  | {
      mutationError: unknown;
      mutationSucceeded: false;
      refreshSucceeded: boolean;
    }
  | {
      mutationSucceeded: true;
      refreshSucceeded: boolean;
    };

const supportedDelegationScopes = new Set(["workspace", "course", "cohort"]);

export async function executeAnnouncementMutation(input: {
  mutate: () => Promise<unknown>;
  onMutationSuccess: () => void;
  refresh: () => Promise<boolean>;
}): Promise<AnnouncementMutationOutcome> {
  try {
    await input.mutate();
  } catch (mutationError) {
    let refreshSucceeded = false;

    try {
      refreshSucceeded = await input.refresh();
    } catch {
      refreshSucceeded = false;
    }

    return {
      mutationError,
      mutationSucceeded: false,
      refreshSucceeded,
    };
  }

  input.onMutationSuccess();

  try {
    return {
      mutationSucceeded: true,
      refreshSucceeded: await input.refresh(),
    };
  } catch {
    return {
      mutationSucceeded: true,
      refreshSucceeded: false,
    };
  }
}

function activeMessagePermissions(permissions: DelegatedPermission[]) {
  const now = Date.now();

  return permissions.filter((permission) => {
    const startsAt = Date.parse(permission.starts_at);
    const expiresAt = permission.expires_at
      ? Date.parse(permission.expires_at)
      : Number.POSITIVE_INFINITY;

    return (
      permission.permission_key === "manage_messages" &&
      permission.status === "active" &&
      Boolean(permission.scope_type) &&
      supportedDelegationScopes.has(permission.scope_type ?? "") &&
      Number.isFinite(startsAt) &&
      startsAt <= now &&
      expiresAt > now
    );
  });
}

function permissionApplies(
  permissions: DelegatedPermission[],
  audience: AnnouncementAudience,
  courseId: string | null,
  cohortId: string | null,
) {
  return activeMessagePermissions(permissions).some((permission) => {
    if (permission.scope_type === "workspace") {
      return true;
    }

    if (audience === "tenant") {
      return false;
    }

    if (permission.scope_type === "course") {
      return permission.scope_id === courseId;
    }

    return audience === "cohort" && permission.scope_id === cohortId;
  });
}

export function canManageAnnouncementScope(
  context: AnnouncementCapabilityContext,
  audience: AnnouncementAudience,
  courseId: string | null,
  cohortId: string | null,
) {
  if (context.role === "owner" || context.role === "admin") {
    return true;
  }

  if (context.role !== "staff" && context.role !== "trainer") {
    return false;
  }

  if (!permissionApplies(context.permissions, audience, courseId, cohortId)) {
    return false;
  }

  if (context.role === "staff") {
    return audience !== "tenant" ||
      activeMessagePermissions(context.permissions).some(
        (permission) => permission.scope_type === "workspace",
      );
  }

  if (audience === "tenant") {
    return false;
  }

  if (audience === "program") {
    return Boolean(courseId && context.trainerCourseIds.includes(courseId));
  }

  return Boolean(cohortId && context.trainerCohortIds.includes(cohortId));
}

export function buildAnnouncementCapabilities(
  context: AnnouncementCapabilityContext,
): AnnouncementCapabilities {
  const programs = context.programs
    .filter((program) =>
      canManageAnnouncementScope(context, "program", program.id, null),
    )
    .map((program) => ({
      courseId: program.id,
      id: program.id,
      label: program.title,
    }));
  const cohorts = context.cohorts
    .filter((cohort) =>
      canManageAnnouncementScope(
        context,
        "cohort",
        cohort.course_id,
        cohort.id,
      ),
    )
    .map((cohort) => ({
      courseId: cohort.course_id,
      id: cohort.id,
      label: cohort.name,
      programLabel: cohort.course?.title ?? "Program unavailable",
    }));
  const allowedAudiences: AnnouncementAudience[] = [];

  if (canManageAnnouncementScope(context, "tenant", null, null)) {
    allowedAudiences.push("tenant");
  }
  if (programs.length > 0) {
    allowedAudiences.push("program");
  }
  if (cohorts.length > 0) {
    allowedAudiences.push("cohort");
  }

  return {
    allowedAudiences,
    canCreate: allowedAudiences.length > 0,
    cohorts,
    programs,
  };
}

export function getAnnouncementAudienceLabel(
  announcement: Pick<
    TeamAnnouncementSummary,
    "audience_type" | "cohort_name" | "course_title"
  >,
) {
  if (announcement.audience_type === "tenant") {
    return "All students";
  }
  if (announcement.audience_type === "program") {
    return announcement.course_title
      ? `Program: ${announcement.course_title}`
      : "Program";
  }

  return announcement.cohort_name
    ? `Cohort: ${announcement.cohort_name}`
    : "Cohort";
}

export function buildAnnouncementWriteInput(input: {
  audienceType: AnnouncementAudience;
  body: string;
  cohortId: string;
  cohorts: AnnouncementAudienceOption[];
  courseId: string;
  expiresAt: string | null;
  title: string;
}): AnnouncementWriteInput {
  if (input.audienceType === "tenant") {
    return {
      audienceType: "tenant",
      body: input.body,
      cohortId: null,
      courseId: null,
      expiresAt: input.expiresAt,
      title: input.title,
    };
  }

  if (input.audienceType === "program") {
    if (!input.courseId) {
      throw new Error("Select a Program for this announcement.");
    }

    return {
      audienceType: "program",
      body: input.body,
      cohortId: null,
      courseId: input.courseId,
      expiresAt: input.expiresAt,
      title: input.title,
    };
  }

  const cohort = input.cohorts.find((option) => option.id === input.cohortId);

  if (!cohort) {
    throw new Error("Select an available Cohort for this announcement.");
  }

  return {
    audienceType: "cohort",
    body: input.body,
    cohortId: cohort.id,
    courseId: cohort.courseId,
    expiresAt: input.expiresAt,
    title: input.title,
  };
}

export function getAnnouncementErrorMessage(
  caught: unknown,
  fallback = "Unable to complete the announcement action.",
) {
  const candidate = caught as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";

  if (code === "42501" || /permission|not authorized|authentication/.test(message)) {
    return "Your announcement permission or scope changed. Refresh and try again.";
  }
  if (/not found|no longer available/.test(message)) {
    return "This announcement is no longer available.";
  }
  if (/archived|already published|already archived|only draft|lifecycle|status/.test(message)) {
    return "This announcement was already changed. Its latest state has been refreshed.";
  }
  if (/audience|program|cohort|scope/.test(message)) {
    return "The selected audience is no longer available. Choose an available audience.";
  }
  if (/expiry|expires/.test(message)) {
    return "Choose an expiry later than the current time and publication time.";
  }
  if (/plain text|title and message|required/.test(message)) {
    return "Enter a plain-text title and message before saving.";
  }

  return fallback;
}
