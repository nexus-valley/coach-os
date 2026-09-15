import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "supabase/bundle_ux8g4b0a_manual_activation_authority_replacement.sql",
);
const route = read(
  "app/api/platform/manual-subscription-activation/route.ts",
);
const platform = read("src/lib/platform.ts");
const panel = read("src/components/platform/ManualActivationPanel.tsx");

function sqlFunction(source: string, identity: string) {
  const marker = `create function ${identity}`;
  const start = source.toLowerCase().indexOf(marker.toLowerCase());
  expect(start, `${identity} should exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n$$;", start);
  expect(end, `${identity} should terminate`).toBeGreaterThan(start);
  return source.slice(start, end + 4);
}

const authority = sqlFunction(
  migration,
  "public.activate_tenant_subscription_manual_authority_server",
);
const apply = migration.slice(
  migration.indexOf("-- APPLY TRANSACTION"),
  migration.indexOf("-- POST-APPLY READ-ONLY VERIFICATION"),
);
const post = migration.slice(
  migration.indexOf("-- POST-APPLY READ-ONLY VERIFICATION"),
);

test.describe("UX-8G4B0A canonical manual activation replacement", () => {
  test("1. authenticated server route verifies Platform Owner/Admin before service RPC", () => {
    expect(route).toContain("getBearerToken(request)");
    expect(route).toContain("requireAuthenticatedUser(accessToken)");
    expect(route).toContain('.from("platform_admin_users")');
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('.eq("status", "active")');
    expect(route).toContain('platformActor?.role !== "owner"');
    expect(route).toContain('platformActor?.role !== "admin"');
    expect(route).toContain(
      '"activate_tenant_subscription_manual_authority_server"',
    );
    expect(route).toContain("p_actor_user_id: user.id");
  });

  test("2. new RPC is service-only, postgres-owned, and independently actor-bound", () => {
    expect(migration).toContain("security definer\nset search_path = public, pg_temp");
    expect(migration).toContain(
      "alter function public.activate_tenant_subscription_manual_authority_server",
    );
    expect(migration).toContain(") owner to postgres;");
    expect(migration).toContain(
      ") from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(") to service_role;");
    expect(authority).toContain("from public.platform_admin_users platform_actor");
    expect(authority).toContain("platform_actor.user_id = p_actor_user_id");
    expect(authority).toContain("platform_actor.status = 'active'");
    expect(authority).toContain("platform_actor.role in ('owner','admin')");
    expect(authority).not.toContain("auth.uid()");
  });

  test("3. browser caller uses the server route and cannot supply lifecycle dates", () => {
    expect(platform).toContain(
      'fetch("/api/platform/manual-subscription-activation"',
    );
    expect(platform).toContain("Authorization: `Bearer ${accessToken}`");
    expect(platform).not.toMatch(
      /\.rpc\(\s*["']activate_tenant_subscription_manual["']/,
    );
    expect(panel).not.toContain('setField("gracePeriodEndsAt"');
    expect(panel).not.toContain("subscriptionStart");
    expect(panel).not.toContain("subscriptionEnd");
    expect(route).not.toContain("gracePeriodEndsAt?: unknown");
  });

  test("4. commercial values resolve from canonical plan and price rows", () => {
    expect(authority).toContain("from public.subscription_plans plan");
    expect(authority).toContain("from public.subscription_plan_prices price");
    expect(authority).toContain("price.plan_id = v_plan.id");
    expect(authority).toContain("price.billing_cycle = v_billing_cycle");
    expect(authority).toContain("price.currency = v_currency");
    expect(authority).toContain("price.region_code = 'GLOBAL'");
    expect(authority).toContain("pricing_finalized");
    expect(authority).toMatch(
      /p_amount_minor is distinct from\s+v_price\.amount_minor \+ v_price\.setup_fee_amount_minor/,
    );
    expect(authority).not.toContain("149900");
    expect(authority).not.toContain("599900");
    expect(authority).not.toContain("v_plan_code in ('starter','growth')");
  });

  test("5. database derives calendar period and exact seven-day paid grace", () => {
    expect(authority).toContain("v_period_start timestamptz := statement_timestamp()");
    expect(authority).toContain("v_period_start + interval '1 month'");
    expect(authority).toContain("v_period_start + interval '1 year'");
    expect(authority).toContain("v_period_end + interval '7 days'");
    expect(authority).not.toContain("p_grace_period_ends_at");
    expect(authority).not.toContain("p_subscription_start");
    expect(authority).not.toContain("p_subscription_end");
  });

  test("6. request UUID and fingerprint provide exact replay/conflict semantics", () => {
    expect(panel).toContain("createManualActivationRequestId()");
    expect(panel).toContain("requestId: form.requestId");
    expect(panel).toContain("requestId: createManualActivationRequestId()");
    expect(panel).not.toMatch(
      /handleSubmit[\s\S]{0,500}createManualActivationRequestId\(\)/,
    );
    expect(authority).toContain("p_request_id uuid");
    expect(authority).toContain("extensions.digest");
    expect(authority).toContain("v_existing.request_fingerprint = v_request_fingerprint");
    expect(authority).toContain("'idempotent', true");
    expect(authority).toContain("using errcode = '23505'");
    expect(migration).toContain(
      "manual_subscription_activation_audits_request_id_uidx",
    );
  });

  test("7. lock order and current-assignment locking preserve concurrency safety", () => {
    const requestLock = authority.indexOf("ux8g4b0a_request:");
    const paymentLock = authority.indexOf("ux8g4b0a_payment_reference:");
    const tenantLock = authority.indexOf("ux8g4b0a_tenant:");
    const currentLock = authority.indexOf(
      "from public.tenant_subscription_assignments assignment",
    );
    expect(requestLock).toBeGreaterThan(0);
    expect(paymentLock).toBeGreaterThan(requestLock);
    expect(tenantLock).toBeGreaterThan(paymentLock);
    expect(currentLock).toBeGreaterThan(tenantLock);
    expect(authority.slice(currentLock)).toContain("for update");
  });

  test("8. only no-current activation or explicit valid-trial conversion is allowed", () => {
    expect(authority).toContain(
      "Replacement was requested but no current assignment exists.",
    );
    expect(authority).toContain(
      "Explicit replacement is required for the current assignment.",
    );
    expect(authority).toContain(
      "coachfort_internal.tenant_subscription_effective_lifecycle",
    );
    expect(authority).toContain("v_current.status <> 'trial'");
    expect(authority).toContain(
      "v_current.payment_status <> 'not_required'",
    );
    expect(authority).toContain("v_current.trial_started_at is null");
    expect(authority).toContain("v_current.trial_ends_at is null");
    expect(authority).toContain("v_current.current_period_start is not null");
    expect(authority).toContain("v_current.current_period_end is not null");
    expect(authority).toContain("v_current.grace_period_ends_at is not null");
    expect(authority).toContain("('within_trial_period','trial_period_elapsed')");
    expect(authority).toContain(
      "Current trial authority is malformed and requires review.",
    );
    expect(authority).toContain("superseded_by_manual_request_id");
    expect(authority).not.toContain("delete from public.tenant_subscription_assignments");
  });

  test("9. paid, lapsed, terminal, and different-plan histories require canonical renewal authority", () => {
    expect(authority).toContain("v_has_commercial_assignment_history");
    expect(authority).toContain("assignment.status <> 'trial'");
    expect(authority).toContain(
      "assignment.payment_status <> 'not_required'",
    );
    expect(authority).toContain("assignment.current_period_start is not null");
    expect(authority).toContain("assignment.current_period_end is not null");
    expect(authority).toContain("assignment.grace_period_ends_at is not null");
    expect(authority).toContain(
      "Canonical renewal or plan-change authority is required for existing paid subscription history.",
    );
    expect(authority).not.toContain(
      "v_current.status in ('cancelled','suspended','expired')",
    );
    expect(authority).not.toContain(
      "v_lifecycle->>'reason' = 'grace_period_elapsed'",
    );
    expect(authority).not.toContain("insert into public.tenant_subscription_change_intents");
  });

  test("10. evidence is immutable and explicitly manual rather than provider-backed", () => {
    expect(migration).toContain(
      "before update or delete on public.manual_subscription_activation_audits",
    );
    expect(authority).toContain("'manual_operator_verified'");
    expect(authority).toContain("'provider_evidence', false");
    expect(authority).not.toContain("insert into public.tenant_payment_orders");
    expect(authority).not.toContain("insert into public.tenant_payment_attempts");
    expect(authority).not.toContain("insert into public.razorpay_webhook_events");
    expect(authority).not.toContain("insert into public.tenant_plan_activation_events");
    expect(authority).not.toContain("insert into public.invoices");
    expect(authority).not.toContain("insert into public.platform_billing_receipts");
  });

  test("11. only the active Platform Console compatibility projection is retained", () => {
    expect(authority).toContain("insert into public.platform_tenant_subscriptions");
    expect(authority).toContain("'projection_source', 'canonical_manual_activation'");
    expect(authority).not.toContain("insert into public.subscriptions");
    expect(authority).not.toContain("update public.tenants");
  });

  test("12. errors are sanitized at the route and client boundaries", () => {
    expect(route).toContain("getDatabaseErrorMessage");
    expect(route).not.toContain("error.message }, { status");
    expect(route).toContain("captureServerException(error");
    expect(platform).toContain(
      'payload.error ?? "Unable to submit manual activation."',
    );
    expect(panel).not.toContain("SQLSTATE");
  });

  test("13. rollout preserves the old RPC while proving the new authority", () => {
    expect(migration).toContain("legacy_manual_rpc_still_present");
    expect(migration).toContain("new_manual_authority_ready");
    expect(migration).toContain("security_gate");
    expect(migration).not.toMatch(
      /drop\s+function\s+(?:if\s+exists\s+)?public\.activate_tenant_subscription_manual\s*\(/i,
    );
  });

  test("14. migration reports historical authority without repairing it", () => {
    expect(migration).toContain("historical_manual_assignments as");
    expect(migration).toContain("noncanonical_grace_count");
    expect(migration).toContain("malformed_current_count");
    expect(migration).not.toMatch(
      /update public\.tenant_subscription_assignments assignment\s+set grace_period_ends_at/i,
    );
  });

  test("15. installation preserves protected business and financial row counts", () => {
    expect(migration).toContain("ux8g4b0a_protected_baseline");
    for (const table of [
      "tenant_payment_orders",
      "tenant_payment_attempts",
      "razorpay_webhook_events",
      "tenant_plan_activation_events",
      "tenant_subscription_change_intents",
      "invoices",
      "platform_billing_receipts",
    ]) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain(
      "UX-8G4B0A changed protected business or financial rows.",
    );
  });

  test("16. legacy RPC rollout contract preserves exact authenticated authority", () => {
    expect(migration).toContain(
      "public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)",
    );
    expect(migration).toContain("legacy_rpc_rollout_compatible");
    expect(migration).toContain(
      "procedure.proconfig = array['search_path=public']",
    );
    expect(migration).toContain(
      "has_function_privilege('authenticated', procedure.oid, 'EXECUTE')",
    );
    expect(migration).toContain(
      "not has_function_privilege('anon', procedure.oid, 'EXECUTE')",
    );
    expect(migration).toContain(
      "not has_function_privilege('service_role', procedure.oid, 'EXECUTE')",
    );
    expect(migration).not.toContain(
      "alter table public.manual_subscription_activation_audits owner to postgres",
    );
    expect(migration).not.toContain(
      "revoke all on table public.manual_subscription_activation_audits",
    );
  });

  test("17. legacy audit insert and replay remain compatible with immutability", () => {
    expect(migration).toContain("audit_insert_present");
    expect(migration).toContain("audit_update_absent");
    expect(migration).toContain("audit_delete_absent");
    expect(migration).toContain("audit_replay_row_lock_present");
    expect(migration).toContain("audit_replay_returns_existing");
    expect(migration).toContain("audit_insert_and_replay_compatible");
    expect(migration).toContain("audit_select_available");
    expect(migration).toContain("audit_insert_available");
    expect(migration).toContain("audit_row_lock_available");
  });

  test("18. PRE fingerprints the exact diagnosed legacy ACL without accepting drift", () => {
    expect(migration).toContain("information_schema.table_privileges");
    expect(migration).not.toContain("information_schema.role_table_grants");
    expect(migration).toContain("grantee in ('PUBLIC','anon','authenticated')");
    expect(migration).toContain("expected_preexisting_acl");
    expect(migration).toContain("preexisting_acl_state");
    for (const privilege of ["SELECT", "REFERENCES", "TRIGGER", "TRUNCATE"]) {
      expect(migration).toContain(
        `'platform_tenant_subscriptions','authenticated','${privilege}','NO'`,
      );
    }
    expect(migration).toContain("missing_expected_grant_count = 0");
    expect(migration).toContain("unexpected_grant_count = 0");
    expect(migration).toContain("expected_preexisting_acl_state");
    expect(migration).toContain("select * from expected except select * from actual");
    expect(migration).toContain("select * from actual except select * from expected");
  });

  test("19. APPLY performs only the narrow ACL revocation and preserves SELECT", () => {
    expect(migration).toContain(
      "revoke references, trigger, truncate\non table public.platform_tenant_subscriptions\nfrom authenticated;",
    );
    expect(migration).not.toMatch(
      /revoke\s+(?:all|select)[\s\S]{0,120}on table public\.platform_tenant_subscriptions/i,
    );
    expect(migration).not.toMatch(
      /grant[\s\S]{0,120}on table public\.platform_tenant_subscriptions/i,
    );
  });

  test("20. POST proves final projection ACL and all browser writes are closed", () => {
    for (const gate of [
      "authenticated_select_preserved",
      "authenticated_references_absent",
      "authenticated_trigger_absent",
      "authenticated_truncate_absent",
      "authenticated_insert_absent",
      "authenticated_update_absent",
      "authenticated_delete_absent",
      "public_anon_dangerous_absent",
      "platform_projection_acl_safe",
    ]) {
      expect(post).toContain(gate);
    }
    expect(post).toContain("browser_write_state.browser_write_grants = 0");
    expect(migration).toContain(
      "'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'",
    );
  });

  test("21. legacy uniqueness is exact and normalized duplicates fail closed", () => {
    expect(migration).toContain("UNIQUE (idempotency_key)");
    expect(migration).toContain("UNIQUE (payment_reference_normalized)");
    expect(migration).toContain("duplicate_normalized_reference_count");
    expect(migration).toContain(
      "group by lower(trim(payment_reference))",
    );
    expect(migration).toContain(
      "payment_reference_normalization_violation_count",
    );
  });

  test("22. platform projection is unique and selected with an exact runtime count", () => {
    expect(migration).toContain("UNIQUE (code)");
    expect(authority).toContain("select count(*) into v_platform_plan_count");
    expect(authority).toContain("if v_platform_plan_count <> 1");
    expect(authority).toContain("order by platform_plan.id");
    expect(authority).toContain("limit 1");
    expect(migration).toContain("platform_projection_deterministic");
    expect(migration).toContain("missing_count");
    expect(migration).toContain("ambiguous_count");
  });

  test("23. new format constraints are gated against historical evidence", () => {
    expect(migration).toContain("plan_code_format_violation_count");
    expect(migration).toContain("legacy_plan_format_violation_count");
    expect(migration).toContain("currency_format_violation_count");
    expect(migration).toContain(
      "historical_evidence_compatibility.plan_code_format_violation_count = 0",
    );
    expect(migration).not.toMatch(
      /update public\.manual_subscription_activation_audits\s+set/i,
    );
  });

  test("24. production CHECK definitions and nullability are exact before destructive DDL", () => {
    expect(migration).toContain(
      "CHECK ((plan_code = ANY (ARRAY[''starter''::text, ''growth''::text])))",
    );
    expect(migration).toContain(
      "CHECK ((legacy_plan = ANY (ARRAY[''starter''::text, ''business''::text])))",
    );
    expect(migration).toContain("CHECK ((currency = ''INR''::text))");
    expect(migration).not.toContain(
      "'CHECK (plan_code = ANY (ARRAY[''starter''::text, ''growth''::text]))'",
    );
    expect(migration).toContain("legacy_plan_not_null");
    expect(migration).toContain("column_name = 'legacy_plan'");
    expect(migration).toContain("is_nullable = 'NO'");
    expect(migration.indexOf("legacy evidence constraint or nullability authority drifted")).toBeLessThan(
      migration.indexOf("alter column legacy_plan drop not null"),
    );
  });

  test("25. replacement constraints and request-id index are exact", () => {
    for (const constraint of [
      "manual_subscription_activation_audits_plan_code_format_check",
      "manual_subscription_activation_audits_legacy_plan_format_check",
      "manual_subscription_activation_audits_currency_format_check",
      "manual_subscription_activation_audits_request_fingerprint_check",
      "manual_subscription_activation_audits_evidence_kind_check",
      "manual_subscription_activation_audits_canonical_request_check",
    ]) {
      expect(post).toContain(constraint);
    }
    for (const verifier of [apply, post]) {
      expect(verifier).toContain("actual_columns = expected_columns");
      expect(verifier).toContain("compact_expression = expected_expression");
      expect(verifier).toContain("expression_root = expected_root");
      expect(verifier).toContain("and_node_count = expected_and_nodes");
      expect(verifier).toContain("index_def.indnkeyatts = 1");
      expect(verifier).toContain("index_def.indnatts = 1");
      expect(verifier).toContain("index_def.indexprs is null");
      expect(verifier).toContain(
        "index_def.indkey[0] = request_column.attnum",
      );
      expect(verifier).toContain("index_def.indpred is not null");
      expect(verifier).toContain("= 'request_idISNOTNULL'");
      expect(verifier).not.toContain(
        "pg_get_indexdef(index_def.indexrelid, 1, true) = 'request_id'",
      );
    }
    expect(apply).toContain("'[()[:space:]]+'");
    expect(post).toContain("replacement_constraint_catalog as (");
    expect(post).toContain("exact_catalog_shape");
    expect(post).toContain("exact_column_binding");
    expect(post).toContain("exact_expression_semantics");
    for (const diagnostic of [
      "plan_code_check_contract",
      "legacy_plan_check_contract",
      "currency_check_contract",
      "request_fingerprint_check_contract",
      "evidence_kind_check_contract",
      "canonical_request_check_contract",
    ]) {
      expect(post).toContain(diagnostic);
    }
    expect(post).not.toContain(
      "pg_get_constraintdef(constraint_def.oid) = expected.expected_definition",
    );
    expect(migration).toContain(
      "UX-8G4B0A replacement CHECK contract failed self-verification.",
    );
    expect(migration).toContain(
      "UX-8G4B0A request_id index contract failed self-verification.",
    );
    expect(migration).not.toContain(
      "UX-8G4B0A replacement evidence constraints or request index drifted.",
    );
    expect(post).toContain("request_index_contract as (");
    expect(post).toContain("exact_index_count");
    expect(post).toContain("exact_table_and_name");
    expect(post).toContain("unique_valid_ready_live");
    expect(post).toContain("one_plain_key_no_include");
    expect(post).toContain("request_id_is_key");
    expect(post).toContain("exact_partial_predicate");
  });

  test("26. canonical code and tenant conflict arbiters are exact", () => {
    expect(migration).toContain("subscription_plans_code_key");
    expect(migration).toContain("platform_subscription_plans_code_key");
    expect(migration).toContain("platform_tenant_subscriptions_tenant_id_key");
    expect(migration).toContain("UNIQUE (tenant_id)");
    expect(migration).toContain("subscription_plan_code_unique");
    expect(migration).toContain("platform_tenant_unique");
  });

  test("27. POST always emits one decisive row and missing helpers fail security", () => {
    expect(post).toContain("count(procedure.oid) = 1 exact_function");
    expect(post).toContain(
      "left join pg_proc procedure on procedure.oid = identities.new_rpc",
    );
    expect(post).toContain(
      "left join pg_proc procedure on procedure.oid = identities.evidence_trigger",
    );
    expect(post).toContain("1::integer verification_row_count");
    expect(post).toContain(
      "function_contract.exact_function\n      and function_contract.owner_is_postgres",
    );
    expect(post).toContain(
      "trigger_function_contract.exact_function\n      and trigger_function_contract.owner_is_postgres",
    );
    expect(post).toContain("as security_gate");
    expect(post).toContain("paid_renewal_shadow_absent");
    expect(post).toContain("trial_conversion_only");
  });

  test("28. POST source checks are case-insensitive and keep renewal rejection decisive", () => {
    const renewalGuard =
      "canonical renewal or plan-change authority is required";
    const sourceContract = post.slice(
      post.indexOf("source_contract as ("),
      post.indexOf("historical_manual_assignments as ("),
    );
    const authorityWithoutRenewalGuard = authority.replace(
      "Canonical renewal or plan-change authority is required for existing paid subscription history.",
      "Existing paid subscription history requires review.",
    );

    expect(authority).toContain(
      "Canonical renewal or plan-change authority is required for existing paid subscription history.",
    );
    expect(authority.toLowerCase()).toContain(renewalGuard);
    expect(authorityWithoutRenewalGuard.toLowerCase()).not.toContain(
      renewalGuard,
    );
    expect(sourceContract).toContain("select lower(source) normalized_source");
    expect(sourceContract).toContain(
      "normalized_source like\n        '%canonical renewal or plan-change authority is required%'",
    );
    expect(sourceContract).not.toMatch(/\bsource\s+(?:not\s+)?like\b/);
    expect(sourceContract).toContain("paid_renewal_shadow_absent");
    expect(sourceContract).toContain("trial_conversion_only");
    expect(
      post.match(/and gates\.paid_renewal_shadow_absent/g),
    ).toHaveLength(2);
    expect(post.match(/and gates\.trial_conversion_only/g)).toHaveLength(2);
  });
});
