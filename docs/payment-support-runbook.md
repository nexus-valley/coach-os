# CoachFort Payment Support Runbook

Internal CoachFort owner/platform admin/support use only. This is not a public
legal policy, customer-facing help page, or tax advice. During beta, payment
support actions may be manual and must be handled cautiously.

## 1. Purpose and Scope

This runbook helps CoachFort support handle payment incidents during beta/test
checkout and future public checkout.

It covers:

- payment failures
- payment pending states
- browser success with delayed verification
- captured payments without activation
- duplicate payments
- refund review
- cancellation requests
- renewal questions
- Premium/contact-sales requests

This runbook does not replace legal, tax, GST, or accounting advice. Policy
wording should be reviewed by the appropriate business, legal, or tax advisor
before public paid launch.

## 2. Current Payment Architecture

Core safety rule: browser checkout success is not plan activation.

Trusted payment flow:

1. R3 order creation API creates a server-side Razorpay test order.
2. R4 Razorpay webhook verification validates raw-body webhook signatures and
   updates payment/order state.
3. R5 verified payment activation RPC can activate only from verified
   server-side paid/captured database state.
4. R5B activation endpoint calls the R5 RPC for an authenticated tenant
   owner/admin and only for a matching tenant order.
5. R6 checkout/status UI starts the regression-only test checkout and checks
   activation status through the server flow.

Current launch state:

- Webhook processing does not auto-activate plans.
- Activation must go through verified server-side state.
- Public checkout is not active yet.
- R7 end-to-end Razorpay smoke is parked until Razorpay account/test
  keys/webhook are ready.
- R7D public pricing activation SQL is parked until successful R7.
- Premium is contact-sales/custom and has no self-serve checkout.

## 3. Golden Safety Rules

- Never ask for a card number, CVV, UPI PIN, OTP, banking password, Razorpay
  secret key, or CoachFort password.
- Never manually activate a paid plan unless an approved procedure exists.
- Never fake webhook rows or payment evidence.
- Never manually edit payment, activation, or subscription tables.
- Never delete payment evidence.
- Never ask a customer to pay again when money may already be debited.
- Treat a browser success screenshot as useful evidence, not proof of
  activation.
- Use server-side verified payment state only.
- Keep public checkout disabled until explicitly approved.
- Escalate uncertain captured-payment or activation cases to the technical
  owner.

## 4. Information to Collect from Customer

Ask the customer for:

- registered academy/workspace email
- academy or workspace name, if available
- selected plan
- billing cycle
- approximate payment time
- order ID, if shown
- Razorpay payment ID, if shown
- screenshot of payment status, if available
- what they currently see on the subscription page

Do not ask for sensitive payment credentials or account secrets.

## 5. Incident Types and Handling

### A. Payment failed before debit

Symptoms:

- Checkout failed or was cancelled.
- Customer confirms no debit.
- Subscription page still shows the old plan.

Action:

- Confirm that the plan was not changed.
- Tell the customer they may retry later after support confirms there is no
  captured payment.
- If the customer is unsure whether money was debited, treat it as a pending or
  possible debit case instead.

### B. Money debited but plan not active

Symptoms:

- Customer sees a debit or payment success.
- Subscription still shows Starter/trial or the old plan.
- Customer may have an order ID or Razorpay payment ID.

Action:

- Do not ask the customer to pay again immediately.
- Collect order/payment information and screenshots.
- Check payment/order status through safe admin tools or provider dashboard
  views once available.
- If the payment is captured but the plan is not active, escalate as
  captured-not-activated.

### C. Browser success but verification pending

Symptoms:

- Customer saw a successful Razorpay browser result.
- Subscription page still says verification is pending.
- No final activation status is available yet.

Action:

- Explain that browser success is not activation.
- Ask the customer to wait for server-side provider/webhook confirmation.
- Use the app/server activation status flow only where it is available and
  approved.
- Escalate if pending continues beyond the support threshold.

Suggested support threshold during beta: 15 minutes for first review, then
technical escalation if still unresolved.

### D. Captured payment but activation failed or delayed

Symptoms:

- Payment is confirmed captured through safe provider/admin evidence.
- Tenant plan did not activate.
- Activation status is failed, pending too long, or unclear.

Action:

- Treat as highest priority.
- Do not patch database rows manually.
- Do not create fake webhook evidence.
- Review available R4 webhook status, R5B activation response, and R5 activation
  event summaries through safe read-only/admin tooling when available.
- Escalate to the technical owner with collected customer details and evidence.
- Decide on refund or retry only after the verified state is understood.

### E. Duplicate payment

Symptoms:

- Customer reports more than one debit.
- Customer has multiple payment IDs, order IDs, or bank entries.

Action:

- Collect all order/payment IDs and timestamps.
- Verify whether each payment was captured through safe provider/admin views.
- Provide priority refund review for confirmed duplicate captured payments.
- Do not promise instant refund.
- Tell the customer that approved refunds depend on provider and bank
  processing time.

### F. Payment pending

Symptoms:

- Customer sees pending status in Razorpay, bank, UPI app, or CoachFort.
- No clear failed or captured outcome yet.

Action:

- Ask the customer to wait while the provider state settles.
- Avoid retry advice until debit/capture status is clear.
- Escalate if the pending state exceeds the support threshold.
- Do not mark the plan active from a pending payment.

Suggested support threshold during beta: 30 minutes for ordinary pending
payments, faster if the customer reports a debit.

### G. Refund request

Action:

- Use the 7-day beta refund review window as the default intake rule.
- Review case by case.
- Prioritize duplicate payment, captured-but-not-activated, and billing error
  cases.
