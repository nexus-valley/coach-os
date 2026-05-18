import type { Course } from "@/src/lib/courses";
import type { Payment } from "@/src/lib/payments";
import type { Student } from "@/src/lib/students";
import { logActivity } from "@/src/lib/auditLogger";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type ReminderType =
  | "general"
  | "payment"
  | "course_followup"
  | "student_followup";

export type ReminderStatus = "pending" | "completed" | "cancelled";

export type Reminder = {
  id: string;
  tenant_id: string;
  student_id: string | null;
  course_id: string | null;
  payment_id: string | null;
  title: string;
  description: string | null;
  reminder_type: ReminderType;
  due_at: string;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
};

type ReminderStudent = Pick<
  Student,
  "email" | "full_name" | "id" | "phone" | "tenant_id"
>;
type ReminderCourse = Pick<Course, "id" | "tenant_id" | "title">;
type ReminderPayment = Pick<
  Payment,
  "amount" | "currency" | "id" | "status" | "tenant_id"
>;

export type ReminderWithRelations = Reminder & {
  course: ReminderCourse | null;
  payment: ReminderPayment | null;
  student: ReminderStudent | null;
};

export type CreateReminderPayload = {
  course_id?: string | null;
  description: string;
  due_at: string;
  payment_id?: string | null;
  reminder_type: ReminderType;
  student_id?: string | null;
  tenant_id: string;
  title: string;
};

const reminderSelect =
  "id,tenant_id,student_id,course_id,payment_id,title,description,reminder_type,due_at,status,created_at,updated_at";

async function attachReminderRelations(
  reminders: Reminder[],
  tenantId: string,
) {
  if (reminders.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const studentIds = Array.from(
    new Set(
      reminders
        .map((reminder) => reminder.student_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const courseIds = Array.from(
    new Set(
      reminders
        .map((reminder) => reminder.course_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const paymentIds = Array.from(
    new Set(
      reminders
        .map((reminder) => reminder.payment_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [studentsResult, coursesResult, paymentsResult] = await Promise.all([
    studentIds.length
      ? supabase
          .from("students")
          .select("id,tenant_id,full_name,email,phone")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,tenant_id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    paymentIds.length
      ? supabase
          .from("payments")
          .select("id,tenant_id,amount,currency,status")
          .eq("tenant_id", tenantId)
          .in("id", paymentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (paymentsResult.error) {
    throw paymentsResult.error;
  }

  const students = (studentsResult.data ?? []) as ReminderStudent[];
  const courses = (coursesResult.data ?? []) as ReminderCourse[];
  const payments = (paymentsResult.data ?? []) as ReminderPayment[];
  const studentById = new Map(students.map((student) => [student.id, student]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));

  return reminders.map((reminder) => ({
    ...reminder,
    course: reminder.course_id
      ? courseById.get(reminder.course_id) ?? null
      : null,
    payment: reminder.payment_id
      ? paymentById.get(reminder.payment_id) ?? null
      : null,
    student: reminder.student_id
      ? studentById.get(reminder.student_id) ?? null
      : null,
  })) as ReminderWithRelations[];
}

export async function getRemindersForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reminders")
    .select(reminderSelect)
    .eq("tenant_id", tenantId)
    .order("due_at", { ascending: true });

  if (error) {
    throw error;
  }

  return attachReminderRelations((data ?? []) as Reminder[], tenantId);
}

export async function createReminder(payload: CreateReminderPayload) {
  await requireTenantPermission({
    description: "Blocked reminder creation without student management permission.",
    permission: "manage_students",
    tenantId: payload.tenant_id,
  });

  const title = payload.title.trim();

  if (!title) {
    throw new Error("Reminder title is required.");
  }

  if (!payload.due_at) {
    throw new Error("Reminder due date is required.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reminders")
    .insert({
      course_id: payload.course_id || null,
      description: payload.description.trim() || null,
      due_at: payload.due_at,
      payment_id: payload.payment_id || null,
      reminder_type: payload.reminder_type,
      student_id: payload.student_id || null,
      tenant_id: payload.tenant_id,
      title,
    })
    .select(reminderSelect)
    .single();

  if (error) {
    throw error;
  }

  const reminder = data as Reminder;

  await logActivity({
    action: "reminder_created",
    description: "Created reminder",
    entityId: reminder.id,
    entityName: reminder.title,
    entityType: "reminder",
    metadata: {
      courseId: reminder.course_id,
      dueAt: reminder.due_at,
      studentId: reminder.student_id,
      type: reminder.reminder_type,
    },
    tenantId: reminder.tenant_id,
  });

  return reminder;
}

export async function updateReminderStatus(
  reminderId: string,
  tenantId: string,
  status: ReminderStatus,
) {
  await requireTenantPermission({
    description: "Blocked reminder status update without student management permission.",
    permission: "manage_students",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reminders")
    .update({ status })
    .eq("tenant_id", tenantId)
    .eq("id", reminderId)
    .select(reminderSelect)
    .single();

  if (error) {
    throw error;
  }

  const reminder = data as Reminder;

  await logActivity({
    action:
      status === "completed" ? "reminder_completed" : "reminder_status_updated",
    description:
      status === "completed"
        ? "Marked reminder as completed"
        : `Updated reminder status to ${status}`,
    entityId: reminder.id,
    entityName: reminder.title,
    entityType: "reminder",
    metadata: { status: reminder.status },
    tenantId: reminder.tenant_id,
  });

  return reminder;
}

export async function deleteReminder(reminderId: string, tenantId: string) {
  await requireTenantPermission({
    description: "Blocked reminder deletion without delete permission.",
    permission: "delete_records",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingReminder, error: existingError } = await supabase
    .from("reminders")
    .select(reminderSelect)
    .eq("tenant_id", tenantId)
    .eq("id", reminderId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("reminders")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", reminderId);

  if (error) {
    throw error;
  }

  if (existingReminder) {
    const reminder = existingReminder as Reminder;
    await logActivity({
      action: "reminder_deleted",
      description: "Deleted reminder",
      entityId: reminder.id,
      entityName: reminder.title,
      entityType: "reminder",
      metadata: {
        dueAt: reminder.due_at,
        status: reminder.status,
        type: reminder.reminder_type,
      },
      severity: "warning",
      tenantId: reminder.tenant_id,
    });
  }
}

export async function getReminderCounts(tenantId: string) {
  const supabase = getSupabaseClient();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { count, error } = await supabase
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("due_at", todayEnd.toISOString());

  if (error) {
    throw error;
  }

  return {
    pendingDueTodayOrOverdue: count ?? 0,
  };
}
