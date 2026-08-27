import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/bundle_ux7e_community_backend_security.sql");
const canonicalPortalAccess = read(
  "supabase/bundle_ux6e1_assignment_student_notifications.sql",
);
const communityLibrary = read("src/lib/community.ts");
const coachCommunity = read("src/components/community/CommunityPageClient.tsx");
const studentCommunity = read(
  "src/components/portal/StudentPortalCommunity.tsx",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return (matches?.[0] ?? "").toLowerCase();
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

function sourceFunction(source: string, name: string) {
  const match = source.match(
    new RegExp(`export async function ${name}\\([\\s\\S]*?(?=\\nexport )`),
  );
  expect(match, `Expected source function ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-7E Community backend security", () => {
  test("keeps PRE read-only and classifies only the known regression smoke post", () => {
    const pre = verificationBlock("PRE-APPLY");
    const sql = executableSql();
    expect(pre).not.toMatch(
      /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/,
    );
    expect(pre).toContain("legacy_all_students_posts");
    expect(pre).toContain("known_regression_smoke_posts");
    expect(pre).toContain("known_regression_smoke_comments");
    expect(pre).toContain("unclassified_business_posts");
    expect(sql).toContain("community posts do not exactly match the classified recovery 4c smoke fixture");
    expect(sql).toContain("community comments must be empty before classified smoke cleanup");
    expect(sql).not.toContain("cascade");
  });

  test("deletes only the exact classified smoke row before scoped constraints", () => {
    const sql = executableSql();
    const deleteMatch = sql.match(
      /delete from public\.community_posts cp[\s\S]*?get diagnostics v_deleted = row_count;/,
    );
    expect(deleteMatch).not.toBeNull();
    const cleanup = deleteMatch?.[0] ?? "";
    expect(cleanup).toContain("e3002920-107d-4f24-b7c9-b1b82eacb8bc");
    expect(cleanup).toContain("29a33701-82ed-4c7f-8042-0a1af8296ce5");
    expect(cleanup).toContain("recovery 4c student post smoke - 2026-07-14t15-37-41-877z");
    expect(cleanup).toContain("cp.status='hidden'");
    expect(cleanup).toContain("cp.audience_type='all_students'");
    expect(cleanup).toContain("cp.post_type='discussion'");
    expect(cleanup).toContain("cp.author_type='student'");
    expect(cleanup).toContain("cp.created_by_student_id is not null");
    expect(cleanup).toContain("not exists(select 1 from public.enrollments");
    expect(cleanup).toContain("not exists(select 1 from public.cohort_members");
    expect(sql.indexOf("delete from public.community_posts cp")).toBeLessThan(
      sql.indexOf("community_posts_scope_shape_check"),
    );
    expect(sql.match(/delete from public\.community_posts/g)).toHaveLength(1);
  });

  test("reuses production author columns and replaces the exact identity constraint", () => {
    const sql = executableSql();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    expect(sql).toContain("add column course_id uuid");
    expect(sql).toContain("add column cohort_id uuid");
    expect(sql).not.toContain("add column created_by_student_id");
    expect(sql).not.toContain("add column hidden_by_user_id");
    expect(sql).not.toContain("add column author_display_name");
    expect(sql).toContain("drop constraint community_posts_author_identity_check");
    expect(pre).toContain("community_posts_created_by_student_id_fkey");
    expect(pre).toContain("community_posts_hidden_by_user_id_fkey");
    expect(pre).toContain("community_posts_author_identity_check");
    expect(post).toContain("author_display_name_preserved");
    expect(post).toContain("author_identity_constraint");
  });

  test("establishes exact Program and Cohort schema without general scope", () => {
    const sql = executableSql();
    const trigger = functionBody("coachfort_internal", "enforce_community_post_scope");
    expect(sql).toContain("audience_type in ('program','cohort')");
    expect(sql).toContain("community_posts_scope_shape_check");
    expect(sql).not.toContain("audience_type in ('tenant'");
    expect(trigger).toContain("v_cohort.course_id is distinct from new.course_id");
    expect(sql).toContain("references public.courses(id) on delete restrict");
    expect(sql).toContain("references public.cohorts(id) on delete restrict");
  });

  test("binds Student access to canonical portal and enrollment semantics", () => {
    const scope = functionBody("coachfort_internal", "community_student_scope_access");
    const post = functionBody("coachfort_internal", "community_student_post_access");
    expect(scope).toContain("p_user_id is distinct from auth.uid()");
    expect(scope).toContain("student_portal_access_allowed_for_user");
    expect(scope).toContain("course_participate");
    expect(scope).toContain("course_read");
    expect(scope).toContain("cm.cohort_id=p_cohort_id");
    expect(post).toContain("v_post.published_at<=e.completed_at");
    expect(post).not.toContain("notifications");

    const canonical = canonicalPortalAccess.match(
      /create or replace function coachfort_internal\.student_portal_access_allowed_for_user\([\s\S]*?\$\$;/i,
    )?.[0].toLowerCase() ?? "";
    expect(canonical).toContain("e.status = 'active'");
    expect(canonical).toContain("e.status = 'completed'");
    expect(canonical).not.toContain("e.status = 'paused'");
    expect(canonical).not.toContain("e.status = 'cancelled'");
  });

  test("implements secure Student top-level post creation", () => {
    const create = functionBody("public", "create_student_community_post_v2");
    expect(create).toContain("community_student_scope_access");
    expect(create).toContain("'write'");
    expect(create).toContain("auth.uid()");
    expect(create).toContain("'published'");
    expect(create).toContain("created_by_student_id");
    expect(communityLibrary).toContain('rpc("create_student_community_post_v2"');
    expect(communityLibrary).toContain("p_course_id: courseId");
    expect(communityLibrary).toContain("p_cohort_id: cohortId");
    expect(
      sourceFunction(communityLibrary, "createStudentCommunityPostV2"),
    ).not.toContain("p_tenant_id");
  });

  test("loads Student Community scopes with Student portal access semantics", () => {
    const scopeLoader = sourceFunction(
      communityLibrary,
      "getStudentCommunityCreateScopes",
    );

    expect(scopeLoader).toContain(
      'getStudentPortalCourses({ ...params, accessMode: "student" })',
    );
    expect(scopeLoader).not.toContain("getStudentPortalCourses(params)");
    expect(scopeLoader).toContain('item.enrollment.status === "active"');
    expect(scopeLoader).toContain('item.course.status === "published"');
    expect(scopeLoader).toContain("getCohortsForStudent(params)");
  });

  test("uses scoped Community copy and accessible scope selectors", () => {
    expect(coachCommunity).not.toContain("All students audience");
    expect(coachCommunity).toContain("Program and Cohort spaces");
    expect(coachCommunity).toContain('htmlFor="coach-community-space"');
    expect(coachCommunity).toContain('id="coach-community-space"');
    expect(studentCommunity).toContain('htmlFor="student-community-space"');
    expect(studentCommunity).toContain('id="student-community-space"');
    expect(coachCommunity.match(/id="coach-community-space"/g)).toHaveLength(1);
    expect(studentCommunity.match(/id="student-community-space"/g)).toHaveLength(
      1,
    );
  });

  test("attributes comments to the exact eligible Student identity", () => {
    const create = functionBody("public", "create_student_community_comment");
    expect(create).toContain("join public.students s");
    expect(create).toContain("spa.user_id=auth.uid()");
    expect(create).toContain("v_post.tenant_id,spa.student_id,auth.uid(),v_post.course_id,v_post.cohort_id,'write'");
    expect(create).toContain("created_by_student_id");
    expect(create).toContain("v_student is null");
    expect(create).not.toMatch(
      /where spa\.user_id=auth\.uid\(\) and spa\.tenant_id=v_post\.tenant_id and spa\.status='active' order by spa\.linked_at limit 1/,
    );
  });

  test("enforces Staff delegation and exact Trainer assignment scope", () => {
    const auth = functionBody("coachfort_internal", "community_team_authorization_context");
    expect(auth).toContain("v_role in ('owner','admin')");
    expect(auth).toContain("v_role not in ('staff','trainer')");
    expect(auth).toContain("find_active_delegated_permission_for_action");
    expect(auth).toContain("array['manage_messages']");
    expect(auth).toContain("ux4b_trainer_can_manage_course");
    expect(auth).toContain("ux4b_trainer_can_manage_cohort");
    expect(auth).not.toContain("role='trainer' then return query");
  });

  test("bounds post and comment feeds with deterministic keyset cursors", () => {
    const feeds = [
      functionBody("public", "get_student_community_posts_v2"),
      functionBody("public", "get_team_community_posts_v2"),
      functionBody("public", "get_student_community_comments_v2"),
      functionBody("public", "get_team_community_comments_v2"),
    ];
    for (const feed of feeds) {
      expect(feed).toContain("p_limit<1 or p_limit>50");
      expect(feed).toContain("limit p_limit");
      expect(feed).not.toContain("offset");
    }
    expect(feeds[0]).toContain("order by cp.published_at desc,cp.id desc");
    expect(feeds[2]).toContain("order by cc.created_at,cc.id");
  });

  test("returns authoritative author names for posts and comments", () => {
    const sql = executableSql();
    for (const fn of [
      "get_student_community_posts_v2",
      "get_team_community_posts_v2",
      "get_student_community_comments_v2",
      "get_team_community_comments_v2",
    ]) {
      const body = functionBody("public", fn);
      expect(body).toContain("public.profiles");
      expect(body).toContain("public.students");
      expect(body).not.toContain("author_display_name");
      expect(body).not.toContain("then 'academy'");
    }
    expect(sql).toContain("community_posts_author_identity_check");
  });

  test("keeps Community writes RPC-only and private helpers private", () => {
    const sql = executableSql();
    expect(sql).toContain("revoke all privileges on table public.community_posts from public,anon,authenticated");
    expect(sql).toContain("revoke all privileges on table public.community_comments from public,anon,authenticated");
    for (const helper of [
      "community_feature_enabled",
      "community_team_authorization_context",
      "community_student_scope_access",
      "community_student_post_access",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function coachfort_internal\\.${helper}\\([\\s\\S]*?from public,anon,authenticated,service_role`));
      expect(sql).not.toMatch(new RegExp(`grant execute on function coachfort_internal\\.${helper}`));
    }
  });

  test("hardens lifecycle, comments, and scoped moderation", () => {
    expect(functionBody("public", "publish_community_post")).toContain("v_existing.status<>'draft'");
    expect(functionBody("public", "archive_community_post")).toContain("v_existing.status<>'published'");
    expect(functionBody("public", "create_student_community_comment")).toContain("'write'");
    expect(functionBody("public", "hide_community_post")).toContain("community_team_authorization_context");
    expect(functionBody("public", "hide_community_comment")).toContain("m69_5_write_audit");
  });

  test("cuts Community to its canonical feature without changing Messages", () => {
    const sql = executableSql();
    const feature = read("src/lib/featureAccess.ts");
    const coachRoute = read("app/app/community/page.tsx");
    const studentRoute = read("app/portal/community/page.tsx");
    expect(sql).toContain("'community_hub'");
    expect(sql).toContain("ux7e_copied_from");
    expect(feature).toContain('Community: "community_hub"');
    expect(coachRoute).toContain('featureKey="community_hub"');
    expect(studentRoute).toContain('featureKey="community_hub"');
    expect(coachRoute).not.toContain('featureKey="messages"');
  });

  test("fails closed on missing feature-plan twins and proves full parity", () => {
    const sql = executableSql();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    for (const signal of [
      "messages_plan_count",
      "community_plan_count",
      "missing_community_plan_rows",
    ]) {
      expect(pre).toContain(signal);
      expect(post).toContain(signal);
    }
    expect(sql).toContain("community feature entitlement plan coverage drift");
    expect(post).toContain("missing_messages_plan_rows");
    expect(post).toContain("entitlement_status,c.requires_platform_approval,c.included_quota");
    expect(post).toContain("messages_plan_count')::integer=(value->'feature_gate'->>'community_plan_count");
    expect(sql).toContain("community is not a canonical subscription feature key");
    expect(post).toContain("subscription_key");
  });

  test("synchronizes tenant Community settings instead of preserving stale state", () => {
    const sql = executableSql();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    for (const signal of [
      "messages_tenant_setting_count",
      "community_tenant_setting_count",
      "missing_community_tenant_twins",
      "missing_messages_tenant_twins",
      "tenant_status_mismatches",
    ]) {
      expect(pre).toContain(signal);
      expect(post).toContain(signal);
    }
    expect(sql).toContain("on conflict (tenant_id, feature_key) do update");
    expect(sql).toContain("set status=excluded.status");
    expect(sql).toContain("community tenant setting has no messages cutover source");
    expect(post).toContain("tenant_cutover_marked");
  });

  test("uses tenant composite keys for setting twins and preserves entitlement ids", () => {
    const sql = executableSql();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    const allBlocks = `${pre}\n${sql}\n${post}`;

    expect(allBlocks).not.toMatch(
      /from public\.tenant_feature_settings[\s\S]{0,300}\b[cm]\.id is null/,
    );
    expect(pre).toContain("c.tenant_id is null");
    expect(pre).toContain("m.tenant_id is null");
    expect(sql).toContain(
      "where c.feature_key='community_hub' and m.tenant_id is null",
    );
    expect(post).toContain("c.tenant_id is null");
    expect(post).toContain("m.tenant_id is null");
    expect(pre).toMatch(
      /subscription_plan_feature_entitlements[\s\S]{0,300}c\.id is null/,
    );
    expect(sql).toMatch(
      /subscription_plan_feature_entitlements[\s\S]{0,300}c\.id is null/,
    );
    expect(sql).toMatch(
      /subscription_plan_feature_entitlements[\s\S]{0,300}m\.id is null/,
    );
    expect(post).toMatch(
      /subscription_plan_feature_entitlements[\s\S]{0,300}c\.id is null/,
    );
    expect(post).toMatch(
      /subscription_plan_feature_entitlements[\s\S]{0,300}m\.id is null/,
    );
  });

  test("derives POST access claims and gates every source proof", () => {
    const post = verificationBlock("POST-APPLY");
    expect(post).not.toContain("'program_read',true");
    expect(post).not.toContain("'owner_admin',true");
    for (const signal of [
      "auth_bound_student",
      "canonical_portal_access",
      "course_participate_write",
      "exact_cohort_membership",
      "exact_comment_student_scope",
      "owner_admin",
      "delegation",
      "trainer_course_scope",
      "trainer_cohort_scope",
      "completed_cutoff",
      "notification_as_access",
    ]) {
      expect(post).toContain(`value->>'${signal}'`);
    }
  });

  test("uses exact RPC ACL identities and rejects unexpected overloads", () => {
    const sql = executableSql();
    expect(sql).toContain("select expected.identity,pg_catalog.to_regprocedure(expected.identity) as procedure_oid");
    expect(sql).toContain("expected community identity missing");
    expect(sql).toContain("unexpected community overloads");
    expect(sql).not.toMatch(/where n\.nspname='public' and p\.proname in \([\s\S]*?grant execute/);
    expect(verificationBlock("POST-APPLY")).toContain("unexpected_overloads");
  });

  test("guards every exact runtime helper before schema changes", () => {
    const sql = executableSql();
    for (const identity of [
      "public.m76b_validate_text(text,text,boolean,integer)",
      "public.m76b_normalize_post_type(text)",
      "public.feature_access_effective_rows(uuid)",
      "public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)",
      "coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)",
      "public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)",
      "public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)",
      "public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)",
      "public.m69_5_write_audit(uuid,text,text,uuid,text,text,text,jsonb)",
    ]) {
      expect(sql).toContain(identity);
    }
    expect(sql).toContain("missing runtime helpers");
    expect(verificationBlock("PRE-APPLY")).toContain("required_helpers");
  });

  test("cuts active create callers to exact-scope V2 without ambiguous fallback", () => {
    const sql = executableSql();
    expect(communityLibrary).toContain('rpc("create_team_community_post_v2"');
    expect(communityLibrary).toContain('rpc("create_student_community_post_v2"');
    expect(coachCommunity).toContain("selectedCreateScope.courseId");
    expect(coachCommunity).toContain("selectedCreateScope.cohortId");
    expect(studentCommunity).toContain("selectedScope.courseId");
    expect(studentCommunity).toContain("selectedScope.cohortId");
    expect(studentCommunity).not.toContain("context.tenant.id,\n        title");
    expect(coachCommunity).toContain("Choose a Community space");
    expect(studentCommunity).toContain("Choose a Community space");
    expect(coachCommunity).toContain("createScopes.length === 1");
    expect(studentCommunity).toContain("createScopes.length === 1");
    expect(coachCommunity).toContain("return fallback");
    expect(studentCommunity).toContain("return fallback");
    expect(communityLibrary).toContain('item.enrollment.status === "active"');
    expect(communityLibrary).toContain('item.course.status === "published"');
    expect(communityLibrary).toContain('permission.permission_key === "manage_messages"');
    expect(sql).toContain(
      "drop function public.create_team_community_post(uuid,text,text,text)",
    );
    expect(sql).toContain(
      "drop function public.create_student_community_post(uuid,text,text,text)",
    );
    expect(sql).not.toContain(
      "drop function if exists public.create_student_community_post(uuid,text,text,text)",
    );
    expect(sql).not.toContain(
      "function public.create_team_community_post(p_tenant_id uuid,p_title text",
    );
    expect(sql).not.toContain(
      "function public.create_student_community_post(p_tenant_id uuid,p_title text",
    );
  });

  test("records the drifted create baseline and verifies the final 11 plus 6 contract", () => {
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    expect(pre).toContain(
      "public.create_student_community_post(uuid,text,text,text)",
    );
    expect(post).toContain("'legacy_count')::integer=11");
    expect(post).toContain("'v2_count')::integer=6");
    expect(post).toContain("legacy_student_create_absent");
    expect(post).toContain("legacy_team_create_absent");
    expect(post).toContain("'posts')::integer=0");
    expect(post).toContain("'comments')::integer=0");
    expect(post).toContain("'legacy_all_students_posts')::integer=0");
    expect(post).toContain("v2_profile_author_source");
    expect(post).toContain("v2_student_author_source");
    expect(post).toContain("v2_author_display_name_source");
  });

  test("preserves announcement and Chat contracts and bounded read compatibility", () => {
    const sql = executableSql();
    expect(sql).toContain("temporary ux-7f cutover compatibility");
    expect(functionBody("public", "get_student_community_posts")).toContain(
      "get_student_community_posts_v2(null,null,25,null,null)",
    );
    expect(functionBody("public", "get_team_community_posts")).toContain(
      "get_team_community_posts_v2(p_tenant_id,null,null,null,25,null,null)",
    );
    expect(sql).not.toMatch(/(?:alter table|create or replace function|drop function).*academy_announcements/);
    expect(sql).not.toMatch(/(?:alter table|create or replace function|drop function).*(conversation_threads|conversation_messages|conversation_participants)/);
    const post = verificationBlock("POST-APPLY");
    expect(post).toContain("announcement_baseline");
    expect(post).toContain("chat_baseline");
    expect(post).toContain("security_gate");
  });
});
