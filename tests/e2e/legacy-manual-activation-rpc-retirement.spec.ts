import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "supabase",
  "bundle_ux8g4b0b_legacy_manual_activation_rpc_retirement.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const g4b0aMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "bundle_ux8g4b0a_manual_activation_authority_replacement.sql",
  ),
  "utf8",
);
const route = fs.readFileSync(
  path.join(root, "app/api/platform/manual-subscription-activation/route.ts"),
  "utf8",
);
const platform = fs.readFileSync(path.join(root, "src/lib/platform.ts"), "utf8");
const panel = fs.readFileSync(
  path.join(root, "src/components/platform/ManualActivationPanel.tsx"),
  "utf8",
);
const activeSource = [route, platform, panel].join("\n");

const legacyIdentity =
  "public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)";
const canonicalIdentity =
  "public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)";
const pre = migration.slice(
  migration.indexOf("PRE-APPLY READ-ONLY VERIFICATION"),
  migration.indexOf("APPLY (TRANSACTIONAL"),
);
const apply = migration.slice(
  migration.indexOf("APPLY (TRANSACTIONAL"),
  migration.indexOf("POST-APPLY READ-ONLY VERIFICATION"),
);
const post = migration.slice(
  migration.indexOf("POST-APPLY READ-ONLY VERIFICATION"),
);
const canonicalAuthority = g4b0aMigration.slice(
  g4b0aMigration.indexOf(
    "create function public.activate_tenant_subscription_manual_authority_server(",
  ),
  g4b0aMigration.indexOf(
    "comment on function public.activate_tenant_subscription_manual_authority_server(",
  ),
);

const canonicalBehaviorMarkers = [
  "from public.platform_admin_users platform_actor",
  "platform_actor.role in ('owner','admin')",
  "from public.subscription_plans plan",
  "from public.subscription_plan_prices price",
  "v_period_start + interval '1 month'",
  "v_period_start + interval '1 year'",
  "v_period_end + interval '7 days'",
  "request_fingerprint",
  "extensions.digest",
  "pg_advisory_xact_lock",
  "manual_operator_verified",
  "insert into public.platform_tenant_subscriptions",
  "canonical renewal or plan-change authority is required",
  "v_current.status <> 'trial'",
  "('within_trial_period','trial_period_elapsed')",
];

function canonicalBehaviorPasses(source: string) {
  const normalized = source.toLowerCase();
  return (
    canonicalBehaviorMarkers.every((marker) => normalized.includes(marker)) &&
    !["149900", "599900", "insert into public.tenant_payment_orders",
      "insert into public.invoices", "insert into public.subscriptions",
      "update public.tenants"].some((marker) => normalized.includes(marker))
  );
}

