import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendUniqueCommunityItems,
  canWriteCommunityPost,
  communityPageSize,
  communityPostMatchesScope,
  executeCommunityMutation,
  type CommunityScopeReference,
} from "../../src/lib/communityExperience";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const library = read("src/lib/community.ts");
const coach = read("src/components/community/CommunityPageClient.tsx");
const student = read("src/components/portal/StudentPortalCommunity.tsx");
const selector = read("src/components/community/CommunitySpaceSelector.tsx");
const postCard = read("src/components/community/CommunityPostCard.tsx");
const dialog = read("src/components/community/CommunityDialog.tsx");
const coachRoute = read("app/app/community/page.tsx");
const studentRoute = read("app/portal/community/page.tsx");

type TestScope = CommunityScopeReference & {
  description: string;
  key: string;
  kind: "cohort" | "program";
  label: string;
};

const activeProgram: TestScope = {
  canWrite: true,
  cohortId: null,
  courseId: "course-a",
  description: "Active Program",
  key: "program:course-a",
  kind: "program",
  label: "Program A",
};
const activeCohort: TestScope = {
  canWrite: true,
  cohortId: "cohort-a",
  courseId: "course-a",
  description: "Active Cohort",
  key: "cohort:cohort-a",
  kind: "cohort",
  label: "Cohort A",
};
const completedProgram: TestScope = {
  ...activeProgram,
  canWrite: false,
  courseId: "course-b",
  key: "program:course-b",
  label: "Program B",
};

