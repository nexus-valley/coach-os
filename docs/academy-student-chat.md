# Academy-Student Chat

Module 57 adds a secure academy-student chat foundation for CoachFort. It is designed to reduce dependency on WhatsApp while keeping student conversations tenant-scoped, role-aware, and private.

## Purpose

Academy-student chat lets institute teams communicate with students from the internal app and lets students reply from the student portal. The module supports direct support conversations now and prepares the existing conversation foundation for announcements without enabling external messaging providers.

## Routes

- `/app/messages`: Team-side academy-student thread list, filters, and direct student chat creation.
- `/app/messages/[threadId]`: Team-side thread detail and reply panel.
- `/portal/messages`: Student-side messages, support request creation, and replies to eligible open threads.

## Data Model

Module 57 reuses the existing conversation foundation:

- `conversation_threads`
- `conversation_participants`
- `conversation_messages`

The migration adds `conversation_threads.replies_enabled` and extends `conversation_threads.thread_type` with:

- `student_direct`
- `student_support`
- `course_announcement`
- `cohort_announcement`

No separate student chat tables were created.

## Chat Types

- `student_direct`: Private thread between a student and one or more academy team members.
- `student_support`: Private support request started by a student from the portal.
- `course_announcement`: Course-scoped announcement thread. Student replies are blocked.
- `cohort_announcement`: Cohort-scoped announcement thread. Student replies are blocked.

The Module 57 UI implements direct student chat and student support requests. Announcement RPC read rules are prepared in SQL, but announcement authoring UI is intentionally not overbuilt in this module.

## Role Access Model

Owner/admin:

- View all student-facing chat threads in their tenant.
- Create direct student chats.
- Reply to student-facing threads.
- Close threads.

Staff:

- View/reply only participant or created threads.
- Cannot start direct student chats by default in Module 57.
- No broad tenant-wide student chat visibility by default.

Trainer:

- View/reply participant threads and assigned course/cohort/student-scoped threads.
- Create direct student chats only for students in assigned course/cohort scope.
- No broad tenant-wide student chat visibility by default.

Student:

- View only their own direct/support threads.
- View course/cohort announcements only when enrolled.
- Reply only to open `student_direct` and `student_support` threads where replies are enabled.
- Cannot access internal team-only conversations.

Anon/public:

- No chat access.

Platform admins:

- No chat access by platform role alone. Platform access remains separate from tenant membership.

## RPC Design

All sensitive reads and writes are behind SECURITY DEFINER RPCs:

- `get_team_chat_threads(p_tenant_id)`
- `get_team_chat_thread(p_thread_id)`
- `get_student_chat_threads()`
- `get_student_chat_thread(p_thread_id)`
- `create_student_direct_chat(p_tenant_id, p_student_id, p_title, p_initial_message)`
- `create_student_support_thread(p_title, p_initial_message)`
- `send_team_chat_message(p_thread_id, p_body)`
- `send_student_chat_message(p_thread_id, p_body)`
- `close_chat_thread(p_thread_id)`
- `mark_chat_thread_read(p_thread_id)`

Direct inserts/updates/deletes on the conversation tables are revoked from `authenticated` in the Module 57 migration. The student portal does not directly select conversation tables; it uses student-scoped RPCs.

## RLS / Privacy Model

Earlier student conversation table SELECT policies were disabled because of RLS recursion risk. Module 57 does not reopen those policies. Student chat visibility is resolved manually inside SECURITY DEFINER RPCs using:

- `student_portal_accounts.user_id = auth.uid()`
- `student_portal_accounts.status = 'active'`
- matching `students.tenant_id`
- `coalesce(students.portal_enabled, true) = true`
- `students.status = 'active'`

The RPCs return only thread/message fields needed by the UI. They do not expose private CRM notes, finance notes, platform support notes, AI prompts/responses, or other internal data.

## Validation

SQL RPCs validate:

- Message body required, max 4000 characters.
- Thread title max 180 characters.
- Plain text only for user-entered title/body, rejecting `<` and `>`.
- Server-side sender identity.
- Tenant/student/course/cohort ownership.
- Student enrollment for announcement visibility.
- Thread status and `replies_enabled` before student replies.

## Audit Behavior

The migration writes safe audit events:

- `chat_thread_created`
- `student_support_thread_created`
- `chat_message_sent`
- `chat_thread_closed`

Audit metadata includes identifiers and booleans only, such as `thread_id`, `student_id`, `sender_type`, and `message_present`. Full message bodies are not copied into audit metadata.

## UI Behavior

Team side:

- Thread list with search and type filters.
- Direct student chat creation form.
- Thread detail with message timeline and reply box.
- Closed/archived threads are read-only.
- The page clearly states that no WhatsApp, email, SMS, or push provider is connected.

Student side:

- Own message/support/announcement list.
- Thread detail with message timeline.
- Support request creation form.
- Reply box only for open direct/support threads.
- Read-only notice for announcements and closed threads.

## Known Limitations

- No push notifications.
- No WhatsApp/email/SMS sending.
- No attachments.
- No typing indicators.
- No rich text.
- No AI moderation.
- No group student reply threads.
- No mobile app wrapper.
- Announcement authoring UI is prepared at the data/RPC level but not exposed as a full authoring workflow yet.

## Future Roadmap

- In-app unread notification badges.
- Push notifications for mobile clients.
- Email/WhatsApp fallback via approved providers.
- Attachment support with size/type controls.
- Course/cohort announcement composer.
- AI-assisted thread summaries.
- Moderation tools for academy owners/admins.
- Mobile API expansion for chat threads.
- Delegated staff chat permissions for institutes that want staff to initiate student chats.
