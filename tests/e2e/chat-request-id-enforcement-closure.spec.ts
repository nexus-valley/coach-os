import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const closure = read(
  "supabase/bundle_ux8g4a2c2_chat_request_id_enforcement_closure.sql",
);
const bridge = read(
  "supabase/bundle_ux8g4a2c_chat_monthly_meter_integration.sql",
);
const academyChat = read("src/lib/academyChat.ts");
const coachList = read("src/components/messages/MessagesPageClient.tsx");
const coachThread = read("src/components/messages/ThreadDetailClient.tsx");
const studentPortal = read("src/components/portal/StudentPortalMessages.tsx");

const oldIdentities = [
  "public.create_student_direct_chat(uuid,uuid,text,text)",
  "public.create_student_support_thread(text,text)",
  "public.send_team_chat_message(uuid,text)",
  "public.send_student_chat_message(uuid,text)",
];

const newIdentities = [
  "public.create_student_direct_chat(uuid,uuid,text,text,uuid)",
  "public.create_student_support_thread(text,text,uuid)",
  "public.send_team_chat_message(uuid,text,uuid)",
  "public.send_student_chat_message(uuid,text,uuid)",
];

function executableSql() {
  const matches = closure.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function structuralSql() {
  return executableSql().replace(/do \$\$[\s\S]*?^\$\$;/gm, "");
}

function cteProjections(name: string, fromExpression: string) {
  const matches = [
    ...executableSql().matchAll(
      new RegExp(
        `${name} as \\(\\s*select([\\s\\S]*?)\\s+from ${fromExpression}`,
        "g",
      ),
    ),
  ];

  expect(matches, `Expected two ${name} projections`).toHaveLength(2);
  return matches.map((match) => match[1].replace(/\s+/g, " ").trim());
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = closure.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1].toLowerCase() ?? "";
}

