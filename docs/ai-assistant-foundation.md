# CoachFort AI Assistant Foundation

Module 50 adds a secure assistant foundation for internal team users and linked
students. It is intentionally read-only and uses a mock provider by default.

## Routes

- `/app/assistant` for owner, admin, staff, and trainer users.
- `/portal/assistant` for linked active student portal users.
- `POST /api/assistant/message` for assistant requests.

## Provider Strategy

The current provider is `mock` only. It generates deterministic guidance from
allowlisted CoachFort summaries and does not call an external AI provider.

Future provider support should remain server-side only. Provider API keys must be
read from server environment variables and must never be exposed in browser code.

Suggested future variables:

- `AI_ASSISTANT_PROVIDER`
- `AI_ASSISTANT_MODEL`
- provider-specific server key such as `OPENAI_API_KEY`

No provider key is required for Module 50.

## Context Model

Assistant context is built from Module 49 mobile RPCs rather than direct broad
table reads.

Team assistant context:

- tenant branding summary
- role
- allowed mobile sections
- role permission summary
- compact dashboard-style metrics
- short upcoming/session or assignment summaries where already scoped

Student assistant context:

- linked student's own profile summary
- own enrolled course count
- own upcoming session count/list
- own pending assignments
- own payment summary
- own notification summary

Excluded:

- service-role keys
- API keys
- raw audit logs
- raw payment provider identifiers
- full messages or conversation dumps
- cross-tenant data
- records outside the user's role or student scope

## Storage and Logging

SQL migration:

- `ai_conversations`
- `ai_messages`
- `ai_request_logs`
- `record_ai_assistant_exchange(...)`

The app stores conversation content in assistant-specific tables. Request logs store
counts and context summaries only. Team users also create an `ai_assistant_used`
audit event with metadata only; full prompts and responses are not copied into
audit logs.

Students are not tenant members, so student assistant usage is tracked through
`ai_request_logs`, not tenant-member audit insertion.

## Security Boundaries

- No service-role key in client or API route.
- API route authenticates with the user's bearer token.
- Assistant cannot perform writes to product records.
- Assistant can suggest next steps only.
- Student route uses the student portal guard.
- Team route uses the internal app guard.
- SQL does not grant direct insert into assistant tables; writes go through a
  scoped `SECURITY DEFINER` RPC.
- No anonymous access.

## What Is Not Implemented

- External AI provider calls.
- Autonomous actions.
- Tool calling.
- Course content RAG/vector search.
- Assignment grading.
- Payment, attendance, course, session, student, automation, or settings writes.
- AI usage billing and quotas.
- Admin model controls.

## Future Roadmap

- Real provider integration with server-only API keys.
- Usage limits and subscription gating.
- Admin controls for enabling/disabling assistant scopes.
- AI actions routed through delegated approvals.
- Lesson/course content Q&A with RAG.
- Assignment feedback suggestions.
- Lead follow-up suggestions.
- Automation recommendation drafts.
- Safety review and redaction pipeline.