- Consider account usage and activation state before approval.
- Do not promise refund approval before review.
- If approved, explain that processing depends on the payment provider and
  bank.

### H. Cancellation request

Action:

- During beta, cancellation requests are handled by CoachFort support/platform
  operations.
- Do not promise self-serve cancellation.
- Ask the customer to raise cancellation before the next renewal or extension
  date.
- Confirm access handling manually until subscription lifecycle automation is
  available.

### I. Renewal question

Action:

- Explain that beta paid access may use one-time Razorpay orders or manual
  renewal flows.
- Do not promise automatic recurring renewal until implemented.
- Explain that future recurring billing will be communicated separately if and
  when it is enabled.

### J. Premium plan request

Action:

- Explain that Premium is a contact-sales plan.
- Do not offer self-serve checkout for Premium.
- Collect academy size, branch count, expected users, student volume,
  compliance needs, support needs, and billing contact.
- Escalate to the CoachFort owner/platform admin.

## 6. Internal Status Checklist

Use this checklist without exposing secrets:

- [ ] Confirm customer/tenant identity.
- [ ] Confirm registered academy/workspace email.
- [ ] Confirm current entitlement state from the UI or admin-safe view.
- [ ] Confirm selected plan and billing cycle.
- [ ] Confirm whether an order ID exists, if available.
- [ ] Confirm whether a provider order/payment ID exists, if available.
- [ ] Confirm whether the provider state is pending, captured, or failed using
      safe provider/dashboard views when available.
- [ ] Confirm whether the webhook was processed, using approved safe tooling.
- [ ] Confirm whether activation status is activated, skipped, pending, or
      failed, using approved safe tooling.
- [ ] Confirm final tenant plan, status, payment status, currency, and billing
      cycle after resolution.
- [ ] Document outcome and customer reply.

Do not include secrets in support notes.

## 7. Escalation Matrix

### SEV1: captured payment but plan not active

Owner: technical owner with CoachFort owner/platform admin visibility.

Expected handling:

- immediate review
- customer kept informed
- refund/retry decision only after verified state is known

### SEV2: duplicate payment

Owner: CoachFort owner/platform admin, with technical owner if order state is
unclear.

Expected handling:

- priority refund review
- provider-side verification
- no instant refund promise

### SEV3: failed payment with no debit

Owner: support/platform admin.

Expected handling:

- reassure that plan was not changed
- retry only after failure/no debit is clear

### SEV4: policy or general billing question

Owner: support/platform admin.

Expected handling:

- answer from the public payment policy and this runbook
- escalate tax/GST disputes to CA/legal advisor

Provider-side issues may require Razorpay support once the Razorpay account is
ready. GST/tax disputes should go to the CA/legal advisor.

## 8. Customer Reply Templates

### Payment failed/no debit

Thanks for the update. The payment appears to have failed or been cancelled, and
your CoachFort plan has not been changed. If no money was debited, you may retry
later after we confirm there is no captured payment.

### Payment pending

Your payment is still pending confirmation. Please do not retry immediately. We
will review the order/payment status and update you once the provider confirms
whether it was captured or failed.

### Payment success but activation pending

Razorpay may show a browser success message before CoachFort completes
server-side verification. Browser success alone does not activate a plan. We are
checking the verified payment status and will update you shortly.

### Captured payment but activation delayed

We understand the payment appears to be captured but your plan has not updated
yet. We are treating this as a priority review. Please do not make another
payment while we verify the order and activation status.

### Duplicate payment under review

Thanks for sharing the payment details. We will review both payment records and
prioritize refund review if a duplicate captured payment is confirmed. Approved
refunds may take additional provider or bank processing time.

### Refund request received

We have received your refund review request. Beta refund requests are reviewed
case by case, with priority for duplicate payments, billing errors, or captured
payments where activation failed. We will update you after verification.

### Cancellation request received

We have received your cancellation request. During beta, cancellation is handled
through CoachFort support/platform operations. We will review your current
access period and confirm the next steps.

### Sensitive information reminder

For your safety, please do not share card numbers, CVV, UPI PIN, OTP, banking
passwords, Razorpay secret keys, or your CoachFort password. CoachFort support
will never ask for these details.

## 9. What Not To Do

- Do not ask for card numbers, CVV, UPI PIN, OTP, banking passwords, Razorpay
  secret keys, or CoachFort passwords.
- Do not manually set a plan to paid unless an approved procedure exists.
- Do not create fake webhook events.
- Do not delete payment evidence.
- Do not ask the customer to retry payment if a debit may have occurred.
- Do not promise refunds before review.
- Do not promise automatic renewal before it is implemented.
- Do not promise self-serve cancellation before it is implemented.
- Do not promise automated GST invoice generation before it is implemented.
- Do not treat browser success as activation proof.

## 10. Beta Limitations

- Public checkout is not active yet.
- Razorpay R7 smoke is parked until account/test keys/webhook are ready.
- GST invoice automation is not guaranteed yet.
- Self-serve cancellation is not available yet.
- Automatic recurring renewal is not active yet.
- Premium self-serve checkout is not available.
- Webhook processing does not auto-activate plans.
- Payment support procedures may change after test-mode and public launch
  validation.

## 11. Future Updates Needed

- Add screenshots once admin/payment dashboards are ready.
- Add exact support dashboard paths once built.
- Add Razorpay dashboard verification steps after the Razorpay account is ready.
- Add refund execution procedure after owner approval.
- Add renewal/cancellation procedure after lifecycle modules.
- Add receipt/invoice procedure after invoice modules.
- Add final GST/tax handling after CA/legal review.
