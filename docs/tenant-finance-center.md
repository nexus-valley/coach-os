# Tenant Finance Center

Module 55 adds tenant-level institute finance for CoachFort customers. It is
separate from CoachFort platform-owner billing and does not collect money or
integrate a payment gateway.

Finance Center is the canonical tenant finance experience. Legacy app routes
such as `/app/payments`, `/app/payment-links`, and `/app/receipts` are not active
payment workspaces after Module 64.

## Purpose

The Finance Center lets each tenant manage its own:

- fee plans
- student invoices
- manual payments
- receipts
- discounts and adjustments
- dues and overdue visibility
- finance activity and audit trail

Tenant A can only see Tenant A finance data. Tenant B can only see Tenant B
finance data.

## Access Model

- Owner/admin: full tenant finance access and all write RPCs.
- Staff: no Finance Center access in Module 55.
- Trainer: no Finance Center access in Module 55.
- Student: `/portal/payments` read-only view for their own finance records.
- Anonymous/public: no access.

Student finance reads are based on `student_portal_accounts`, not
`tenant_members`.

## Data Model

Module 55 creates namespaced finance tables:

- `finance_settings`
- `finance_fee_plans`
- `finance_invoices`
- `finance_payments`
- `finance_receipts`
- `finance_adjustments`
- `finance_activity_logs`

Existing legacy `payments`, `payment_links`, and platform `invoices` tables are
not reused or weakened.

Legacy payment records are preserved for historical read-only compatibility.
They are not the source of truth for new fee plans, invoices, payments, or
receipts.

## RPC Write Model

All finance writes go through SECURITY DEFINER RPCs:

- `upsert_finance_settings`
- `create_fee_plan`
- `update_fee_plan`
- `create_invoice`
- `update_invoice`
- `void_invoice`
- `record_payment`
- `cancel_payment`
- `apply_invoice_adjustment`

Read RPCs:

- `get_finance_dashboard`
- `get_student_finance_summary`

Direct authenticated insert/update/delete on finance tables is revoked.

## Invoice, Payment, Receipt Flow

Invoices are generated with tenant-scoped invoice numbering. Totals are
calculated server-side:

`total = subtotal - discount + tax`

Payments are manual records only. A recorded payment:

- validates tenant/student/invoice ownership
- rejects overpayment
- updates invoice paid and balance amounts
- creates a receipt
- writes finance activity and audit records

No payment gateway, UPI, Razorpay, Stripe, WhatsApp, email, or SMS provider is
called.

`/app/payments` and `/app/receipts` redirect users to `/app/finance`. The
`/app/payment-links` route shows a gateway-on-hold notice and does not create
new payment links. Existing `/app/receipts/[paymentId]` deep links remain
available as read-only legacy receipts.

## Adjustments

Owner/admin can apply adjustments such as discounts, waivers, corrections, and
penalties. Adjustments cannot make invoice totals negative or lower than the
amount already paid.

## Audit and Activity

Finance actions write `finance_activity_logs` and safe `audit_logs` events.
Audit metadata includes ids, amounts, currency, status, method, and boolean
flags such as `reference_present` or `reason_present`.

Audit metadata does not store full notes, full reference numbers, student
phone/email, or addresses.

## Security Model

- RLS is enabled on all finance tables.
- `anon` has no table or RPC access.
- `authenticated` has SELECT only, protected by RLS.
- Owner/admin can select tenant finance rows.
- Staff/trainer cannot select finance rows by default.
- Linked active students can select only their own invoices, payments, and
receipts.
- Helpers return strict booleans and avoid `current_role` as a local variable.

## Known Limitations

- No payment gateway integration.
- No real UPI/Razorpay/Stripe collection.
- No automatic overdue scheduler.
- No delegated finance access for staff.
- No tax/GST compliance engine.
- No platform owner billing console.
- No advanced finance exports.

## Future Roadmap

- Approval thresholds for large discounts.
- Approval requirements for cancellations/refunds.
- Overdue follow-up workflows.
- Automation reminders for due invoices.
- Payment gateway integration.
- Platform owner billing in a separate console.
