import type { AutomationRuleConfig } from "@/src/lib/automations";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole } from "@/src/lib/team";

type DemoSeedResult = {
  automations: number;
  cohorts: number;
  courses: number;
  enrollments: number;
  lessons: number;
  paymentLinks: number;
  payments: number;
  reminders: number;
  sections: number;
  students: number;
};

type DemoStudent = {
  email: string;
  full_name: string;
  phone: string;
  source: string;
  status: "active" | "lead";
};

type DemoCourse = {
  description: string;
  sections: Array<{
    lessons: string[];
    title: string;
  }>;
  slug: string;
  title: string;
};

const demoNote = "Demo record";

const demoStudents: DemoStudent[] = [
  {
    email: "nivi.raman.demo@coachfort.example",
    full_name: "Nivi Raman",
    phone: "+917338841401",
    source: "Demo import",
    status: "active",
  },
  {
    email: "arjun.kumar.demo@coachfort.example",
    full_name: "Arjun Kumar",
    phone: "+917338841402",
    source: "Demo import",
    status: "active",
  },
  {
    email: "meera.s.demo@coachfort.example",
    full_name: "Meera S",
    phone: "+917338841403",
    source: "Demo import",
    status: "active",
  },
  {
    email: "kavin.raj.demo@coachfort.example",
    full_name: "Kavin Raj",
    phone: "+917338841404",
    source: "Demo import",
    status: "lead",
  },
  {
    email: "priya.anand.demo@coachfort.example",
    full_name: "Priya Anand",
    phone: "+917338841405",
    source: "Demo import",
    status: "lead",
  },
];

const demoCourses: DemoCourse[] = [
  {
    description:
      "Demo course for exploring CoachFort course delivery, lessons, enrollments, and progress workflows.",
    sections: [
      {
        lessons: [
          "Welcome to Stock Market Basics",
          "How this demo course is structured",
        ],
        title: "Introduction",
      },
      {
        lessons: [
          "Market participants and order flow",
          "Reading basic charts",
        ],
        title: "Basics of Market",
      },
      {
        lessons: [
          "Position sizing basics",
          "Protecting capital with simple rules",
        ],
        title: "Risk Management",
      },
    ],
    slug: "stock-market-basics-demo",
    title: "Stock Market Basics",
  },
  {
    description:
      "Demo course for exploring CoachFort marketing program delivery, cohorts, payments, and reminders.",
    sections: [
      {
        lessons: [
          "Welcome to Digital Marketing Masterclass",
          "How to use the demo learning path",
        ],
        title: "Introduction",
      },
      {
        lessons: [
          "Choosing the right content channels",
          "Planning a weekly content calendar",
        ],
        title: "Social Media Strategy",
      },
      {
        lessons: [
          "Lead magnet foundations",
          "Simple follow-up workflow",
        ],
        title: "Lead Generation",
      },
    ],
    slug: "digital-marketing-masterclass-demo",
    title: "Digital Marketing Masterclass",
  },
];

const emptyResult: DemoSeedResult = {
  automations: 0,
  cohorts: 0,
  courses: 0,
  enrollments: 0,
  lessons: 0,
  paymentLinks: 0,
  payments: 0,
  reminders: 0,
  sections: 0,
  students: 0,
};

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function toDateOnly(days: number) {
  return addDays(days).slice(0, 10);
}

async function getCurrentUserId() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Sign in before loading demo data.");
  }

  return user.id;
}

