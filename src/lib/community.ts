import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type CommunityPostStatus = "archived" | "draft" | "hidden" | "published";
export type CommunityPostType = "discussion" | "question" | "resource" | "update";
export type CommunityAuthorType = "student" | "team";
export type CommunityCommentStatus = "hidden" | "published";

export type StudentCommunityPost = {
  author_name: string;
  author_type: CommunityAuthorType;
  body: string;
  comment_count: number;
  created_at: string;
  id: string;
  post_type: CommunityPostType;
  published_at: string | null;
  tenant_id: string;
  title: string;
  updated_at: string;
};

export type StudentCommunityComment = {
  author_name: string;
  author_type: CommunityAuthorType;
  body: string;
  created_at: string;
  id: string;
  post_id: string;
  updated_at: string;
};

export type TeamCommunityPost = StudentCommunityPost & {
  archived_at: string | null;
  audience_type: "all_students";
  created_by_student_id: string | null;
  created_by_user_id: string | null;
  hidden_by_user_id: string | null;
  hidden_at: string | null;
  status: CommunityPostStatus;
};

export type TeamCommunityComment = StudentCommunityComment & {
  hidden_at: string | null;
  status: CommunityCommentStatus;
  tenant_id: string;
};

type CommunityPostRow = Partial<StudentCommunityPost & TeamCommunityPost>;
type CommunityCommentRow = Partial<StudentCommunityComment & TeamCommunityComment>;

function assertRpcSuccess(error: unknown) {
  if (error) {
    throw error;
  }
}

function normalizeCommentCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeStudentPost(row: CommunityPostRow): StudentCommunityPost {
  return {
    author_name: String(
      row.author_name ?? (row.author_type === "student" ? "Student" : "Coach team"),
    ),
    author_type: (row.author_type ?? "team") as CommunityAuthorType,
    body: String(row.body ?? ""),
    comment_count: normalizeCommentCount(row.comment_count),
    created_at: String(row.created_at ?? ""),
    id: String(row.id ?? ""),
    post_type: (row.post_type ?? "discussion") as CommunityPostType,
    published_at: row.published_at ?? null,
    tenant_id: String(row.tenant_id ?? ""),
    title: String(row.title ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function normalizeTeamPost(row: CommunityPostRow): TeamCommunityPost {
  const studentPost = normalizeStudentPost(row);

  return {
    ...studentPost,
    archived_at: row.archived_at ?? null,
    audience_type: "all_students",
    created_by_student_id: row.created_by_student_id
      ? String(row.created_by_student_id)
      : null,
    created_by_user_id: row.created_by_user_id ? String(row.created_by_user_id) : null,
    hidden_by_user_id: row.hidden_by_user_id ? String(row.hidden_by_user_id) : null,
    hidden_at: row.hidden_at ?? null,
    status: (row.status ?? "draft") as CommunityPostStatus,
  };
}

function normalizeStudentComment(row: CommunityCommentRow): StudentCommunityComment {
  return {
    author_name: String(row.author_name ?? "Academy"),
    author_type: (row.author_type ?? "team") as CommunityAuthorType,
    body: String(row.body ?? ""),
    created_at: String(row.created_at ?? ""),
    id: String(row.id ?? ""),
    post_id: String(row.post_id ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function normalizeTeamComment(row: CommunityCommentRow): TeamCommunityComment {
  const studentComment = normalizeStudentComment(row);

  return {
    ...studentComment,
    hidden_at: row.hidden_at ?? null,
    status: (row.status ?? "published") as CommunityCommentStatus,
    tenant_id: String(row.tenant_id ?? ""),
  };
}

function normalizeList<T>(
  data: unknown,
  normalizer: (row: Record<string, unknown>) => T,
) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((row) => normalizer(row as Record<string, unknown>));
}

function normalizeMutationPost(data: unknown) {
  if (Array.isArray(data)) {
    return normalizeTeamPost((data[0] ?? {}) as CommunityPostRow);
  }

  return normalizeTeamPost((data ?? {}) as CommunityPostRow);
}

function normalizeStudentMutationPost(data: unknown) {
  if (Array.isArray(data)) {
    return normalizeStudentPost((data[0] ?? {}) as CommunityPostRow);
  }

  return normalizeStudentPost((data ?? {}) as CommunityPostRow);
}

export function formatCommunityDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function getCommunityPostTypeLabel(postType: CommunityPostType) {
  const labels: Record<CommunityPostType, string> = {
    discussion: "Discussion",
    question: "Question",
    resource: "Resource",
    update: "Update",
  };

  return labels[postType];
}

export async function getStudentCommunityPosts() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_community_posts");

  assertRpcSuccess(error);

  return normalizeList(data, normalizeStudentPost);
}

export async function getStudentCommunityComments(postId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_community_comments", {
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return normalizeList(data, normalizeStudentComment);
}

export async function createStudentCommunityComment(postId: string, body: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_student_community_comment", {
    p_body: body,
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return String(data ?? "");
}

export async function createStudentCommunityPost(
  tenantId: string,
  title: string,
  body: string,
  postType: CommunityPostType = "discussion",
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_student_community_post", {
    p_body: body,
    p_post_type: postType,
    p_tenant_id: tenantId,
    p_title: title,
  });

  assertRpcSuccess(error);

  return normalizeStudentMutationPost(data);
}

export async function getTeamCommunityPosts(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_community_posts", {
    p_tenant_id: tenantId,
  });

  assertRpcSuccess(error);

  return normalizeList(data, normalizeTeamPost);
}

export async function getTeamCommunityComments(postId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_community_comments", {
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return normalizeList(data, normalizeTeamComment);
}

export async function createTeamCommunityPost(
  tenantId: string,
  title: string,
  body: string,
  postType: CommunityPostType = "discussion",
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_team_community_post", {
    p_body: body,
    p_post_type: postType,
    p_tenant_id: tenantId,
    p_title: title,
  });

  assertRpcSuccess(error);

  return normalizeMutationPost(data);
}

export async function updateTeamCommunityPost(
  postId: string,
  title: string,
  body: string,
  postType: CommunityPostType = "discussion",
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_team_community_post", {
    p_body: body,
    p_post_id: postId,
    p_post_type: postType,
    p_title: title,
  });

  assertRpcSuccess(error);

  return normalizeMutationPost(data);
}

export async function publishCommunityPost(postId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("publish_community_post", {
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return normalizeMutationPost(data);
}

export async function archiveCommunityPost(postId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_community_post", {
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return normalizeMutationPost(data);
}

export async function hideCommunityPost(postId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("hide_community_post", {
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return normalizeMutationPost(data);
}

export async function createTeamCommunityComment(postId: string, body: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_team_community_comment", {
    p_body: body,
    p_post_id: postId,
  });

  assertRpcSuccess(error);

  return String(data ?? "");
}

export async function hideCommunityComment(commentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("hide_community_comment", {
    p_comment_id: commentId,
  });

  assertRpcSuccess(error);

  return String(data ?? "");
}