function bridgeFunctionBody(signatureStart: string) {
  const escaped = signatureStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = bridge.toLowerCase().match(
    new RegExp(`create function ${escaped}[\\s\\S]*?\\n\\$\\$;`, "i"),
  );
  expect(match, `Expected ${signatureStart}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8G4A2C2 Chat request-ID enforcement closure", () => {
  test("1. requires the exact installed A2C1 bridge before APPLY", () => {
    const pre = verifier("PRE-APPLY");

    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("request_aware_writer_contract");
    expect(pre).toContain("legacy_metered_wrapper_contract");
    expect(pre).toContain("exact_bridge_identity_contract");
    expect(pre).toContain("exact_direct_writer_contract");
    expect(pre).toContain("exact_bridge_identity_contract");
    expect(pre).toContain("authenticated_execute = 4");
    expect(pre).toContain("anon_execute = 0");
    expect(pre).toContain("service_execute = 0");
    expect(pre).toContain("public_execute = 0");
    for (const kind of ["new", "old"]) {
      expect(pre).toMatch(
        new RegExp(
          `select count\\(\\*\\) = 1\\s+and bool_and\\([\\s\\S]*?from function_acl\\s+where kind = '${kind}'`,
        ),
      );
    }
    expect(pre).not.toMatch(
      /select count\(\*\) = 1\s+and authenticated_execute = 4[\s\S]*?from function_acl/,
    );

    for (const identity of [...newIdentities, ...oldIdentities]) {
      expect(pre).toContain(identity);
    }
  });

  test("2. drops exactly the four legacy identities without CASCADE", () => {
    const sql = structuralSql();
    const drops = [...sql.matchAll(/drop function ([^;]+);/g)].map(
      (match) => match[1].trim(),
    );

    expect(drops).toEqual(oldIdentities);
    expect(sql).not.toContain("cascade");
    for (const identity of newIdentities) {
      expect(sql).not.toContain(`drop function ${identity}`);
    }
  });

  test("3. performs no business DML or runtime-function rewrite", () => {
    const sql = structuralSql();

    expect(sql).not.toMatch(/\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:public|coachfort_internal)\./);
    expect(sql).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/);
    expect(sql).not.toMatch(/\balter\s+function\b/);
    expect(sql).not.toMatch(/\bgrant\b|\brevoke\b/);
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  test("4. preserves protected data and adjacent authority during APPLY", () => {
    const sql = executableSql();

    for (const relation of [
      "conversation_threads",
      "conversation_participants",
      "conversation_messages",
      "monthly_usage_counters",
      "monthly_usage_consumption_events",
    ]) {
      expect(sql).toContain(`baseline.${relation}`);
    }
    expect(sql).toContain("adjacent_authority_contract");
    expect(sql).toContain("community_posts");
    expect(sql).toContain("community_comments");
    expect(sql).toContain("academy_announcements");
    expect(sql).toContain("a2c2 changed protected data or adjacent authorities");

    const functionShapes = cteProjections(
      "adjacent_functions",
      "pg_catalog\\.pg_proc procedure",
    );
    const relationShapes = cteProjections(
      "adjacent_relations",
      "pg_catalog\\.pg_class class",
    );
    const policyShapes = cteProjections(
      "adjacent_policies",
      "pg_catalog\\.pg_policies policy",
    );

    expect(functionShapes[0]).toBe(functionShapes[1]);
    expect(functionShapes[0]).not.toMatch(/(?:^|,\s*)procedure\.oid\s*(?:,|$)/);
    expect(relationShapes[0]).toBe(relationShapes[1]);
    expect(policyShapes[0]).toBe(policyShapes[1]);
  });

  test("5. POST requires all legacy overloads absent and only four named RPCs", () => {
    const post = verifier("POST-APPLY");

    expect(post).toContain("legacy_identities_absent");
    expect(post).toContain("exact_named_rpc_inventory");
    expect(post).toContain("no_alternate_writer_wrapper");
    expect(post).toContain("security_gate");
    for (const identity of oldIdentities) {
      expect(post).toContain(identity);
    }
  });

  test("6. retains the four request-aware writer bodies and ordering", () => {
    const post = verifier("POST-APPLY");

    for (const identity of newIdentities) {
      expect(post).toContain(identity);
    }
    for (const signature of [
      "public.create_student_direct_chat(",
      "public.create_student_support_thread(",
      "public.send_team_chat_message(",
      "public.send_student_chat_message(",
    ]) {
      const body = bridgeFunctionBody(signature);
      expect(body).toContain("assert_effective_operational_feature");
      expect(body).toContain("chat_request_lock");
      expect(body).toContain("message.request_id = p_request_id");
      expect(body).toContain("consume_monthly_usage");
      expect(body).toContain("'messages_monthly'");
      expect(body.indexOf("message.request_id = p_request_id")).toBeLessThan(
        body.indexOf("consume_monthly_usage"),
      );
      expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
        body.indexOf("insert into public.conversation_messages"),
      );
      expect(body).not.toContain("gen_random_uuid()");
    }
  });

  test("7. retains durable request schema, immutability, and private helpers", () => {
    const post = verifier("POST-APPLY");

    expect(post).toContain("request_column_contract");
    expect(post).toContain("request_unique_contract");
    expect(post).toContain("request_immutable_contract");
    expect(post).toContain("private_helper_contract");
    expect(post).toContain("request_validation_contract");
    expect(post).toContain("p_request_id is null");
    expect(post).toContain("pg_advisory_xact_lock");
  });

  test("8. keeps exact browser and function ACL boundaries", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    expect(pre).toContain("browser_write_contract");
    expect(post).toContain("browser_write_contract");
    expect(post).toContain("authenticated_execute = 4");
    expect(post).toContain("anon_execute = 0");
    expect(post).toContain("service_execute = 0");
    expect(post).toContain("public_execute = 0");
    expect(structuralSql()).not.toMatch(/\bgrant\b|\brevoke\b/);
  });

  test("9. keeps every application caller on explicit durable request IDs", () => {
    const callers = [...academyChat.matchAll(/\.rpc\("([^\"]+)"/g)].map(
      (match) => match[1],
    );
    const chatCallers = callers.filter((name) =>
      [
        "create_student_direct_chat",
        "create_student_support_thread",
        "send_team_chat_message",
        "send_student_chat_message",
      ].includes(name),
    );

    expect(chatCallers).toEqual([
      "create_student_direct_chat",
      "create_student_support_thread",
      "send_team_chat_message",
      "send_student_chat_message",
    ]);
    expect(academyChat.match(/p_request_id: input\.requestId/g)).toHaveLength(4);
    expect(academyChat).toContain("return crypto.randomUUID()");
  });

  test("10. preserves request IDs across uncertain UI retries", () => {
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

  test("11. keeps Community and Announcements outside the closure", () => {
    const post = verifier("POST-APPLY");
    const sql = structuralSql();

    expect(post).toContain("adjacent_domain_separation");
    expect(post).toContain("adjacent_authority_inventory");
    expect(sql).not.toMatch(/drop function [^;]*(?:community|announcement)/);
    expect(sql).not.toMatch(/\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:community|academy_announcements)/);
  });
});
