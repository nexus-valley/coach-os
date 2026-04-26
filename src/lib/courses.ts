import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CourseStatus = "draft" | "published" | "archived";

export type Course = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  description: string | null;
  status: CourseStatus;
  thumbnail_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateCourseInput = {
  description: string;
  status: Exclude<CourseStatus, "archived">;
  tenantId: string;
  title: string;
};

function createSlug(title: string) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 64) || "course"
  );
}

export async function getCoursesForTenant(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Course[];
}

export async function createCourse(input: CreateCourseInput) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to create a course.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Course title is required.");
  }

  const { data, error } = await supabase
    .from("courses")
    .insert({
      created_by: user.id,
      description: input.description.trim() || null,
      slug: createSlug(title),
      status: input.status,
      tenant_id: input.tenantId,
      title,
    })
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as Course;
}

export async function getCourseById(params: {
  courseId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.courseId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Course | null) ?? null;
}