export async function loadDemoDataForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const userId = await getCurrentUserId();
  const currentRole = await getCurrentMemberRole(tenantId, userId);

  if (currentRole !== "owner" && currentRole !== "admin") {
    throw new Error("Only workspace owners and admins can load demo data.");
  }

  const result = { ...emptyResult };
  const studentsByEmail = new Map<string, { id: string }>();
  const coursesByTitle = new Map<string, { id: string }>();

  for (const student of demoStudents) {
    const { data: existing, error: existingError } = await supabase
      .from("students")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("email", student.email)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      studentsByEmail.set(student.email, existing);
      continue;
    }

    const { data: created, error } = await supabase
      .from("students")
      .insert({
        created_by: userId,
        email: student.email,
        full_name: student.full_name,
        notes: `${demoNote} - sample student profile for CoachFort demo.`,
        phone: student.phone,
        source: student.source,
        status: student.status,
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    studentsByEmail.set(student.email, created);
    result.students += 1;
  }

  for (const course of demoCourses) {
    const { data: existing, error: existingError } = await supabase
      .from("courses")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", course.slug)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    let courseId = existing?.id;

    if (!courseId) {
      const { data: created, error } = await supabase
        .from("courses")
        .insert({
          created_by: userId,
          description: course.description,
          slug: course.slug,
          status: "published",
          tenant_id: tenantId,
          title: course.title,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      courseId = created.id;
      result.courses += 1;
    }

    coursesByTitle.set(course.title, { id: courseId });

    for (const [sectionIndex, section] of course.sections.entries()) {
      const { data: existingSection, error: sectionLookupError } =
        await supabase
          .from("course_sections")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("course_id", courseId)
          .eq("title", section.title)
          .maybeSingle();

      if (sectionLookupError) {
        throw sectionLookupError;
      }

      let sectionId = existingSection?.id;

      if (!sectionId) {
        const { data: createdSection, error } = await supabase
          .from("course_sections")
          .insert({
            course_id: courseId,
            sort_order: sectionIndex,
            tenant_id: tenantId,
            title: section.title,
          })
          .select("id")
          .single();

        if (error) {
          throw error;
        }

        sectionId = createdSection.id;
        result.sections += 1;
      }

      for (const [lessonIndex, lessonTitle] of section.lessons.entries()) {
        const { data: existingLesson, error: lessonLookupError } =
          await supabase
            .from("lessons")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("course_id", courseId)
            .eq("section_id", sectionId)
            .eq("title", lessonTitle)
            .maybeSingle();

        if (lessonLookupError) {
          throw lessonLookupError;
        }

        if (existingLesson) {
          continue;
        }

        const { error } = await supabase.from("lessons").insert({
          content: `${demoNote} - sample lesson content for ${lessonTitle}.`,
          course_id: courseId,
          is_preview: lessonIndex === 0,
          lesson_type: "text",
          resource_url: null,
          section_id: sectionId,
          sort_order: lessonIndex,
          tenant_id: tenantId,
          title: lessonTitle,
          video_url: null,
        });

        if (error) {
          throw error;
        }

        result.lessons += 1;
      }
    }
  }

  const stockCourse = coursesByTitle.get("Stock Market Basics");
  const marketingCourse = coursesByTitle.get("Digital Marketing Masterclass");
  const nivi = studentsByEmail.get("nivi.raman.demo@coachfort.example");
  const arjun = studentsByEmail.get("arjun.kumar.demo@coachfort.example");
  const meera = studentsByEmail.get("meera.s.demo@coachfort.example");
  const kavin = studentsByEmail.get("kavin.raj.demo@coachfort.example");
  const priya = studentsByEmail.get("priya.anand.demo@coachfort.example");

  const enrollmentInputs = [
    { course: stockCourse, student: nivi },
    { course: stockCourse, student: arjun },
    { course: stockCourse, student: meera },
    { course: marketingCourse, student: kavin },
    { course: marketingCourse, student: priya },
  ];
  const enrollmentByKey = new Map<string, { id: string }>();

  for (const input of enrollmentInputs) {
    if (!input.course || !input.student) {
      continue;
    }

    const key = `${input.student.id}:${input.course.id}`;
    const { data: existing, error: existingError } = await supabase
      .from("enrollments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("student_id", input.student.id)
      .eq("course_id", input.course.id)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      enrollmentByKey.set(key, existing);
      continue;
    }

    const { data: created, error } = await supabase
      .from("enrollments")
      .insert({
        course_id: input.course.id,
        created_by: userId,
        status: "active",
        student_id: input.student.id,
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    enrollmentByKey.set(key, created);
    result.enrollments += 1;
  }

  const paymentInputs = [
    {
      amount: 4999,
      course: stockCourse,
      method: "UPI",
      notes: `${demoNote} - completed payment for Stock Market Basics.`,
      student: nivi,
    },
    {
      amount: 7999,
      course: marketingCourse,
      method: "Bank",
      notes: `${demoNote} - completed payment for Digital Marketing Masterclass.`,
      student: kavin,
    },
  ];

  for (const payment of paymentInputs) {
    if (!payment.course || !payment.student) {
      continue;
    }

    const enrollmentId = enrollmentByKey.get(
      `${payment.student.id}:${payment.course.id}`,
    )?.id;
    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("student_id", payment.student.id)
      .eq("course_id", payment.course.id)
      .eq("notes", payment.notes)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      continue;
    }

    const { error } = await supabase.from("payments").insert({
      amount: payment.amount,
      course_id: payment.course.id,
      currency: "INR",
      enrollment_id: enrollmentId ?? null,
      notes: payment.notes,
      paid_at: addDays(-3),
      payment_method: payment.method,
      status: "completed",
      student_id: payment.student.id,
      tenant_id: tenantId,
    });

    if (error) {
      throw error;
    }

    result.payments += 1;
  }

  if (arjun && stockCourse) {
    const paymentLinkDescription =
      `${demoNote} - pending manual payment link for Stock Market Basics.`;
    const { data: existing, error: existingError } = await supabase
      .from("payment_links")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("student_id", arjun.id)
      .eq("description", paymentLinkDescription)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (!existing) {
      const enrollmentId = enrollmentByKey.get(`${arjun.id}:${stockCourse.id}`)
        ?.id;
      const { error } = await supabase.from("payment_links").insert({
        amount: 4999,
        course_id: stockCourse.id,
        created_by: userId,
        currency: "INR",
        description: paymentLinkDescription,
        enrollment_id: enrollmentId ?? null,
        expires_at: addDays(7),
        payment_url: "upi://pay?pa=YOUR_UPI_ID&pn=CoachFort&am=4999.00&cu=INR",
        provider: "manual",
        status: "sent",
        student_id: arjun.id,
        tenant_id: tenantId,
      });

      if (error) {
        throw error;
      }

      result.paymentLinks += 1;
    }
  }

  const cohortInputs = [
    {
      course: stockCourse,
      members: [nivi, arjun, meera],
      name: "Weekend Batch - Stock Market Basics",
    },
    {
      course: marketingCourse,
      members: [kavin, priya],
      name: "Evening Batch - Digital Marketing",
    },
  ];

  for (const cohort of cohortInputs) {
    if (!cohort.course) {
      continue;
    }

    const cohortDescription =
      `${demoNote} - sample cohort for demo scheduling and batch tracking.`;
    const { data: existing, error: existingError } = await supabase
      .from("cohorts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", cohort.name)
      .eq("description", cohortDescription)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    let cohortId = existing?.id;

    if (!cohortId) {
      const { data: created, error } = await supabase
        .from("cohorts")
        .insert({
          course_id: cohort.course.id,
          description: cohortDescription,
          end_date: toDateOnly(45),
          name: cohort.name,
          start_date: toDateOnly(5),
          tenant_id: tenantId,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      cohortId = created.id;
      result.cohorts += 1;
    }

    for (const member of cohort.members) {
      if (!member) {
        continue;
      }

      const { data: existingMember, error: memberLookupError } =
        await supabase
          .from("cohort_members")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("cohort_id", cohortId)
          .eq("student_id", member.id)
          .maybeSingle();

      if (memberLookupError) {
        throw memberLookupError;
      }

      if (existingMember) {
        continue;
      }

      const { error } = await supabase.from("cohort_members").insert({
        cohort_id: cohortId,
        student_id: member.id,
        tenant_id: tenantId,
      });

      if (error) {
        throw error;
      }
    }
  }

  const reminderInputs = [
    {
      course: stockCourse,
      description:
        `${demoNote} - remind Arjun to complete the pending sample payment link.`,
      due_at: addDays(1),
      reminder_type: "payment",
      student: arjun,
      title: "Follow up payment reminder",
    },
    {
      course: marketingCourse,
      description:
        `${demoNote} - check course progress and send a helpful follow-up.`,
      due_at: addDays(2),
      reminder_type: "course_followup",
      student: priya,
      title: "Course progress reminder",
    },
  ] as const;

  for (const reminder of reminderInputs) {
    const { data: existing, error: existingError } = await supabase
      .from("reminders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("title", reminder.title)
      .eq("description", reminder.description)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      continue;
    }

    const { error } = await supabase.from("reminders").insert({
      course_id: reminder.course?.id ?? null,
      description: reminder.description,
      due_at: reminder.due_at,
      payment_id: null,
      reminder_type: reminder.reminder_type,
      status: "pending",
      student_id: reminder.student?.id ?? null,
      tenant_id: tenantId,
      title: reminder.title,
    });

    if (error) {
      throw error;
    }

    result.reminders += 1;
  }

  const automationInputs = [
    {
      config: {
        due_offset_days: 1,
        reminder_description:
          "Demo record - remind the team to follow up after a payment event.",
        reminder_title: "Demo payment follow-up",
        reminder_type: "payment",
      } satisfies AutomationRuleConfig,
      name: "Payment follow-up reminder rule",
      trigger_type: "payment_created",
    },
    {
      config: {
        due_offset_days: 2,
        reminder_description:
          "Demo record - follow up with the learner after course completion.",
        reminder_title: "Demo course completion follow-up",
        reminder_type: "course_followup",
      } satisfies AutomationRuleConfig,
      name: "Course completion follow-up rule",
      trigger_type: "course_completed",
    },
  ] as const;

  for (const automation of automationInputs) {
    const { data: existing, error: existingError } = await supabase
      .from("automation_rules")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", automation.name)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      continue;
    }

    const { error } = await supabase.from("automation_rules").insert({
      action_type: "create_reminder",
      config: automation.config,
      is_active: true,
      name: automation.name,
      tenant_id: tenantId,
      trigger_type: automation.trigger_type,
    });

    if (error) {
      throw error;
    }

    result.automations += 1;
  }

  return result;
}
