import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g1a_renewal_lifecycle_authority.sql",
);
const initialActivation = read(
  "supabase/module71_7r5_verified_payment_activation_rpc.sql",
);
const ux8f = read(
  "supabase/bundle_ux8f_verified_payment_document_fulfillment.sql",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0] ?? "";
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0].toLowerCase() ?? "";
}

const lifecycle = () =>
  functionBody(
    "coachfort_internal",
    "tenant_subscription_effective_lifecycle",
  );
const renewalAuthorityKey = () =>
  functionBody("coachfort_internal", "renewal_authority_key");
const renewalIntentAuthority = () =>
  functionBody(
    "coachfort_internal",
    "enforce_subscription_change_intent_authority",
  );
const renewalOrder = () =>
  functionBody(
    "public",
    "create_platform_renewal_payment_order_authority_server",
  );
const renewalActivation = () =>
  functionBody(
    "coachfort_internal",
    "activate_renewal_tenant_plan_after_verified_payment",
  );
const activationTrigger = () =>
  functionBody(
    "coachfort_internal",
    "enforce_captured_attempt_activation_authority",
  );

test.describe("UX-8G1A renewal lifecycle authority", () => {
  test("1. derives active lifecycle from the purchased period", () => {
    expect(lifecycle()).toContain("now() < v_period_end");
    expect(lifecycle()).toContain("v_effective_state := 'active'");
    expect(lifecycle()).toContain("v_allowed := true");
  });

  test("2. treats the exact period end as the active-to-grace boundary", () => {
    const source = lifecycle();
    expect(source).toContain("elsif now() < v_grace_end then");
    expect(source.indexOf("now() < v_period_end")).toBeLessThan(
      source.indexOf("now() < v_grace_end"),
    );
    expect(source).not.toContain("now() <= v_period_end");
  });

  test("3. treats the exact grace end as expired", () => {
    const source = lifecycle();
    expect(source).toContain("v_effective_state := 'grace'");
    expect(source).toContain("v_effective_state := 'expired'");
    expect(source).not.toContain("now() <= v_grace_end");
  });

  test("3a. uses canonical trial timestamps without paid-subscription grace", () => {
    const source = lifecycle();
    expect(source).toContain("if v_assignment.status = 'trial' then");
    expect(source).toContain("v_assignment.payment_status <> 'not_required'");
    expect(source).toContain("v_assignment.trial_started_at");
    expect(source).toContain("now() < v_assignment.trial_ends_at");
    expect(source).toContain("trial_period_elapsed");
    expect(source).not.toContain(
      "coalesce(v_assignment.grace_period_ends_at",
    );
  });

  test("3b. rejects an anomalous trial with populated paid-period fields from renewal", () => {
    const orderSource = renewalOrder();
    const intentSource = renewalIntentAuthority();
    const statusGuard = "v_base.status not in ('active','grace','past_due')";
    const allowedCombinations = [
      "v_base.status = 'active' and v_base.payment_status in ('paid','waived')",
      "v_base.status = 'grace' and v_base.payment_status in ('paid','overdue','waived')",
      "v_base.status = 'past_due' and v_base.payment_status in ('unpaid','overdue')",
    ];

    expect(orderSource).toContain(statusGuard);
    expect(intentSource).toContain(statusGuard);
    for (const combination of allowedCombinations) {
      expect(orderSource).toContain(combination);
      expect(intentSource).toContain(combination);
    }

    expect(orderSource.indexOf(statusGuard)).toBeLessThan(
      orderSource.indexOf("v_lifecycle :="),
    );
    expect(orderSource.indexOf(statusGuard)).toBeLessThan(
      orderSource.indexOf("where intent.authority_key = v_authority_key"),
    );
    expect(intentSource.indexOf(statusGuard)).toBeLessThan(
      intentSource.indexOf(
        "v_base.current_period_end is distinct from new.base_period_end",
      ),
    );
  });

  test("4. fails malformed and terminal lifecycle authority closed", () => {
    const source = lifecycle();
    for (const marker of [
      "missing_canonical_assignment",
      "invalid_status_payment_combination",
      "missing_period_authority",
      "future_period_start",
      "invalid_period_ordering",
      "invalid_grace_authority",
      "stored_terminal_or_suspended",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("('cancelled','suspended','expired')");
    expect(source).toContain("'operational_allowed', false");
  });

  test("5. performs only deterministic seven-day grace backfill", () => {
    const sql = executableSql().toLowerCase();
    const backfill = sql.match(
      /update public\.tenant_subscription_assignments assignment[\s\S]*?where assignment\.is_current[\s\S]*?;/,
    )?.[0] ?? "";
    expect(backfill).toContain(
      "set grace_period_ends_at = assignment.current_period_end + interval '7 days'",
    );
    expect(backfill).toContain("assignment.current_period_start < assignment.current_period_end");
    expect(backfill).toContain("assignment.grace_period_ends_at is null");
    expect(backfill).not.toContain("assignment.status = 'trial'");
    expect(backfill).not.toMatch(
      /set\s+(?:current_period_start|current_period_end|trial_ends_at|payment_status|billing_cycle)\s*=/,
    );
  });

  test("6. early renewal preserves assignment identity and current start", () => {
    const source = renewalActivation();
    expect(source).toContain("v_new_assignment_id := v_base.id");
    expect(source).toContain("where id = v_base.id");
    expect(source).not.toMatch(
      /update public\.tenant_subscription_assignments[\s\S]*?set[\s\S]*?current_period_start\s*=/,
    );
  });

  test("7. early renewal extends from the locked old period end", () => {
    const source = renewalActivation();
    expect(source).toContain(
      "v_period_start := case when v_continuous then v_intent.base_period_end else v_attempt.captured_at end",
    );
    expect(source).toContain("current_period_end = v_period_end");
    expect(source).toContain("v_base.current_period_end is distinct from v_intent.base_period_end");
  });

  test("8. freezes only the purchased renewal segment on activation", () => {
    const source = activationTrigger();
    const sql = executableSql().toLowerCase();
    expect(source).toContain(
      "when v_attempt.captured_at <= v_intent.base_period_end then v_intent.base_period_end",
    );
    expect(source).toContain("new.billing_period_start := v_expected_period_start");
    expect(source).toContain("new.billing_period_end := v_expected_period_end");
    expect(source).toContain("ux8g1a_renewal_segment");
    for (const field of [
      "activation_status",
      "activated_at",
      "payment_order_id",
      "provider_order_id",
      "provider_payment_id",
      "tenant_id",
      "plan_id",
      "price_id",
      "previous_assignment_id",
      "new_assignment_id",
      "subscription_change_intent_id",
      "billing_period_start",
      "billing_period_end",
      "idempotency_key",
      "activation_source",
      "provider",
      "metadata_json",
    ]) {
      expect(source).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
    expect(sql).toContain(
      "create trigger enforce_captured_attempt_activation_authority\nbefore insert or update on public.tenant_plan_activation_events",
    );
    expect(sql).not.toContain(
      "create trigger enforce_captured_attempt_activation_authority\nbefore insert or update of",
    );
  });

  test("9. starts post-lapse renewal at exact captured_at", () => {
    const source = renewalActivation();
    expect(source).toContain("else v_attempt.captured_at end");
    expect(source).toContain(
      "v_order.currency, null, null, v_period_start, v_period_end",
    );
    expect(source).toContain(
      "v_continuous := v_attempt.captured_at <= v_intent.base_period_end",
    );
    expect(activationTrigger()).toContain(
      "v_attempt.captured_at > v_intent.base_period_end",
    );
  });

  test("10. uses calendar-month arithmetic", () => {
    expect(renewalActivation()).toContain(
      "when 'monthly' then v_period_start + interval '1 month'",
    );
  });

  test("11. uses calendar-year arithmetic", () => {
    expect(renewalActivation()).toContain(
      "when 'yearly' then v_period_start + interval '1 year'",
    );
  });

  test("12. enforces zero setup fee in order, snapshot, total, and constraint", () => {
    const sql = executableSql().toLowerCase();
    const source = renewalOrder();
    expect(source).toContain("'setup_fee_amount_minor', 0");
    expect(source).toContain(
      "v_total_amount_minor := v_price.amount_minor + coalesce(v_tax_amount_minor, 0)",
    );
    expect(source).toMatch(/v_price\.amount_minor,\s*0, v_tax_amount_minor/);
    expect(sql).toContain("tenant_payment_orders_renewal_setup_fee_zero_check");
    expect(sql).toContain("billing_snapshot is not null");
    expect(sql).toContain("issuer_snapshot is not null");
    expect(sql).toContain("plan_snapshot is not null");
    expect(sql).toContain("setup_fee_amount_minor is not distinct from 0");
    expect(sql).toContain(
      "(plan_snapshot->>'setup_fee_amount_minor') is not distinct from '0'",
    );
    expect(renewalActivation()).toContain(
      "v_order.setup_fee_amount_minor is distinct from 0",
    );
    expect(renewalActivation()).toContain(
      "(v_order.plan_snapshot->>'setup_fee_amount_minor') is distinct from '0'",
    );
  });

  test("12a. extends the UX-8F payment-order trigger over all updates", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain(
      "new.subscription_change_intent_id is distinct from old.subscription_change_intent_id",
    );
    expect(sql).toContain(
      "new.change_intent_generation is distinct from old.change_intent_generation",
    );
    expect(sql).toContain(
      "create trigger enforce_payment_order_commercial_snapshot_immutability\nbefore update on public.tenant_payment_orders",
    );
    expect(sql).not.toContain(
      "create trigger enforce_payment_order_commercial_snapshot_immutability\nbefore update of",
    );
  });

  test("13. reuses duplicate deterministic intent and nonterminal order", () => {
    const source = renewalOrder();
    expect(source).toContain("where intent.authority_key = v_authority_key");
    expect(source).toContain("if v_intent.id is null then");
    expect(source).toContain("if v_existing_order.id is not null then");
    expect(source).toContain("'idempotent', true");
  });

  test("14. permits only one nonterminal order per intent", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain("tenant_payment_orders_change_intent_nonterminal_uidx");
    expect(sql).toContain(
      "internal_status not in ('failed','cancelled','expired','activated')",
    );
  });

  test("15. creates a controlled next generation after terminal order", () => {
    const source = renewalOrder();
    expect(source).toContain("v_generation := v_intent.order_generation + 1");
    expect(source).toContain("set status = 'open'");
    expect(source).toContain(
      "set status = 'payment_pending', order_generation = v_generation",
    );
    expect(executableSql().toLowerCase()).toContain(
      "new.order_generation > old.order_generation + 1",
    );
  });

  test("16. duplicate activation returns without extending twice", () => {
    const source = renewalActivation();
    const idempotentReturn = source.indexOf("'idempotent', true");
    const assignmentUpdate = source.indexOf(
      "update public.tenant_subscription_assignments",
    );
    expect(idempotentReturn).toBeGreaterThan(-1);
    expect(idempotentReturn).toBeLessThan(assignmentUpdate);
    expect(executableSql().toLowerCase()).toContain(
      "tenant_plan_activation_events_change_intent_success_uidx",
    );
  });

  test("17. routes a second captured payment to manual review without extension", () => {
    const source = renewalActivation();
    expect(source).toContain("if v_intent.status = 'activated' then");
    expect(source).toContain("second_captured_payment_after_intent_activation");
    expect(source).toContain("'activation_status', 'manual_review'");
    expect(source.indexOf("if v_intent.status = 'activated' then")).toBeLessThan(
      source.indexOf("update public.tenant_subscription_assignments"),
    );
  });

  test("18. preserves the deployed initial UX-8F activation implementation", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain(
      "alter function public.activate_tenant_plan_after_verified_payment(uuid)\n  set schema coachfort_internal",
    );
    expect(sql).toContain(
      "rename to activate_initial_tenant_plan_after_verified_payment",
    );
    expect(initialActivation.toLowerCase()).toContain(
      "where payment_order_id = p_payment_order_id",
    );
    expect(initialActivation.toLowerCase()).toContain("'idempotent', true");
    expect(activationTrigger()).toContain(
      "v_expected_period_start := v_assignment.current_period_start",
    );
    expect(sql).toContain(
      "grace_period_ends_at = current_period_end + interval '7 days'",
    );
    expect(sql).toContain("and grace_period_ends_at is null");
  });

  test("19. keeps UX-8F invoice and receipt source identities unchanged", () => {
    const sql = executableSql().toLowerCase();
    expect(ux8f.toLowerCase()).toContain(
      "'invoice:activation:' || p_activation_event_id::text",
    );
    expect(ux8f.toLowerCase()).toContain(
      "'receipt:payment_attempt:' || v_attempt.id::text",
    );
    expect(sql).not.toMatch(
      /(?:create|alter|drop)\s+table\s+public\.(?:invoices|platform_billing_receipts)/,
    );
  });

  test("20. binds renewal authority to exact tenant membership and rows", () => {
    const source = renewalOrder();
    expect(source).toContain("member.tenant_id = p_tenant_id");
    expect(source).toContain("member.user_id = p_created_by");
    expect(source).toContain("member.role in ('owner','admin')");
    expect(renewalActivation()).toContain("v_intent.tenant_id <> v_order.tenant_id");
  });

  test("21. denies direct browser access to change intents", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain(
      "revoke all on table public.tenant_subscription_change_intents from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "alter table public.tenant_subscription_change_intents enable row level security",
    );
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]{0,120}tenant_subscription_change_intents/i,
    );
  });

  test("22. keeps activation service-only and private helpers unexposed", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain(
      "grant execute on function public.activate_tenant_plan_after_verified_payment(uuid) to service_role",
    );
    expect(sql).toContain(
      "revoke all on function coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("if v_intent_id is null then");
    expect(sql).not.toMatch(/grant execute on function coachfort_internal\./);
  });

  test("23. keeps verifiers read-only and Student Finance untouched", () => {
    for (const block of [verifier("PRE-APPLY"), verifier("POST-APPLY")]) {
      expect(block).not.toMatch(
        /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index|trigger)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?public\.|merge\s+into)\b/i,
      );
    }
    const sql = executableSql().toLowerCase();
    expect(sql).not.toMatch(
      /\b(?:alter|drop|truncate|insert into|update|delete from)\s+(?:table\s+)?public\.finance_/,
    );
    expect(sql).not.toMatch(/operational_restriction|student_portal_access_allowed/);
    expect(verifier("POST-APPLY").toLowerCase()).toContain(
      "'ux8g1b_operational_restriction_enabled', false",
    );
  });

  test("24. gates PRE on decisive UX-8F structural prerequisites", () => {
    const pre = verifier("PRE-APPLY").toLowerCase();
    expect(pre).toContain("ux8f_prerequisite_state as");
    expect(pre).toContain("index_definition.indisunique");
    expect(pre).toContain("pg_get_indexdef(index_relation.oid) like '%(payment_order_id)%'");
    expect(pre).toContain("as billing_period_columns");
    expect(pre).toContain("as frozen_order_snapshots");
    expect(pre).toContain(
      "select activation_order_unique and billing_period_columns and frozen_order_snapshots from ux8f_prerequisite_state",
    );
  });

  test("24a. binds pgcrypto authority to the installed extensions schema", () => {
    const pre = verifier("PRE-APPLY").toLowerCase();
    const post = verifier("POST-APPLY").toLowerCase();
    const source = renewalAuthorityKey();

    expect(pre).toContain("to_regprocedure('extensions.digest(bytea,text)')");
    expect(pre).not.toContain("to_regprocedure('public.digest(bytea,text)')");
    expect(source).toContain("extensions.digest(");
    expect(source).not.toContain("public.digest(");
    expect(post).toContain(
      "to_regprocedure('extensions.digest(bytea,text)') is not null",
    );
    expect(post).toContain("authority_key_source like '%extensions.digest(%'");
    expect(post).toContain(
      "authority_key_source not like '%public.digest(%'",
    );
    expect(post).toContain(
      "select pgcrypto_authority_secure and lifecycle_secure",
    );
  });

  test("25. POST binds both immutability triggers and requires all-column updates", () => {
    const post = verifier("POST-APPLY").toLowerCase();
    expect(post).toContain("from pg_catalog.pg_trigger trigger_definition");
    expect(post).toContain(
      "trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()')",
    );
    expect(post).toContain(
      "trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()')",
    );
    expect(post).toContain("(trigger_definition.tgtype & 4) = 4");
    expect(post).toContain("(trigger_definition.tgtype & 16) = 16");
    expect(post).toContain("trigger_definition.tgattr::text = ''");
    expect(post).toContain(
      "payment_order_trigger_source like '%new.subscription_change_intent_id is distinct from old.subscription_change_intent_id%'",
    );
    expect(post).toContain(
      "payment_order_trigger_source like '%new.change_intent_generation is distinct from old.change_intent_generation%'",
    );
    for (const gate of [
      "'activation_trigger_function_bound', true",
      "'activation_trigger_insert_and_all_updates', true",
      "'payment_order_trigger_function_bound', true",
      "'payment_order_trigger_all_updates', true",
    ]) {
      expect(post).toContain(gate);
    }
  });
});
