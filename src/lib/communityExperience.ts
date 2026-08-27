export type CommunityScopeReference = {
  canWrite: boolean;
  cohortId: string | null;
  courseId: string;
};

export type CommunityPostReference = {
  cohort_id: string | null;
  course_id: string;
};

export type CommunityMutationOutcome =
  | {
      mutationError: unknown;
      mutationSucceeded: false;
      refreshSucceeded: boolean;
    }
  | {
      mutationSucceeded: true;
      refreshSucceeded: boolean;
    };

export const communityPageSize = 20;

export function communityPostMatchesScope(
  post: CommunityPostReference,
  scope: Pick<CommunityScopeReference, "cohortId" | "courseId">,
) {
  return post.course_id === scope.courseId && post.cohort_id === scope.cohortId;
}

export function canWriteCommunityPost(
  post: CommunityPostReference,
  scopes: CommunityScopeReference[],
) {
  return scopes.some((scope) => scope.canWrite && communityPostMatchesScope(post, scope));
}

export function appendUniqueCommunityItems<T extends { id: string }>(
  current: T[],
  incoming: T[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values());
}

export async function executeCommunityMutation(input: {
  mutate: () => Promise<unknown>;
  onMutationSuccess: () => void;
  refresh: () => Promise<boolean>;
}): Promise<CommunityMutationOutcome> {
  try {
    await input.mutate();
  } catch (mutationError) {
    let refreshSucceeded = false;

    try {
      refreshSucceeded = await input.refresh();
    } catch {
      refreshSucceeded = false;
    }

    return { mutationError, mutationSucceeded: false, refreshSucceeded };
  }

  input.onMutationSuccess();

  try {
    return {
      mutationSucceeded: true,
      refreshSucceeded: await input.refresh(),
    };
  } catch {
    return { mutationSucceeded: true, refreshSucceeded: false };
  }
}
