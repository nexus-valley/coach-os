import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g4a2c_chat_monthly_meter_integration.sql",
);
const academyChat = read("src/lib/academyChat.ts");
const coachList = read("src/components/messages/MessagesPageClient.tsx");
const coachThread = read("src/components/messages/ThreadDetailClient.tsx");
const studentPortal = read("src/components/portal/StudentPortalMessages.tsx");
const legacyMessages = read("src/lib/messages.ts");
const legacyConversations = read("src/lib/conversations.ts");
const demoWorkspace = read("src/lib/demoWorkspace.ts");

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function executableSqlWithoutFunctionBodies() {
  return executableSql()
    .replace(
      /create (?:or replace )?function[\s\S]*?\bas \$\$[\s\S]*?^\$\$;/gm,
      "",
    )
    .replace(/do \$\$[\s\S]*?^\$\$;/gm, "");
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1].toLowerCase() ?? "";
}

function functionBody(signatureStart: string) {
  const escaped = signatureStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = executableSql().match(
    new RegExp(`create function ${escaped}[\\s\\S]*?\\n\\$\\$;`, "i"),
  );
  expect(match, `Expected ${signatureStart}`).not.toBeNull();
  return match?.[0] ?? "";
}

const meteredFunctions = [
  "public.create_student_direct_chat(",
  "public.create_student_support_thread(",
  "public.send_team_chat_message(",
  "public.send_student_chat_message(",
];

