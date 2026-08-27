"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { StatCard } from "@/src/components/ui/StatCard";
import {
  archiveCommunityPost,
  createTeamCommunityComment,
  createTeamCommunityPostV2,
  formatCommunityDate,
  getCommunityPostTypeLabel,
  getTeamCommunityCreateScopes,
  getTeamCommunityComments,
  getTeamCommunityPosts,
  hideCommunityComment,
  hideCommunityPost,
  publishCommunityPost,
  updateTeamCommunityPost,
  type CommunityPostStatus,
  type CommunityPostType,
  type CommunityCreateScope,
  type TeamCommunityComment,
  type TeamCommunityPost,
} from "@/src/lib/community";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type FilterStatus = CommunityPostStatus | "all";

type FormState = {
  body: string;
  postType: CommunityPostType;
  title: string;
};

const emptyForm: FormState = {
  body: "",
  postType: "discussion",
  title: "",
};

const statusFilters: Array<{ label: string; value: FilterStatus }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
  { label: "Hidden", value: "hidden" },
];

const postTypes: CommunityPostType[] = [
  "discussion",
  "question",
  "resource",
  "update",
];

function canCreateCommunity(role: MemberRole | null) {
  return role === "owner" || role === "admin" || role === "staff" || role === "trainer";
}