test.describe("UX-8G4B0B legacy manual activation RPC retirement", () => {
  test("1. active application source has no legacy RPC caller", () => {
    expect(route).toContain(
      '.rpc(\n      "activate_tenant_subscription_manual_authority_server"',
    );
    expect(platform).toContain(
      'fetch("/api/platform/manual-subscription-activation"',
    );
    expect(panel).toContain("activateTenantSubscriptionManual");
    expect(activeSource).not.toMatch(
      /\.rpc\(\s*["']activate_tenant_subscription_manual["']/,
    );
  });

  test("2. PRE requires the exact legacy and canonical identities", () => {
    expect(pre).toContain(legacyIdentity);
    expect(pre).toContain(canonicalIdentity);
    expect(pre).toContain("manual_rpc_inventory.total_count = 2");
    expect(pre).toContain("manual_rpc_inventory.legacy_count = 1");
    expect(pre).toContain("manual_rpc_inventory.canonical_count = 1");
  });

  test("3. unexpected legacy metadata fails PRE and APPLY", () => {
    for (const verifier of [pre, apply]) {
      expect(verifier).toContain("pg_get_userbyid(procedure.proowner) = 'postgres'");
      expect(verifier).toContain("procedure.prosecdef");
      expect(verifier).toContain("procedure.proconfig = array['search_path=public']");
      expect(verifier).toContain(
        "has_function_privilege('authenticated', procedure.oid, 'EXECUTE')",
      );
      expect(verifier).toContain(
        "not has_function_privilege('service_role', procedure.oid, 'EXECUTE')",
      );
    }
  });

  test("4. catalog and source dependency checks fail closed", () => {
    for (const verifier of [pre, apply]) {
      expect(verifier).toContain("from pg_depend dependency");
      expect(verifier).toContain("dependency.refobjid");
      expect(verifier).toContain("from pg_trigger");
      expect(verifier).toContain(
        "activate_tenant_subscription_manual[[:space:]]*[(]",
      );
    }
    expect(pre).toContain("dependency_inventory");
    expect(pre).toContain("source_reference_inventory");
  });

  test("5. enabled global DDL event triggers are inventoried without false authority claims", () => {
    expect(pre).toContain("ddl_event_trigger_inventory as");
    expect(pre).toContain("event_trigger.evtevent in ('sql_drop','ddl_command_end')");
    expect(pre).toContain("enabled_relevant_event_trigger_count");
    expect(migration).not.toContain("event_trigger.evtfoid = identities.legacy_rpc");
  });

  test("6. APPLY drops only the exact legacy signature without CASCADE", () => {
    expect(apply).toContain(
      "drop function public.activate_tenant_subscription_manual(\n" +
        "  uuid,text,text,text,bigint,text,\n" +
        "  timestamptz,timestamptz,text,text,timestamptz,\n" +
        "  text,text,timestamptz,text,text,boolean\n" +
        ") restrict;",
    );
    expect(apply).not.toMatch(/drop\s+function[\s\S]{0,300}\bcascade\b/i);
    expect(migration.match(/drop function public\.activate_tenant_subscription_manual\s*\(/gi)).toHaveLength(1);
  });

  test("7. canonical authority is fingerprinted but never modified", () => {
    expect(apply).toContain("ux8g4b0b_canonical_baseline");
    expect(apply).toContain("pg_get_functiondef(procedure.oid)");
    expect(apply).toContain("changed the canonical manual authority");
    expect(migration).not.toMatch(
      /(?:create|replace|alter|drop)\s+function\s+public\.activate_tenant_subscription_manual_authority_server/i,
    );
    expect(migration).not.toMatch(
      /(?:grant|revoke)[\s\S]{0,160}activate_tenant_subscription_manual_authority_server/i,
    );
  });

  test("8. canonical authority remains service-role-only", () => {
    for (const verifier of [pre, apply, post]) {
      expect(verifier).toContain(
        "has_function_privilege('service_role', procedure.oid, 'EXECUTE')",
      );
      expect(verifier).toContain(
        "not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')",
      );
      expect(verifier).toContain(
        "not has_function_privilege('anon', procedure.oid, 'EXECUTE')",
      );
      expect(verifier).toContain("acl.grantee = 0");
    }
  });

  test("9. POST requires legacy absence and one canonical RPC", () => {
    expect(post).toContain("identities.legacy_rpc is null legacy_manual_rpc_absent");
    expect(post).toContain("manual_rpc_inventory.total_count = 1");
    expect(post).toContain("manual_rpc_inventory.canonical_count = 1");
    expect(post).toContain("no_alternate_manual_activation_authority");
  });

  test("10. historical evidence schema is retained", () => {
    expect(migration).toContain("required_evidence_columns");
    expect(post).toContain("historical_evidence_preserved");
    expect(migration).not.toMatch(
      /(?:drop|truncate)\s+table\s+public\.manual_subscription_activation_audits/i,
    );
    expect(migration).not.toMatch(
      /(?:update|delete\s+from)\s+public\.manual_subscription_activation_audits/i,
    );
  });

  test("11. all protected row counts are captured and compared", () => {
    for (const table of [
      "tenants",
      "tenant_subscription_assignments",
      "manual_subscription_activation_audits",
      "platform_tenant_subscriptions",
      "subscriptions",
      "tenant_payment_orders",
      "tenant_payment_attempts",
      "razorpay_webhook_events",
      "tenant_plan_activation_events",
      "tenant_subscription_change_intents",
      "invoices",
      "platform_billing_receipts",
    ]) {
      expect(migration).toContain(`public.${table}`);
      expect(post).toContain(table);
    }
    expect(apply).toContain("ux8g4b0b_protected_baseline");
    expect(apply).toContain("changed protected business or financial rows");
  });

  test("12. projection SELECT remains non-grantable while unsafe grants remain absent", () => {
    for (const verifier of [pre, apply, post]) {
      expect(verifier).toContain("platform_tenant_subscriptions");
      expect(verifier).toContain("privilege.privilege_type = 'SELECT'");
      expect(verifier).toContain(
        "'REFERENCES','TRIGGER','TRUNCATE','INSERT','UPDATE','DELETE','MAINTAIN'",
      );
    }
    for (const verifier of [pre, apply, post]) {
      expect(verifier).toContain("privilege.is_grantable = 'NO'");
    }
    expect(migration).not.toMatch(
      /(?:grant|revoke)[\s\S]{0,160}on\s+(?:table\s+)?public\.platform_tenant_subscriptions/i,
    );
  });

  test("13. migration performs no public business-row DML", () => {
    expect(apply).not.toMatch(/^\s*insert\s+into\s+public\./im);
    expect(apply).not.toMatch(/^\s*update\s+public\./im);
    expect(apply).not.toMatch(/^\s*delete\s+from\s+public\./im);
    expect(apply).not.toMatch(/^\s*truncate\s+(?:table\s+)?public\./im);
  });

  test("14. APPLY reloads PostgREST only after verification", () => {
    expect(apply).toContain("notify pgrst, 'reload schema';");
    expect(apply.indexOf("drop function public.activate_tenant_subscription_manual(")).toBeLessThan(
      apply.indexOf("notify pgrst, 'reload schema';"),
    );
    expect(apply.indexOf("notify pgrst, 'reload schema';")).toBeLessThan(
      apply.indexOf("commit;"),
    );
  });

  test("15. POST always returns one decisive row", () => {
    expect(post).toContain("1::integer verification_row_count");
    expect(post).toContain("security_gate");
    expect(post.match(/\bselect\b/g)?.length).toBeGreaterThan(1);
  });

  test("16. security gate fails if old RPC remains", () => {
    expect(post).toContain("gates.legacy_manual_rpc_absent");
    expect(post).toMatch(
      /gates\.legacy_manual_rpc_absent[\s\S]*gates\.new_manual_rpc_present[\s\S]*security_gate/,
    );
  });

  test("17. security gate fails if canonical metadata or ACL drifts", () => {
    expect(post).toContain("gates.new_manual_rpc_security");
    expect(post).toContain("gates.new_manual_rpc_server_only_acl");
    expect(post).toMatch(
      /gates\.new_manual_rpc_present[\s\S]*gates\.new_manual_rpc_security[\s\S]*gates\.new_manual_rpc_server_only_acl[\s\S]*security_gate/,
    );
  });

  test("18. canonical body drift fails the PRE behavior contract", () => {
    expect(canonicalBehaviorPasses(canonicalAuthority)).toBe(true);
    expect(
      canonicalBehaviorPasses(
        canonicalAuthority.replace(
          "from public.subscription_plan_prices price",
          "from public.platform_subscription_plans price",
        ),
      ),
    ).toBe(false);
    for (const verifier of [pre, post]) {
      expect(verifier).toContain("canonical_authority_behavior_intact");
      const normalizedVerifier = verifier.toLowerCase().replaceAll("''", "'");
      for (const marker of canonicalBehaviorMarkers) {
        expect(normalizedVerifier).toContain(marker);
      }
    }
  });

  test("19. paid-renewal and grace drift fail canonical behavior verification", () => {
    expect(
      canonicalBehaviorPasses(
        canonicalAuthority.replace(
          "Canonical renewal or plan-change authority is required for existing paid subscription history.",
          "Existing paid history requires review.",
        ),
      ),
    ).toBe(false);
    expect(
      canonicalBehaviorPasses(
        canonicalAuthority.replaceAll(
          "v_period_end + interval '7 days'",
          "v_period_end + interval '3 days'",
        ),
      ),
    ).toBe(false);
  });

  test("20. provider or document fabrication fails canonical behavior verification", () => {
    expect(
      canonicalBehaviorPasses(
        canonicalAuthority + "\ninsert into public.invoices default values;",
      ),
    ).toBe(false);
    for (const verifier of [pre, post]) {
      expect(verifier).toContain("no_provider_or_document_fabrication");
      expect(verifier).toContain("canonical_authority_behavior_intact");
    }
  });

  test("21. evidence trigger loss and helper ACL drift fail verification", () => {
    for (const verifier of [pre, post]) {
      expect(verifier).toContain("evidence_trigger_contract.exact_trigger");
      expect(verifier).toContain("evidence_trigger_contract.correct_binding");
      expect(verifier).toContain(
        "evidence_trigger_function_contract.public_execute_absent",
      );
      expect(verifier).toContain("evidence_relation_contract.rls_enabled");
      expect(verifier).toContain(
        "evidence_relation_contract.legacy_plan_nullable",
      );
      expect(verifier).toContain(
        "evidence_relation_contract.idempotency_key_unique",
      );
      expect(verifier).toContain(
        "evidence_relation_contract.payment_reference_normalized_unique",
      );
      expect(verifier).toContain("canonical_evidence_authority_intact");
    }
  });

  test("22. request index and all six evidence CHECK contracts are structural", () => {
    for (const verifier of [pre, post]) {
      expect(verifier).toContain("count(*) = 6 expected_constraint_count");
      expect(verifier).toContain("count(oid) = 6 installed_constraint_count");
      expect(verifier).toContain("actual_columns = expected_columns");
      expect(verifier).toContain("compact_expression = expected_expression");
      expect(verifier).toContain("and_node_count = expected_and_nodes");
      expect(verifier).toContain("index_def.indisunique");
      expect(verifier).toContain("index_def.indnkeyatts = 1");
      expect(verifier).toContain("index_def.indnatts = 1");
      expect(verifier).toContain("index_def.indexprs is null");
      expect(verifier).toContain("= 'request_idISNOTNULL'");
    }
  });

  test("23. dangerous grants on every guarded table fail PRE and POST", () => {
    for (const verifier of [pre, post]) {
      for (const table of [
        "manual_subscription_activation_audits",
        "tenant_subscription_assignments",
        "subscription_plan_prices",
        "platform_tenant_subscriptions",
      ]) {
        expect(verifier).toContain(`'${table}'`);
      }
      for (const privilege of [
        "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES",
        "MAINTAIN",
      ]) {
        expect(verifier).toContain(`'${privilege}'`);
      }
      expect(verifier).toContain("browser_dangerous_grants = 0");
    }
  });

  test("24. POST requires matching behavior evidence and ACL health", () => {
    for (const gate of [
      "canonical_authority_behavior_intact",
      "canonical_evidence_authority_intact",
      "browser_writes_absent",
      "platform_projection_acl_safe",
    ]) {
      expect(post.match(new RegExp(`gates\\.${gate}`, "g"))).toHaveLength(1);
    }
  });

  test("25. retirement scope does not touch application authority", () => {
    expect(migration).not.toContain("create or replace function");
    expect(migration).not.toContain("alter table");
    expect(migration).not.toContain("grant ");
    expect(migration).not.toContain("revoke ");
  });
});
