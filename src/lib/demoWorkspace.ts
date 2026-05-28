import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { refreshWorkspaceUsageSnapshot } from "@/src/lib/usage";

export type DemoWorkspaceStatus = {
  batchId: string | null;
  lastLoadedAt: string | null;
  loaded: boolean;
  recordCount: number;
};

export type DemoSeedSummary = {
  assignments: number;
  attendance: number;
  cohorts: number;
  conversations: number;
  courses: number;
  enrollments: number;
  lessons: number;
  notifications: number;
  paymentLinks: number;
  payments: number;
  sections: number;
  sessions: number;
  students: number;
  submissions: number;
};

type DemoSeedRecord = {
  created_at: string;
  entity_id: string;
  entity_type: string;
  metadata_json?: Record<string, unknown> | null;
  seed_batch_id: string;
};

type CreatedRecord = {
  id: string;
};

type DemoStudentInput = {
  email: string;
  name: string;
  phone: string;
  status: "active" | "inactive" | "lead";
};

const demoStudents: DemoStudentInput[] = [
  ["Aarav Sharma", "aarav.sharma"],
  ["Diya Menon", "diya.menon"],
  ["Kabir Iyer", "kabir.iyer"],
  ["Ananya Rao", "ananya.rao"],
  ["Rohan Gupta", "rohan.gupta"],
  ["Meera Krishnan", "meera.krishnan"],
  ["Vivaan Nair", "vivaan.nair"],
  ["Ishita Bose", "ishita.bose"],
  ["Aditya Verma", "aditya.verma"],
  ["Nisha Patel", "nisha.patel"],
  ["Arjun Kumar", "arjun.kumar"],
  ["Priya Anand", "priya.anand"],
  ["Kavin Raj", "kavin.raj"],
  ["Nivi Raman", "nivi.raman"],
  ["Sara Joseph", "sara.joseph"],
  ["Dev Malhotra", "dev.malhotra"],
  ["Tanvi Singh", "tanvi.singh"],
  ["Harsh Mehta", "harsh.mehta"],
  ["Aisha Khan", "aisha.khan"],
  ["Neel Reddy", "neel.reddy"],
  ["Ritika Das", "ritika.das"],
  ["Yuvan Pillai", "yuvan.pillai"],
  ["Mahika Jain", "mahika.jain"],
  ["Siddharth Roy", "siddharth.roy"],
].map(([name, slug], index) => ({
  email: `${slug}.demo@brightpath.example`,
  name,
  phone: `+91987654${String(2100 + index).padStart(4, "0")}`,
  status: index % 11 === 0 ? "lead" : index % 9 === 0 ? "inactive" : "active",
}));

const demoCourses = [
  {
    description:
      "High-conversion demo program with biology concepts, revision plans, and test practice.",
    slug: "neet-biology-masterclass-demo",
    title: "NEET Biology Masterclass",
  },
  {
    description:
      "Foundation physics course covering mechanics, vectors, motion, and numerical confidence.",
    slug: "jee-physics-foundation-demo",
    title: "JEE Physics Foundation",
  },
  {
    description:
      "Communication-focused English program with speaking drills, vocabulary, and confidence routines.",
    slug: "spoken-english-accelerator-demo",
    title: "Spoken English Accelerator",
  },
];

const emptySummary: DemoSeedSummary = {
  assignments: 0,
  attendance: 0,
  cohorts: 0,
  conversations: 0,
  courses: 0,
  enrollments: 0,
  lessons: 0,
  notifications: 0,
  paymentLinks: 0,
  payments: 0,
  sections: 0,
  sessions: 0,
  students: 0,
  submissions: 0,
};

const resetOrder = [
  "conversation_messages",
  "conversation_participants",
  "conversation_threads",
  "notifications",
  "communication_logs",
  "assignment_submissions",
  "assignments",
  "attendance_records",
  "sessions",
  "payment_links",
  "payments",
  "cohort_members",
  "cohorts",
  "enrollments",
  "lessons",
  "course_sections",
  "courses",
  "students",
] as const;

const workspaceBrandingFields = [
  "address_line_1",
  "address_line_2",
  "brand_color",
  "certificate_issuer_name",
  "city",
  "country",
  "name",
  "postal_code",
  "receipt_footer_text",
  "state",
  "support_email",
  "support_phone",
  "website_url",
  "whatsapp_number",
  "workspace_display_name",
] as const;

