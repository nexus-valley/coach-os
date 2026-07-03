begin;

-- Module 70.3C5: Billing Foundation Direct Write Revoke + Legacy Seed Helper Retirement.
--
-- Modules 70.3C1-70.3C3 retired tenant-side billing mutation controls,
-- fail-closed legacy subscription/invoice/payment helper writes, and made the
-- tenant usage snapshot helper read-only. Module 55 is now the canonical path
-- for tenant/student finance. Module 56 is now the canonical path for platform
-- subscription management.
--
-- Preserve SELECT/read paths for historical display of legacy billing,
-- payment, payment-link, and receipt data. Revoke only direct browser/client
-- write privileges on the old billing foundation tables.

revoke insert, update, delete on table public.subscriptions from anon, authenticated;
revoke insert, update, delete on table public.invoices from anon, authenticated;
revoke insert, update, delete on table public.invoice_items from anon, authenticated;
revoke insert, update, delete on table public.payment_transactions from anon, authenticated;
revoke insert, update, delete on table public.payments from anon, authenticated;
revoke insert, update, delete on table public.payment_links from anon, authenticated;

-- The legacy seed helper was only needed to backfill old foundation
-- subscription rows. It has no active app caller and should not remain callable
-- by browser/authenticated users. Keep the function for historical rollback and
-- migration context, but remove direct execute access when it exists.
do $$
begin
  if to_regprocedure('public.seed_foundation_subscriptions()') is not null then
    execute 'revoke execute on function public.seed_foundation_subscriptions() from public, anon, authenticated';
  end if;
end;
$$;

-- Rollback notes only. Do not run unless explicitly approved during emergency
-- rollback. SELECT grants are intentionally not affected by this patch.
--
-- grant insert, update, delete on table public.subscriptions to authenticated;
-- grant insert, update, delete on table public.invoices to authenticated;
-- grant insert, update, delete on table public.invoice_items to authenticated;
-- grant insert, update, delete on table public.payment_transactions to authenticated;
-- grant insert, update, delete on table public.payments to authenticated;
-- grant insert, update, delete on table public.payment_links to authenticated;
--
-- If the legacy seed helper must be restored temporarily:
-- grant execute on function public.seed_foundation_subscriptions() to authenticated;

commit;