function canModerateCommunity(role: MemberRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

function getErrorMessage(_caught: unknown, fallback: string) {
  return fallback;
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
}

function postStatusTone(status: CommunityPostStatus) {
  if (status === "published") return "success" as const;
  if (status === "hidden") return "danger" as const;
  if (status === "archived") return "staff" as const;
  return "warning" as const;
}

function commentStatusTone(status: TeamCommunityComment["status"]) {
  return status === "hidden" ? "danger" : "success";
}

function getPostAuthorLabel(post: TeamCommunityPost) {
  if (post.author_type === "student") {
    return post.author_name || "Community member";
  }

  return post.author_name || "Coach team";
}

function getPostAuthorBadge(post: TeamCommunityPost) {
  return post.author_type === "student" ? "Student post" : "Team post";
}

export function CommunityPageClient() {
  const initialLoadStarted = useRef(false);
  const [actionError, setActionError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [comments, setComments] = useState<TeamCommunityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [createScopes, setCreateScopes] = useState<CommunityCreateScope[]>([]);
  const [editing, setEditing] = useState<TeamCommunityPost | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [posts, setPosts] = useState<TeamCommunityPost[]>([]);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [selectedCreateScopeKey, setSelectedCreateScopeKey] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const canAccess = canCreateCommunity(role);
  const canCreate = canAccess && createScopes.length > 0;
  const canModerate = canModerateCommunity(role);
  const selectedPost = posts.find((post) => post.id === selectedPostId) ?? null;
  const filteredPosts = useMemo(
    () => posts.filter((post) => filter === "all" || post.status === filter),
    [filter, posts],
  );
  const stats = useMemo(
    () => ({
      archived: posts.filter((item) => item.status === "archived").length,
      draft: posts.filter((item) => item.status === "draft").length,
      hidden: posts.filter((item) => item.status === "hidden").length,
      published: posts.filter((item) => item.status === "published").length,
      total: posts.length,
    }),
    [posts],
  );

  const loadComments = useCallback(async (postId: string | null) => {
    if (!postId) {
      setComments([]);
      return;
    }

    setCommentsLoading(true);

    try {
      const nextComments = await getTeamCommunityComments(postId);
      setComments(nextComments);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load community comments."));
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    setActionError("");
    setLoading(true);

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setTenant(null);
        setPosts([]);
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error("You must be logged in to manage community posts.");
      }

      const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);

      setTenant(currentTenant);
      setRole(currentRole);

      if (!canCreateCommunity(currentRole)) {
        setPosts([]);
        setCreateScopes([]);
        return;
      }

      const [nextPosts, nextCreateScopes] = await Promise.all([
        getTeamCommunityPosts(currentTenant.id),
        getTeamCommunityCreateScopes({
          role: currentRole as MemberRole,
          tenantId: currentTenant.id,
        }),
      ]);
      setPosts(nextPosts);
      setCreateScopes(nextCreateScopes);
      setSelectedCreateScopeKey(
        nextCreateScopes.length === 1 ? nextCreateScopes[0].key : "",
      );

      const nextSelectedPostId =
        selectedPostId && nextPosts.some((post) => post.id === selectedPostId)
          ? selectedPostId
          : nextPosts[0]?.id ?? null;

      setSelectedPostId(nextSelectedPostId);
      await loadComments(nextSelectedPostId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load community posts."));
    } finally {
      setLoading(false);
    }
  }, [loadComments, selectedPostId]);

  useEffect(() => {
    if (initialLoadStarted.current) {
      return;
    }

    initialLoadStarted.current = true;
    void loadPosts();
  }, [loadPosts]);

  function openCreateForm() {
    setActionError("");
    setSuccess("");
    setEditing(null);
    setForm(emptyForm);
    setSelectedCreateScopeKey(createScopes.length === 1 ? createScopes[0].key : "");
    setFormOpen(true);
  }

  function openEditForm(post: TeamCommunityPost) {
    if (post.author_type === "student") {
      setActionError("Student-authored posts can be moderated but not edited by the team.");
      return;
    }

    setActionError("");
    setSuccess("");
    setEditing(post);
    setForm({
      body: post.body,
      postType: post.post_type,
      title: post.title,
    });
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setActionError("Workspace context is not available.");
      return;
    }

    if (!isPlainText(form.title) || !isPlainText(form.body)) {
      setActionError("Community posts must use plain text without HTML.");
      return;
    }

    const selectedCreateScope = editing
      ? null
      : createScopes.find((scope) => scope.key === selectedCreateScopeKey) ?? null;

    if (!editing && !selectedCreateScope) {
      setActionError("Choose a Program or Cohort Community space.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("save-post");

    try {
      const savedPost = editing
        ? await updateTeamCommunityPost(
            editing.id,
            form.title,
            form.body,
            form.postType,
          )
        : selectedCreateScope
          ? await createTeamCommunityPostV2(
              tenant.id,
              selectedCreateScope.courseId,
              selectedCreateScope.cohortId,
              form.title,
              form.body,
              form.postType,
            )
          : null;

      if (!savedPost) {
        setActionError("Choose a Program or Cohort Community space.");
        return;
      }

      setSuccess(editing ? "Community post updated." : "Draft community post created.");
      setForm(emptyForm);
      setEditing(null);
      setFormOpen(false);
      setSelectedPostId(savedPost.id);
      await loadPosts();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save community post."));
    } finally {
      setMutating("");
    }
  }

  async function handlePostAction(
    postId: string,
    action: "archive" | "hide" | "publish",
  ) {
    const labels = {
      archive: "archive",
      hide: "hide",
      publish: "publish",
    };

    setActionError("");
    setSuccess("");
    setMutating(`${action}-${postId}`);

    try {
      if (action === "publish") {
        await publishCommunityPost(postId);
        setSuccess("Community post published.");
      } else if (action === "archive") {
        await archiveCommunityPost(postId);
        setSuccess("Community post archived.");
      } else {
        await hideCommunityPost(postId);
        setSuccess("Community post hidden.");
      }

      await loadPosts();
    } catch (caught) {
      setActionError(
        getErrorMessage(caught, `Unable to ${labels[action]} community post.`),
      );
    } finally {
      setMutating("");
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPost) {
      setActionError("Select a community post first.");
      return;
    }

    if (!isPlainText(commentBody)) {
      setActionError("Community comments must use plain text without HTML.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("save-comment");

    try {
      await createTeamCommunityComment(selectedPost.id, commentBody);
      setCommentBody("");
      setSuccess("Comment added.");
      await loadComments(selectedPost.id);
      await loadPosts();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add comment."));
    } finally {
      setMutating("");
    }
  }

  async function handleHideComment(commentId: string) {
    if (!selectedPost) {
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating(`hide-comment-${commentId}`);

    try {
      await hideCommunityComment(commentId);
      setSuccess("Comment hidden.");
      await loadComments(selectedPost.id);
      await loadPosts();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to hide comment."));
    } finally {
      setMutating("");
    }
  }

  function handleSelectPost(postId: string) {
    setSelectedPostId(postId);
    void loadComments(postId);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            <Button onClick={loadPosts} type="button" variant="secondary">
              Refresh
            </Button>
            {canCreate ? (
              <Button onClick={openCreateForm} type="button">
                New community post
              </Button>
            ) : null}
          </>
        }
        description="Moderate a private coaching community where students can start discussions and comment under published posts."
        eyebrow="Student communication"
        metadata={
          <>
            <Badge tone="info">Program and Cohort spaces</Badge>
            <Badge tone="outline">No attachments or reactions</Badge>
          </>
        }
        title="Community"
      />

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      {!loading && !canAccess ? (
        <FeedbackAlert tone="warning">
          Owner, admin, staff, or trainer access is required to manage community
          posts. Moderation is enforced again by the server.
        </FeedbackAlert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Draft" value={stats.draft} />
        <StatCard label="Published" value={stats.published} />
        <StatCard label="Archived" value={stats.archived} />
        <StatCard label="Hidden" value={stats.hidden} />
      </section>

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            description="Review team updates and student discussions. Student-authored posts can be hidden or archived by moderators."
            title="Community board"
          />
          <select
            className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
            onChange={(event) => setFilter(event.target.value as FilterStatus)}
            value={filter}
          >
            {statusFilters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <Card className="h-64 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading community posts</span>
        </Card>
      ) : filteredPosts.length === 0 ? (
        <EmptyState
          action={
            canCreate
              ? {
                  label: "Create draft post",
                  onClick: openCreateForm,
                }
              : undefined
          }
          description="No community posts match the selected view."
          icon="CM"
          title="No community posts yet"
        />
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="space-y-4">
            {filteredPosts.map((post) => (
              <Card
                className={[
                  "border-[#D8E8F0] bg-white p-6 transition",
                  selectedPostId === post.id
                    ? "ring-2 ring-[#2ECBEA]/35"
                    : "hover:border-[#9ADDEA]",
                ].join(" ")}
                key={post.id}
              >
                <button
                  className="block w-full text-left"
                  onClick={() => handleSelectPost(post.id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={postStatusTone(post.status)}>{post.status}</Badge>
                    <Badge tone="light">
                      {getCommunityPostTypeLabel(post.post_type)}
                    </Badge>
                    <Badge tone={post.author_type === "student" ? "premium" : "info"}>
                      {getPostAuthorBadge(post)}
                    </Badge>
                    <Badge tone="outline">{post.comment_count} comments</Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <div
                      className={[
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        post.author_type === "student"
                          ? "bg-[#EAF8FC] text-[#0B2A3D]"
                          : "bg-[#0B1F33] text-white",
                      ].join(" ")}
                    >
                      {getPostAuthorLabel(post).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0B1F33]">
                        {getPostAuthorLabel(post)}
                      </p>
                      <p className="text-xs font-medium text-[#64748B]">
                        {post.author_type === "student"
                          ? "Community member discussion"
                          : "Coach-team post"}
                      </p>
                    </div>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
                    {post.title}
                  </h2>
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                    {post.body}
                  </p>
                  <div className="mt-5 grid gap-3 border-t border-[#D8E8F0] pt-4 text-xs font-medium text-[#64748B] sm:grid-cols-2">
                    <p>Created {formatCommunityDate(post.created_at)}</p>
                    <p>Published {formatCommunityDate(post.published_at)}</p>
                  </div>
                </button>
                <div className="mt-5 flex flex-wrap gap-3">
                  {post.author_type === "team" &&
                  post.status !== "archived" &&
                  post.status !== "hidden" ? (
                    <Button
                      onClick={() => openEditForm(post)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  ) : null}
                  {post.status === "draft" && canModerate ? (
                    <Button
                      disabled={mutating === `publish-${post.id}`}
                      onClick={() => handlePostAction(post.id, "publish")}
                      size="sm"
                      type="button"
                    >
                      {mutating === `publish-${post.id}` ? "Publishing..." : "Publish"}
                    </Button>
                  ) : null}
                  {post.status !== "archived" && canModerate ? (
                    <Button
                      disabled={mutating === `archive-${post.id}`}
                      onClick={() => handlePostAction(post.id, "archive")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {mutating === `archive-${post.id}` ? "Archiving..." : "Archive"}
                    </Button>
                  ) : null}
                  {post.status !== "hidden" && canModerate ? (
                    <Button
                      disabled={mutating === `hide-${post.id}`}
                      onClick={() => handlePostAction(post.id, "hide")}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      {mutating === `hide-${post.id}` ? "Hiding..." : "Hide"}
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>

          <Card className="border-[#D8E8F0] bg-white p-6">
            <SectionHeader
              description={
                selectedPost
                  ? "Review student and coach-team comments for the selected post."
                  : "Select a post to review its comments."
              }
              title="Comments"
            />
            {selectedPost ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={selectedPost.author_type === "student" ? "premium" : "info"}>
                      {getPostAuthorBadge(selectedPost)}
                    </Badge>
                    <span className="text-xs font-semibold text-[#64748B]">
                      {getPostAuthorLabel(selectedPost)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[#0B1F33]">
                    {selectedPost.title}
                  </p>
                  <p className="mt-1 text-xs font-medium text-[#64748B]">
                    {selectedPost.comment_count} visible or moderated comments
                  </p>
                </div>
                {canCreate && selectedPost.status !== "archived" && selectedPost.status !== "hidden" ? (
                  <form className="space-y-3" onSubmit={handleCommentSubmit}>
                    <FormField
                      description="Reply as the coach team. Plain text only."
                      label="Team comment"
                    >
                      <textarea
                        className="min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                        maxLength={3000}
                        onChange={(event) => setCommentBody(event.target.value)}
                        placeholder="Write a team reply for this discussion."
                        value={commentBody}
                      />
                    </FormField>
                    <Button
                      disabled={mutating === "save-comment" || !commentBody.trim()}
                      size="sm"
                      type="submit"
                    >
                      {mutating === "save-comment" ? "Adding..." : "Add comment"}
                    </Button>
                  </form>
                ) : null}
                {commentsLoading ? (
                  <div className="h-32 animate-pulse rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE]" />
                ) : comments.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                    No comments yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                        key={comment.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={comment.author_type === "team" ? "info" : "light"}
                          >
                            {comment.author_name}
                          </Badge>
                          <Badge tone={commentStatusTone(comment.status)}>
                            {comment.status}
                          </Badge>
                          <span className="text-xs font-medium text-[#64748B]">
                            {formatCommunityDate(comment.created_at)}
                          </span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                          {comment.body}
                        </p>
                        {comment.status !== "hidden" && canModerate ? (
                          <Button
                            className="mt-4"
                            disabled={mutating === `hide-comment-${comment.id}`}
                            onClick={() => handleHideComment(comment.id)}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            {mutating === `hide-comment-${comment.id}`
                              ? "Hiding..."
                              : "Hide comment"}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-4 text-sm text-[#425B76]">
                Select a community post to review comments.
              </p>
            )}
          </Card>
        </section>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex min-h-full items-end justify-center overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge tone="info">
                  {editing ? "Edit community post" : "Draft community post"}
                </Badge>
                <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                  {editing ? "Update post" : "Create post"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#425B76]">
                  Team posts stay private until an owner, admin, or staff user
                  publishes them. Student posts are moderated from the board.
                </p>
              </div>
              <Button
                onClick={() => setFormOpen(false)}
                type="button"
                variant="secondary"
              >
                Close
              </Button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {!editing ? (
                <FormField
                  description="Choose the exact Program or Cohort where this post belongs."
                  htmlFor="coach-community-space"
                  label="Community space"
                  required
                >
                  <select
                    className="h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    id="coach-community-space"
                    onChange={(event) => setSelectedCreateScopeKey(event.target.value)}
                    required
                    value={selectedCreateScopeKey}
                  >
                    <option value="">Choose a Community space</option>
                    {createScopes.map((scope) => (
                      <option key={scope.key} value={scope.key}>
                        {scope.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              <FormField
                description="Keep titles short and student-facing."
                label="Title"
                required
              >
                <input
                  className="h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={180}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Example: Share your weekly practice wins"
                  required
                  value={form.title}
                />
              </FormField>
              <FormField
                description="Choose the discussion type students will see."
                label="Post type"
              >
                <select
                  className="h-12 w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      postType: event.target.value as CommunityPostType,
                    }))
                  }
                  value={form.postType}
                >
                  {postTypes.map((postType) => (
                    <option key={postType} value={postType}>
                      {getCommunityPostTypeLabel(postType)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                description="Plain text only. Attachments, reactions, and rich text are outside this MVP."
                label="Body"
                required
              >
                <textarea
                  className="min-h-40 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                  maxLength={6000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  placeholder="Write the community post in plain text."
                  required
                  value={form.body}
                />
              </FormField>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => setFormOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating === "save-post"} type="submit">
                  {mutating === "save-post"
                    ? "Saving..."
                    : editing
                      ? "Save changes"
                      : "Create draft"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