function addDays(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function toDateOnly(days: number) {
  return addDays(days).slice(0, 10);
}

function createBatchId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    "randomUUID" in globalThis.crypto
  ) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function getPreviousBranding(record: DemoSeedRecord) {
  const previous = record.metadata_json?.previous;

  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    return null;
  }

  return previous as Record<string, string | null>;
}

function isDemoTrackingMissingError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("demo_seed_records") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function isMissingMetadataColumnError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "PGRST204" ||
    (message.includes("metadata_json") && message.includes("column"))
  );
}

function getEmptyDemoStatus(): DemoWorkspaceStatus {
  return {
    batchId: null,
    lastLoadedAt: null,
    loaded: false,
    recordCount: 0,
  };
}

async function ensureDemoPermission(tenantId: string) {
  const { user } = await requireTenantPermission({
    description: "Blocked demo workspace management without owner/admin access.",
    permission: "manage_workspace",
    tenantId,
  });

  return user.id;
}

async function requireDemoTrackingTable() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("demo_seed_records")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (error) {
    if (isDemoTrackingMissingError(error)) {
      throw new Error(
        "Demo tracking is not installed yet. Run supabase/module38_demo_workspace.sql before loading demo data.",
      );
    }

    throw error;
  }
}

export async function recordDemoSeedEntity(params: {
  batchId: string;
  entityId: string;
  entityType: string;
  metadata?: Record<string, unknown>;
  tenantId: string;
  userId: string;
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("demo_seed_records").insert({
    created_by: params.userId,
    entity_id: params.entityId,
    entity_type: params.entityType,
    metadata_json: params.metadata ?? {},
    seed_batch_id: params.batchId,
    tenant_id: params.tenantId,
  });

  if (error && error.code !== "23505") {
    throw error;
  }
}

async function insertTracked<T extends CreatedRecord>(
  table: string,
  payload: Record<string, unknown>,
  params: { batchId: string; tenantId: string; userId: string },
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  const created = data as T;
  await recordDemoSeedEntity({
    batchId: params.batchId,
    entityId: created.id,
    entityType: table,
    tenantId: params.tenantId,
    userId: params.userId,
  });

  return created;
}

async function updateWorkspaceBranding(
  tenantId: string,
  params: { batchId: string; userId: string },
) {
  const supabase = getSupabaseClient();
  const { data: currentBranding, error: currentBrandingError } = await supabase
    .from("tenants")
    .select(workspaceBrandingFields.join(","))
    .eq("id", tenantId)
    .single();

  if (currentBrandingError) {
    throw currentBrandingError;
  }

  const { error } = await supabase
    .from("tenants")
    .update({
      address_line_1: "Demo Campus, 18 Learning Avenue",
      address_line_2: "Near Central Library",
      brand_color: "#145da0",
      certificate_issuer_name: "BrightPath Academy Academic Office",
      city: "Chennai",
      country: "India",
      name: "BrightPath Academy",
      postal_code: "600034",
      receipt_footer_text:
        "Thank you for learning with BrightPath Academy. This is sample demo data.",
      state: "Tamil Nadu",
      support_email: "support@brightpath.example",
      support_phone: "+91 98765 43210",
      website_url: "https://coachfort.com",
      whatsapp_number: "+91 98765 43210",
      workspace_display_name: "BrightPath Academy",
    })
    .eq("id", tenantId);

  if (error) {
    throw error;
  }

  await recordDemoSeedEntity({
    batchId: params.batchId,
    entityId: tenantId,
    entityType: "tenant_branding",
    metadata: { previous: currentBranding ?? {} },
    tenantId,
    userId: params.userId,
  });
}

export async function getDemoWorkspaceStatus(
  tenantId: string,
): Promise<DemoWorkspaceStatus> {
  await ensureDemoPermission(tenantId);
  const supabase = getSupabaseClient();
  const { data, error, count } = await supabase
    .from("demo_seed_records")
    .select("seed_batch_id,created_at", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isDemoTrackingMissingError(error)) {
      return getEmptyDemoStatus();
    }

    throw error;
  }

  const rows = (data ?? []) as Pick<
    DemoSeedRecord,
    "created_at" | "seed_batch_id"
  >[];

  return {
    batchId: rows[0]?.seed_batch_id ?? null,
    lastLoadedAt: rows[0]?.created_at ?? null,
    loaded: (count ?? rows.length) > 0,
    recordCount: count ?? rows.length,
  };
}