test.describe("UX-7F flagship Community experience", () => {
  test("correlates write access to the exact Program or Cohort space", () => {
    const programPost = { cohort_id: null, course_id: "course-a" };
    const cohortPost = { cohort_id: "cohort-a", course_id: "course-a" };
    const otherCohortPost = { cohort_id: "cohort-b", course_id: "course-a" };

    expect(communityPostMatchesScope(programPost, activeProgram)).toBe(true);
    expect(communityPostMatchesScope(cohortPost, activeProgram)).toBe(false);
    expect(communityPostMatchesScope(cohortPost, activeCohort)).toBe(true);
    expect(canWriteCommunityPost(programPost, [activeProgram, activeCohort])).toBe(true);
    expect(canWriteCommunityPost(cohortPost, [activeProgram, activeCohort])).toBe(true);
    expect(canWriteCommunityPost(otherCohortPost, [activeProgram, activeCohort])).toBe(false);
    expect(
      canWriteCommunityPost(
        { cohort_id: null, course_id: "course-b" },
        [completedProgram],
      ),
    ).toBe(false);
  });

  test("keeps mutation success distinct from refresh failure", async () => {
    let successCalls = 0;
    const outcome = await executeCommunityMutation({
      mutate: async () => undefined,
      onMutationSuccess: () => {
        successCalls += 1;
      },
      refresh: async () => false,
    });

    expect(outcome).toEqual({ mutationSucceeded: true, refreshSucceeded: false });
    expect(successCalls).toBe(1);
  });

  test("does not report mutation success when the secure RPC fails", async () => {
    let successCalls = 0;
    const outcome = await executeCommunityMutation({
      mutate: async () => {
        throw new Error("controlled failure");
      },
      onMutationSuccess: () => {
        successCalls += 1;
      },
      refresh: async () => true,
    });

    expect(outcome.mutationSucceeded).toBe(false);
    expect(outcome.refreshSucceeded).toBe(true);
    expect(successCalls).toBe(0);
  });

  test("deduplicates keyset pages without discarding refreshed rows", () => {
    expect(
      appendUniqueCommunityItems(
        [
          { id: "one", value: 1 },
          { id: "two", value: 2 },
        ],
        [
          { id: "two", value: 20 },
          { id: "three", value: 3 },
        ],
      ),
    ).toEqual([
      { id: "one", value: 1 },
      { id: "two", value: 20 },
      { id: "three", value: 3 },
    ]);
  });

  test("uses bounded V2 keyset feeds for posts and comments", () => {
    expect(communityPageSize).toBe(20);
    for (const rpc of [
      "get_student_community_posts_v2",
      "get_student_community_comments_v2",
      "get_team_community_posts_v2",
      "get_team_community_comments_v2",
    ]) {
      expect(library).toContain(`rpc("${rpc}"`);
    }
    expect(library).toContain("p_cursor_published_at: params.cursor?.timestamp ?? null");
    expect(library).toContain("p_cursor_updated_at: params.cursor?.timestamp ?? null");
    expect(library).toContain("p_cursor_created_at: params.cursor?.timestamp ?? null");
    expect(library).toContain("p_cursor_id: params.cursor?.id ?? null");
    expect(coach).toContain("appendUniqueCommunityItems");
    expect(student).toContain("appendUniqueCommunityItems");
    expect(coach).toContain("Load more posts");
    expect(student).toContain("Load more posts");
  });

  test("shares accessible space, post, and confirmation primitives", () => {
    for (const page of [coach, student]) {
      expect(page).toContain("CommunitySpaceSelector");
      expect(page).toContain("CommunityPostCard");
      expect(page).toContain("CommunityDialog");
    }
    expect(selector).toMatch(/<FormField[\s\S]*?htmlFor=\{id\}/);
    expect(selector).toContain("id={id}");
    expect(postCard).toContain("<article");
    expect(postCard).toContain("aria-pressed={isSelected}");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('event.key === "Escape"');
  });

  test("supports explicit multi-space choice and single-space convenience", () => {
    for (const page of [coach, student]) {
      expect(page).toContain("nextSpaces.length === 1");
      expect(page).toContain("selectedSpace");
    }
    expect(selector).toContain("Choose a Community space");
    expect(selector).toContain("Program");
    expect(selector).toContain("Cohort");
    expect(selector).toContain("Read only");
  });

  test("keeps completed Student spaces readable but not writable", () => {
    expect(library).toContain('item.enrollment.status === "active"');
    expect(library).toContain('item.enrollment.status === "completed"');
    expect(student).toContain("selectedSpace && !selectedSpace.canWrite");
    expect(student).toContain("canWriteCommunityPost(selectedPost, spaces)");
    expect(student).toContain("Read-only history");
    expect(student).not.toContain("getStudentCommunityCreateScopes");
  });

  test("preserves Coach moderation and Draft lifecycle confirmations", () => {
    expect(coach).toContain('{ label: "Draft", value: "draft" }');
    expect(coach).toContain('{ label: "Published", value: "published" }');
    expect(coach).toContain("Publish post");
    expect(coach).toContain("Archive post");
    expect(coach).toContain("Hide post");
    expect(coach).toContain("Hide comment");
    expect(coach).toContain("setConfirmation");
    expect(coach).toContain("executeCommunityMutation");
  });

  test("retains the Community feature gate and browser security boundary", () => {
    expect(coachRoute).toContain('featureKey="community_hub"');
    expect(studentRoute).toContain('featureKey="community_hub"');
    for (const source of [library, coach, student]) {
      expect(source).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE/);
      expect(source).not.toMatch(/\.from\(["']community_(?:posts|comments)["']\)\.(?:insert|update|delete)/);
    }
    expect(library).toContain('rpc("create_team_community_post_v2"');
    expect(library).toContain('rpc("create_student_community_post_v2"');
  });

  test("uses scoped product language and responsive layouts", () => {
    const customerFacing = [coach, student, selector, postCard].join("\n");
    expect(customerFacing).not.toContain("All students audience");
    expect(customerFacing).not.toContain("Academy");
    expect(coach).toContain("Program and Cohort discussions");
    expect(student).toContain("Program and Cohort discussions");
    expect(coach).toContain("lg:grid-cols");
    expect(student).toContain("lg:grid-cols");
  });
});