test.describe("UX-8G4A2C Chat monthly meter integration", () => {
  test("1. wraps one additive APPLY transaction in decisive read-only verification", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("a2a_feature_authority");
    expect(pre).toContain("a2b_meter_authority");
    expect(pre).toContain("exact_writer_gate");
    expect(pre).toContain("browser_write_gate");
    expect(post).toContain("security_gate");
    expect(post).toContain("new_runtime_contract");
    expect(post).toContain("metered_compatibility_contract");
    expect(post).toContain("exact_writer_contract");
  });

  test("2. adds nullable durable request identity without rewriting history", () => {
    const sql = executableSql();
    const structuralSql = executableSqlWithoutFunctionBodies();

    expect(sql).toContain("add column request_id uuid");
    expect(sql).toContain(
      "create unique index conversation_messages_tenant_request_unique_idx",
    );
    expect(sql).toContain("(tenant_id, request_id)");
    expect(sql).toContain("where request_id is not null");
    expect(sql).toContain("conversation_messages_request_id_immutable");
    expect(structuralSql).not.toMatch(
      /update\s+public\.conversation_messages[\s\S]*request_id/,
    );
  });

  test("3. preserves actor, lifecycle, and messages entitlement before request identity", () => {
    const expectedAuthority = [
      "chat_team_can_start_student_thread",
      "chat_student_context",
      "chat_team_can_access_thread",
      "chat_student_can_access_thread",
    ];

    meteredFunctions.forEach((signature, index) => {
      const body = functionBody(signature);
      expect(body).toContain(expectedAuthority[index]);
      expect(body).toContain("assert_effective_operational_feature");
      expect(body).toContain("'messages'");
      expect(body).toContain("chat_request_lock");
      expect(body.indexOf(expectedAuthority[index])).toBeLessThan(
        body.indexOf("assert_effective_operational_feature"),
      );
      expect(body.indexOf("assert_effective_operational_feature")).toBeLessThan(
        body.indexOf("chat_request_lock"),
      );
    });
  });

  test("4. detects business replay before period-scoped meter consumption", () => {
    for (const signature of meteredFunctions) {
      const body = functionBody(signature);
      expect(body).toContain("message.request_id = p_request_id");
      expect(body).toContain("chat_request_operation");
      expect(body).toContain("chat request id conflicts with a prior action");
      expect(body.indexOf("message.request_id = p_request_id")).toBeLessThan(
        body.indexOf("consume_monthly_usage"),
      );
      expect(body.indexOf("return existing_")).toBeLessThan(
        body.indexOf("consume_monthly_usage"),
      );
      expect(body).not.toContain("period_start");
    }
  });

  test("5. rejects conflicting sender, thread, student, title, and body reuse", () => {
    const direct = functionBody("public.create_student_direct_chat(");
    const support = functionBody("public.create_student_support_thread(");
    const team = functionBody("public.send_team_chat_message(");
    const student = functionBody("public.send_student_chat_message(");

    expect(direct).toContain("existing_thread.student_id is distinct from p_student_id");
    expect(direct).toContain("existing_thread.title is distinct from normalized_title");
    expect(direct).toContain("existing_message.sender_user_id is distinct from actor_id");
    expect(support).toContain("existing_thread.student_id is distinct from ctx.student_id");
    expect(support).toContain("existing_thread.title is distinct from normalized_title");
    expect(team).toContain("existing_message.thread_id is distinct from thread_row.id");
    expect(team).toContain("existing_message.message is distinct from normalized_body");
    expect(student).toContain(
      "existing_message.sender_student_id is distinct from ctx.student_id",
    );
  });

  test("6. consumes exactly one server-derived messages unit before business writes", () => {
    for (const signature of meteredFunctions) {
      const body = functionBody(signature);
      expect(body).toContain("'messages_monthly'");
      expect(body).toContain("'chat:' || p_request_id::text");
      expect(body).toContain(", 1");
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("insert into public.conversation_messages"),
      );
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("update public.conversation_threads"),
      );
    }

    for (const signature of meteredFunctions.slice(0, 2)) {
      const body = functionBody(signature);
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("insert into public.conversation_threads"),
      );
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("add_default_team_chat_participants"),
      );
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("chat_insert_audit"),
      );
    }
  });

  test("7. serializes concurrent requests independently of the UTC meter period", () => {
    const lock = functionBody("coachfort_internal.chat_request_lock(");
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain("p_tenant_id::text");
    expect(lock).toContain("p_request_id::text");
    expect(lock).not.toContain("period_start");
    expect(lock).not.toContain("date_trunc");
  });

  test("8. keeps old clients metered while requiring a later legacy-overload removal", () => {
    const sql = executableSql();
    for (const identity of [
      "public.create_student_direct_chat(uuid,uuid,text,text)",
      "public.create_student_support_thread(text,text)",
      "public.send_team_chat_message(uuid,text)",
      "public.send_student_chat_message(uuid,text)",
    ]) {
      expect(sql).toContain(`grant execute on function ${identity}`);
    }
    expect(sql.match(/gen_random_uuid\(\)/g)).toHaveLength(4);
    expect(sql).toContain("ux-8g4a2c2 removes these identities");
    expect(verifier("POST-APPLY")).toContain("authenticated_execute = 8");
  });

  test("9. preserves private helpers, exact RPC ACLs, and denied table writes", () => {
    const sql = executableSql();
    const post = verifier("POST-APPLY");
    expect(sql).toContain(
      "revoke all on function coachfort_internal.chat_request_lock(uuid,uuid)",
    );
    expect(post).toContain("anon_execute = 0");
    expect(post).toContain("service_execute = 0");
    expect(post).toContain("public_execute = 0");
    expect(post).toContain("no_browser_writes");
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*on\s+(?:table\s+)?public\.conversation_/,
    );
  });

  test("10. updates every active browser caller with retained UUID retry identity", () => {
    expect(academyChat).toContain("return crypto.randomUUID()");
    expect(academyChat.match(/p_request_id: input\.requestId/g)).toHaveLength(4);

    for (const source of [coachList, coachThread, studentPortal]) {
      expect(source).toContain("createChatRequestId");
      expect(source).toContain("fingerprint");
      expect(source).toContain(".current?.fingerprint === fingerprint");
    }
    expect(coachList).toContain("directChatRequest.current = null");
    expect(coachThread).toContain("sendRequest.current = null");
    expect(studentPortal).toContain("supportRequest.current = null");
    expect(studentPortal).toContain("replyRequest.current = null");
  });

  test("11. maps quota denial to customer-safe Coach and Student presentation", () => {
    expect(academyChat).toContain("You've reached your monthly messaging limit.");
    expect(academyChat).toContain(
      "Messaging is temporarily unavailable for this workspace. Please contact your coach.",
    );
    expect(coachList).toContain('href="/app/subscription"');
    expect(coachThread).toContain('href="/app/subscription"');

    for (const source of [coachList, coachThread, studentPortal]) {
      expect(source).not.toMatch(/messages_monthly|sqlstate|limit resolver|override/i);
    }
  });

  test("12. leaves Community, Announcements, Automation, and AI outside this meter", () => {
    const sql = executableSql();
    for (const forbidden of [
      "community_posts",
      "community_comments",
      "community_hub",
      "automation_runs_monthly",
      "ai_requests_monthly",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
    expect(sql).toContain("'course_announcement', 'cohort_announcement'");
    expect(sql).toContain("then 'announcement' else 'text' end");
  });

  test("13. confirms retired writers fail closed and demo writes have no browser authority", () => {
    for (const source of [legacyMessages, legacyConversations]) {
      expect(source).toContain(
        "Legacy conversation writes are retired. Use the Academy Chat module.",
      );
    }
    expect(demoWorkspace).toContain('insertTracked("conversation_messages"');
    expect(verifier("PRE-APPLY")).toContain("browser_write_gate");
    expect(verifier("POST-APPLY")).toContain("no_browser_writes");
  });

  test("14. installation changes schema and functions without creating business rows", () => {
    const structuralSql = executableSqlWithoutFunctionBodies();
    expect(structuralSql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\./,
    );
    expect(structuralSql).not.toContain("subscription_plan_usage_limits");
    expect(structuralSql).not.toContain("tenant_subscription_assignments");
    expect(verifier("PRE-APPLY")).toContain("conversation_messages");
    expect(verifier("PRE-APPLY")).toContain("monthly_usage_events");
    expect(verifier("POST-APPLY")).toContain("conversation_messages");
    expect(verifier("POST-APPLY")).toContain("monthly_usage_events");
  });
});