export async function seedDemoWorkspace(tenantId: string) {
  const userId = await ensureDemoPermission(tenantId);
  await requireDemoTrackingTable();
  const status = await getDemoWorkspaceStatus(tenantId);

  if (status.loaded) {
    return {
      batchId: status.batchId,
      alreadyLoaded: true,
      status,
      summary: { ...emptySummary },
    };
  }

  const batchId = createBatchId();
  const summary = { ...emptySummary };
  const students: CreatedRecord[] = [];
  const courses: CreatedRecord[] = [];
  const cohorts: CreatedRecord[] = [];
  const enrollments: CreatedRecord[] = [];
  const sessions: CreatedRecord[] = [];
  const assignments: CreatedRecord[] = [];

  await updateWorkspaceBranding(tenantId, { batchId, userId });

  for (const student of demoStudents) {
    const created = await insertTracked("students", {
      created_by: userId,
      email: student.email,
      full_name: student.name,
      notes: "Demo record - sample learner profile for BrightPath Academy.",
      phone: student.phone,
      source: "Demo workspace",
      status: student.status,
      tenant_id: tenantId,
    }, { batchId, tenantId, userId });
    students.push(created);
    summary.students += 1;
  }

  for (const course of demoCourses) {
    const createdCourse = await insertTracked("courses", {
      created_by: userId,
      description: course.description,
      slug: course.slug,
      status: "published",
      tenant_id: tenantId,
      title: course.title,
    }, { batchId, tenantId, userId });
    courses.push(createdCourse);
    summary.courses += 1;

    for (const [sectionIndex, sectionTitle] of [
      "Foundation",
      "Practice Lab",
      "Revision Sprint",
    ].entries()) {
      const section = await insertTracked("course_sections", {
        course_id: createdCourse.id,
        sort_order: sectionIndex,
        tenant_id: tenantId,
        title: sectionTitle,
      }, { batchId, tenantId, userId });
      summary.sections += 1;

      for (const [lessonIndex, lessonTitle] of [
        `${sectionTitle} orientation`,
        `${sectionTitle} guided practice`,
        `${sectionTitle} checkpoint`,
      ].entries()) {
        await insertTracked("lessons", {
          content: `Demo record - ${lessonTitle} content for ${course.title}.`,
          course_id: createdCourse.id,
          is_preview: lessonIndex === 0,
          lesson_type: "text",
          resource_url: null,
          section_id: section.id,
          sort_order: lessonIndex,
          tenant_id: tenantId,
          title: lessonTitle,
          video_url: null,
        }, { batchId, tenantId, userId });
        summary.lessons += 1;
      }
    }
  }

  const cohortInputs = [
    { course: courses[0], name: "NEET 2026 Morning Batch", studentStart: 0 },
    { course: courses[1], name: "JEE Weekend Batch", studentStart: 8 },
    { course: courses[2], name: "English Evening Batch", studentStart: 16 },
  ];

  for (const cohortInput of cohortInputs) {
    const cohort = await insertTracked("cohorts", {
      course_id: cohortInput.course.id,
      description:
        "Demo record - realistic batch for sessions, attendance, assignments, and reports.",
      end_date: toDateOnly(90),
      name: cohortInput.name,
      start_date: toDateOnly(-15),
      tenant_id: tenantId,
    }, { batchId, tenantId, userId });
    cohorts.push(cohort);
    summary.cohorts += 1;

    const cohortStudents = students.slice(
      cohortInput.studentStart,
      cohortInput.studentStart + 8,
    );

    for (const [studentIndex, student] of cohortStudents.entries()) {
      const completedEnrollment = studentIndex === 0;
      const enrollment = await insertTracked("enrollments", {
        completed_at: completedEnrollment ? addDays(-3, 15) : null,
        course_id: cohortInput.course.id,
        created_by: userId,
        status: completedEnrollment ? "completed" : "active",
        student_id: student.id,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
      enrollments.push(enrollment);
      summary.enrollments += 1;

      await insertTracked("cohort_members", {
        cohort_id: cohort.id,
        student_id: student.id,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
    }
  }

  for (const [index, cohort] of cohorts.entries()) {
    const course = courses[index];
    const sessionTemplates = [
      { days: -10, mode: "offline", status: "completed", title: "Concept clinic" },
      { days: -4, mode: "hybrid", status: "completed", title: "Practice review" },
      { days: 2, mode: "online", status: "scheduled", title: "Live doubt clearing" },
      { days: 7, mode: "offline", status: "scheduled", title: "Weekly test discussion" },
    ];

    for (const [sessionIndex, template] of sessionTemplates.entries()) {
      const session = await insertTracked("sessions", {
        cohort_id: cohort.id,
        course_id: course.id,
        created_by: userId,
        delivery_mode: template.mode,
        description: `Demo record - ${template.title} for BrightPath Academy.`,
        join_available_from: template.mode === "offline" ? null : addDays(template.days, 9),
        meeting_id: template.mode === "offline" ? null : `BP-${index + 1}${sessionIndex + 1}`,
        meeting_notes:
          template.mode === "offline"
            ? "Room 204, BrightPath Academy"
            : "Demo meeting link only. No external API integration.",
        meeting_passcode: template.mode === "offline" ? null : "demo123",
        meeting_provider: template.mode === "offline" ? null : "google_meet",
        meeting_url:
          template.mode === "offline"
            ? null
            : `https://meet.google.com/demo-${index + 1}${sessionIndex + 1}`,
        scheduled_end_at: addDays(template.days, 11),
        scheduled_start_at: addDays(template.days, 10),
        status: template.status,
        tenant_id: tenantId,
        timezone: "Asia/Kolkata",
        title: `${demoCourses[index].title}: ${template.title}`,
      }, { batchId, tenantId, userId });
      sessions.push(session);
      summary.sessions += 1;
    }
  }

  const studentsByCohort = cohorts.map((cohort) =>
    students.filter((_, index) => {
      const cohortIndex = cohorts.indexOf(cohort);
      return index >= cohortIndex * 8 && index < cohortIndex * 8 + 8;
    }),
  );

  for (const [sessionIndex, session] of sessions.entries()) {
    const cohortIndex = Math.floor(sessionIndex / 4);
    const roster = studentsByCohort[cohortIndex] ?? [];

    for (const [studentIndex, student] of roster.entries()) {
      await insertTracked("attendance_records", {
        marked_by: userId,
        marked_at: addDays(-Math.max(1, 8 - sessionIndex), 12),
        remarks: "Demo attendance record",
        session_id: session.id,
        status:
          studentIndex % 7 === 0
            ? "absent"
            : studentIndex % 5 === 0
              ? "late"
              : studentIndex % 6 === 0
                ? "excused"
                : "present",
        student_id: student.id,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
      summary.attendance += 1;
    }
  }

  for (const [index, course] of courses.entries()) {
    const cohort = cohorts[index];
    const assignmentTemplates = [
      { days: -2, status: "published", title: "Weekly practice worksheet" },
      { days: 3, status: "published", title: "Upcoming concept check" },
      { days: 10, status: "draft", title: "Revision planning task" },
    ];

    for (const template of assignmentTemplates) {
      const assignment = await insertTracked("assignments", {
        attachment_urls_json: [],
        cohort_id: cohort.id,
        course_id: course.id,
        created_by: userId,
        description: `Demo record - ${template.title}.`,
        due_at: addDays(template.days, 20),
        instructions:
          "Submit written answers and review feedback. Attachments are placeholders for future storage.",
        max_score: 100,
        status: template.status,
        tenant_id: tenantId,
        title: `${demoCourses[index].title}: ${template.title}`,
      }, { batchId, tenantId, userId });
      assignments.push(assignment);
      summary.assignments += 1;
    }
  }

  for (const [assignmentIndex, assignment] of assignments.entries()) {
    const cohortIndex = Math.floor(assignmentIndex / 3);
    const roster = studentsByCohort[cohortIndex] ?? [];

    for (const [studentIndex, student] of roster.entries()) {
      if (studentIndex > 5) {
        continue;
      }

      const reviewed = studentIndex % 3 !== 0;
      await insertTracked("assignment_submissions", {
        assignment_id: assignment.id,
        attachment_urls_json: [],
        feedback: reviewed ? "Good demo submission. Revise one weak area." : null,
        reviewed_at: reviewed ? addDays(-1, 16) : null,
        reviewed_by: reviewed ? userId : null,
        score: reviewed ? 72 + ((studentIndex + assignmentIndex) % 21) : null,
        status: reviewed ? "reviewed" : studentIndex % 2 === 0 ? "late" : "submitted",
        student_id: student.id,
        submission_text: "Demo submission response for review workflow.",
        submitted_at: addDays(-2, 19),
        submitted_by: userId,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
      summary.submissions += 1;
    }
  }

  for (const [index, enrollment] of enrollments.entries()) {
    const course = courses[index < 8 ? 0 : index < 16 ? 1 : 2];
    const student = students[index];
    const completed = index % 4 !== 0;

    if (completed) {
      await insertTracked("payments", {
        amount: 8500 + (index % 3) * 1500,
        course_id: course.id,
        currency: "INR",
        enrollment_id: enrollment.id,
        notes: "Demo record - completed academy fee payment.",
        paid_at: addDays(-index - 1, 14),
        payment_method: index % 2 === 0 ? "UPI" : "Bank",
        status: "completed",
        student_id: student.id,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
      summary.payments += 1;
    } else {
      await insertTracked("payment_links", {
        amount: 8500,
        course_id: course.id,
        created_by: userId,
        currency: "INR",
        description: "Demo record - pending installment payment link.",
        enrollment_id: enrollment.id,
        expires_at: addDays(7, 23),
        payment_url: `upi://pay?pa=YOUR_UPI_ID&pn=BrightPath%20Academy&am=8500.00&cu=INR`,
        provider: "manual",
        status: "sent",
        student_id: student.id,
        tenant_id: tenantId,
      }, { batchId, tenantId, userId });
      summary.paymentLinks += 1;
    }
  }

  for (const [index, type] of [
    "assignment_notice",
    "live_session_notice",
    "payment_reminder",
    "system_notice",
  ].entries()) {
    await insertTracked("notifications", {
      action_url:
        type === "payment_reminder"
          ? "/app/payment-links"
          : type === "live_session_notice"
            ? "/app/sessions"
            : "/app",
      entity_id: null,
      entity_type: "demo_data",
      message:
        type === "system_notice"
          ? "Demo data loaded successfully for BrightPath Academy."
          : "Sample demo notification generated by the demo workspace seeder.",
      metadata_json: { seedBatchId: batchId },
      severity: index === 2 ? "warning" : "info",
      status: "unread",
      tenant_id: tenantId,
      title:
        type === "assignment_notice"
          ? "Assignment due soon"
          : type === "live_session_notice"
            ? "Live class scheduled"
            : type === "payment_reminder"
              ? "Payment reminder"
              : "Demo data loaded",
      type,
      user_id: userId,
    }, { batchId, tenantId, userId });
    summary.notifications += 1;
  }

  const threadInputs = [
    {
      cohort: null,
      course: null,
      message: "Welcome to the BrightPath Academy demo workspace.",
      title: "Welcome to BrightPath Academy",
      type: "announcement",
    },
    {
      cohort: null,
      course: courses[0],
      message: "Use this thread for NEET Biology concept questions.",
      title: "NEET Biology discussion",
      type: "course_discussion",
    },
    {
      cohort: cohorts[1],
      course: courses[1],
      message: "Weekend batch updates and class reminders appear here.",
      title: "JEE Weekend Batch updates",
      type: "cohort_discussion",
    },
  ];

  for (const threadInput of threadInputs) {
    const thread = await insertTracked("conversation_threads", {
      cohort_id: threadInput.cohort?.id ?? null,
      course_id: threadInput.course?.id ?? null,
      created_by: userId,
      description: "Demo record - sample communication thread.",
      status: "active",
      tenant_id: tenantId,
      thread_type: threadInput.type,
      title: threadInput.title,
    }, { batchId, tenantId, userId });
    summary.conversations += 1;

    await insertTracked("conversation_participants", {
      last_read_at: null,
      role: "owner",
      tenant_id: tenantId,
      thread_id: thread.id,
      user_id: userId,
    }, { batchId, tenantId, userId });

    await insertTracked("conversation_messages", {
      message: threadInput.message,
      message_type: threadInput.type === "announcement" ? "announcement" : "text",
      metadata_json: { seedBatchId: batchId },
      sender_user_id: userId,
      status: "sent",
      tenant_id: tenantId,
      thread_id: thread.id,
    }, { batchId, tenantId, userId });
  }

  await refreshWorkspaceUsageSnapshot(tenantId);
  await logActivity({
    action: "demo_workspace_seeded",
    description: "Loaded tracked BrightPath Academy demo workspace data.",
    entityName: "BrightPath Academy demo",
    entityType: "demo_data",
    metadata: { seedBatchId: batchId, summary },
    tenantId,
  });

  return {
    batchId,
    alreadyLoaded: false,
    status: await getDemoWorkspaceStatus(tenantId),
    summary,
  };
}

export async function deleteDemoSeedBatch(tenantId: string, batchId?: string | null) {
  const userId = await ensureDemoPermission(tenantId);
  const supabase = getSupabaseClient();
  const baseSelect = "entity_type,entity_id,seed_batch_id,created_at";
  let recordsQuery = supabase
    .from("demo_seed_records")
    .select(`${baseSelect},metadata_json`)
    .eq("tenant_id", tenantId);

  if (batchId) {
    recordsQuery = recordsQuery.eq("seed_batch_id", batchId);
  }

  const recordsResult = await recordsQuery;
  let recordsData: unknown = recordsResult.data;
  let error = recordsResult.error;

  if (error && isMissingMetadataColumnError(error)) {
    let fallbackQuery = supabase
      .from("demo_seed_records")
      .select(baseSelect)
      .eq("tenant_id", tenantId);

    if (batchId) {
      fallbackQuery = fallbackQuery.eq("seed_batch_id", batchId);
    }

    const fallbackResult = await fallbackQuery;
    recordsData = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    if (isDemoTrackingMissingError(error)) {
      return {
        deletedByType: {},
        recordCount: 0,
      };
    }

    throw error;
  }

  const records = (recordsData ?? []) as DemoSeedRecord[];
  const deletedByType: Record<string, number> = {};
  const brandingRecords = records.filter(
    (record) => record.entity_type === "tenant_branding",
  );

  for (const record of brandingRecords) {
    const previousBranding = getPreviousBranding(record);

    if (!previousBranding) {
      continue;
    }

    const { error: restoreError } = await supabase
      .from("tenants")
      .update(previousBranding)
      .eq("id", tenantId);

    if (restoreError) {
      throw restoreError;
    }

    deletedByType.tenant_branding =
      (deletedByType.tenant_branding ?? 0) + 1;
  }

  for (const table of resetOrder) {
    const ids = records
      .filter((record) => record.entity_type === table)
      .map((record) => record.entity_id);

    if (ids.length === 0) {
      continue;
    }

    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", ids);

    if (deleteError) {
      throw deleteError;
    }

    deletedByType[table] = ids.length;
  }

  let deleteRecordsQuery = supabase
    .from("demo_seed_records")
    .delete()
    .eq("tenant_id", tenantId);

  if (batchId) {
    deleteRecordsQuery = deleteRecordsQuery.eq("seed_batch_id", batchId);
  }

  const { error: trackingDeleteError } = await deleteRecordsQuery;

  if (trackingDeleteError) {
    throw trackingDeleteError;
  }

  await refreshWorkspaceUsageSnapshot(tenantId);
  await logActivity({
    action: "demo_workspace_reset",
    description: "Reset tracked demo workspace data.",
    entityName: "Demo workspace data",
    entityType: "demo_data",
    metadata: {
      deletedByType,
      recordCount: records.length,
      seedBatchId: batchId ?? null,
      userId,
    },
    severity: "warning",
    tenantId,
  });

  return {
    deletedByType,
    recordCount: records.length,
  };
}

export async function resetDemoWorkspace(tenantId: string) {
  return deleteDemoSeedBatch(tenantId);
}
