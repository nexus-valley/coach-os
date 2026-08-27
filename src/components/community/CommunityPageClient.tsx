"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { CommunityDialog } from "@/src/components/community/CommunityDialog";
import { CommunityPostCard } from "@/src/components/community/CommunityPostCard";
import { CommunitySpaceSelector } from "@/src/components/community/CommunitySpaceSelector";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import {
  appendUniqueCommunityItems,
  archiveCommunityPost,
  communityPageSize,
  createTeamCommunityComment,
  createTeamCommunityPostV2,
  executeCommunityMutation,
  formatCommunityDate,
  getCommunityPostTypeLabel,
  getTeamCommunityCommentsV2,
  getTeamCommunityCreateScopes,
  getTeamCommunityPostsV2,
  hideCommunityComment,
  hideCommunityPost,
  publishCommunityPost,
  updateTeamCommunityPost,
  type CommunityCreateScope,
  type CommunityPostStatus,
  type CommunityPostType,
  type TeamCommunityComment,
  type TeamCommunityPost,
} from "@/src/lib/community";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type FilterStatus = CommunityPostStatus | "all";
type PostAction = "archive" | "hide" | "publish";
type Confirmation =
  | { action: PostAction; kind: "post"; post: TeamCommunityPost }
  | { comment: TeamCommunityComment; kind: "comment" };

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
const refreshFailureMessage =
  "The Community action succeeded, but the latest view could not be refreshed. Refresh the page to see the current state.";
const statusFilters: Array<{ label: string; value: FilterStatus }> = [
  { label: "All states", value: "all" },
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

function canAccessCommunity(role: MemberRole | null) {
  return role === "owner" || role === "admin" || role === "staff" || role === "trainer";
}

function canModerateCommunity(role: MemberRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
}

function getCommunityErrorMessage(
  caught: unknown,
  fallback = "Unable to complete the Community action.",
) {
  const candidate = caught as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";

  if (code === "42501" || /permission|not authorized|scope access/.test(message)) {
    return "Your Community access or scope changed. Refresh and try again.";
  }
  if (/not found|unavailable/.test(message)) {
    return "This Community item is no longer available.";
  }
  if (/plain text|required|title|body/.test(message)) {
    return "Enter a plain-text title and message before saving.";
  }

  return fallback;
}

function confirmationCopy(confirmation: Confirmation) {
  if (confirmation.kind === "comment") {
    return {
      confirm: "Hide comment",
      description:
        "This removes the comment from the Student view while retaining the moderation record.",
      title: "Hide this comment?",
    };
  }

  if (confirmation.action === "publish") {
    return {
      confirm: "Publish post",
      description:
        "The Draft becomes visible to Students who can access this exact Community space.",
      title: "Publish this Community post?",
    };
  }

  if (confirmation.action === "archive") {
    return {
      confirm: "Archive post",
      description:
        "The post leaves the Student feed and remains available to the Coach team as history.",
      title: "Archive this Community post?",
    };
  }

  return {
    confirm: "Hide post",
    description:
      "The post is removed from the Student feed and retained for moderation review.",
    title: "Hide this Community post?",
  };
}

export function CommunityPageClient() {
  const successRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [comments, setComments] = useState<TeamCommunityComment[]>([]);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [editing, setEditing] = useState<TeamCommunityPost | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutating, setMutating] = useState("");
  const [posts, setPosts] = useState<TeamCommunityPost[]>([]);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState("");
  const [role, setRole] = useState<MemberRole | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");
  const [spaces, setSpaces] = useState<CommunityCreateScope[]>([]);
  const [success, setSuccess] = useState("");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.key === selectedSpaceKey) ?? null,
    [selectedSpaceKey, spaces],
  );
  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? null,
    [posts, selectedPostId],
  );
  const canAccess = canAccessCommunity(role);
  const canCreate = canAccess && Boolean(selectedSpace?.canWrite);
  const canModerate = canModerateCommunity(role);

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      setWorkspaceLoading(true);
      setActionError("");

      try {
        const currentTenant = await getCurrentTenant();

        if (!currentTenant) {
          if (active) setTenant(null);
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error) throw error;
        if (!user) throw new Error("Authentication required.");

        const currentRole = await getCurrentMemberRole(currentTenant.id, user.id);
        const nextSpaces = canAccessCommunity(currentRole)
          ? await getTeamCommunityCreateScopes({
              role: currentRole as MemberRole,
              tenantId: currentTenant.id,
            })
          : [];

        if (!active) return;
        setTenant(currentTenant);
        setRole(currentRole);
        setSpaces(nextSpaces);
        setSelectedSpaceKey(nextSpaces.length === 1 ? nextSpaces[0].key : "");
      } catch (caught) {
        if (active) {
          setActionError(
            getCommunityErrorMessage(caught, "Unable to load Community access."),
          );
        }
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      if (!tenant || !selectedSpace) {
        setPosts([]);
        setSelectedPostId(null);
        setFeedLoading(false);
        return;
      }

      setFeedLoading(true);
      setActionError("");

      try {
        const nextPosts = await getTeamCommunityPostsV2({
          scope: selectedSpace,
          status: filter === "all" ? null : filter,
          tenantId: tenant.id,
        });

        if (!active) return;
        setPosts(nextPosts);
        setPostsHasMore(nextPosts.length === communityPageSize);
        setSelectedPostId((current) =>
          current && nextPosts.some((post) => post.id === current)
            ? current
            : nextPosts[0]?.id ?? null,
        );
      } catch (caught) {
        if (active) {
          setActionError(
            getCommunityErrorMessage(caught, "Unable to load Community posts."),
          );
        }
      } finally {
        if (active) setFeedLoading(false);
      }
    }

    void loadFeed();
    return () => {
      active = false;
    };
  }, [filter, selectedSpace, tenant]);

  useEffect(() => {
    let active = true;

    async function loadComments() {
      if (!selectedPostId) {
        setComments([]);
        setCommentsHasMore(false);
        return;
      }

      setCommentsLoading(true);

      try {
        const nextComments = await getTeamCommunityCommentsV2({
          postId: selectedPostId,
        });
        if (!active) return;
        setComments(nextComments);
        setCommentsHasMore(nextComments.length === communityPageSize);
      } catch (caught) {
        if (active) {
          setActionError(
            getCommunityErrorMessage(caught, "Unable to load Community comments."),
          );
        }
      } finally {
        if (active) setCommentsLoading(false);
      }
    }

    void loadComments();
    return () => {
      active = false;
    };
  }, [selectedPostId]);

  async function refreshPosts(
    preferredPostId?: string | null,
    statusOverride?: CommunityPostStatus | "all",
  ) {
    if (!tenant || !selectedSpace) return false;
    const nextStatus = statusOverride ?? filter;
    const nextPosts = await getTeamCommunityPostsV2({
      scope: selectedSpace,
      status: nextStatus === "all" ? null : nextStatus,
      tenantId: tenant.id,
    });
    setPosts(nextPosts);
    setPostsHasMore(nextPosts.length === communityPageSize);
    setSelectedPostId(
      preferredPostId && nextPosts.some((post) => post.id === preferredPostId)
        ? preferredPostId
        : nextPosts[0]?.id ?? null,
    );
    return true;
  }

  async function refreshComments(postId: string) {
    const nextComments = await getTeamCommunityCommentsV2({ postId });
    setComments(nextComments);
    setCommentsHasMore(nextComments.length === communityPageSize);
    return true;
  }

  async function loadMorePosts() {
    if (!tenant || !selectedSpace || loadingMore || posts.length === 0) return;
    const last = posts[posts.length - 1];
    setLoadingMore(true);

    try {
      const nextPosts = await getTeamCommunityPostsV2({
        cursor: { id: last.id, timestamp: last.updated_at },
        scope: selectedSpace,
        status: filter === "all" ? null : filter,
        tenantId: tenant.id,
      });
      setPosts((current) => appendUniqueCommunityItems(current, nextPosts));
      setPostsHasMore(nextPosts.length === communityPageSize);
    } catch (caught) {
      setActionError(
        getCommunityErrorMessage(caught, "Unable to load more Community posts."),
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreComments() {
    if (!selectedPost || commentsLoadingMore || comments.length === 0) return;
    const last = comments[comments.length - 1];
    setCommentsLoadingMore(true);

    try {
      const nextComments = await getTeamCommunityCommentsV2({
        cursor: { id: last.id, timestamp: last.created_at },
        postId: selectedPost.id,
      });
      setComments((current) => appendUniqueCommunityItems(current, nextComments));
      setCommentsHasMore(nextComments.length === communityPageSize);
    } catch (caught) {
      setActionError(
        getCommunityErrorMessage(caught, "Unable to load more Community comments."),
      );
    } finally {
      setCommentsLoadingMore(false);
    }
  }

  function openCreateForm() {
    if (!selectedSpace) return;
    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(post: TeamCommunityPost) {
    if (post.author_type !== "team") {
      setActionError("Student-authored posts can be moderated but not edited by the Coach team.");
      return;
    }

    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setEditing(post);
    setForm({ body: post.body, postType: post.post_type, title: post.title });
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutating || !tenant || !selectedSpace) return;

    const title = form.title.trim();
    const body = form.body.trim();

    if (!title || !body || !isPlainText(title) || !isPlainText(body)) {
      setActionError("Enter a plain-text title and message before saving.");
      return;
    }

    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setMutating("save-post");
    let savedId = editing?.id ?? null;

    const outcome = await executeCommunityMutation({
      mutate: async () => {
        const saved = editing
          ? await updateTeamCommunityPost(editing.id, title, body, form.postType)
          : await createTeamCommunityPostV2(
              tenant.id,
              selectedSpace.courseId,
              selectedSpace.cohortId,
              title,
              body,
              form.postType,
            );
        savedId = saved.id;
      },
      onMutationSuccess: () => {
        setForm(emptyForm);
        setEditing(null);
        setFormOpen(false);
        if (!editing) setFilter("draft");
        setSuccess(editing ? "Community post updated." : "Draft Community post created.");
      },
      refresh: () => refreshPosts(savedId, editing ? undefined : "draft"),
    });

    if (!outcome.mutationSucceeded) {
      setActionError(
        getCommunityErrorMessage(outcome.mutationError, "Unable to save the Community post."),
      );
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating("");
  }

  async function handleConfirm() {
    if (!confirmation || mutating) return;
    const current = confirmation;
    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setMutating(
      current.kind === "comment"
        ? `hide-comment-${current.comment.id}`
        : `${current.action}-${current.post.id}`,
    );

    const outcome = await executeCommunityMutation({
      mutate: async () => {
        if (current.kind === "comment") {
          await hideCommunityComment(current.comment.id);
        } else if (current.action === "publish") {
          await publishCommunityPost(current.post.id);
        } else if (current.action === "archive") {
          await archiveCommunityPost(current.post.id);
        } else {
          await hideCommunityPost(current.post.id);
        }
      },
      onMutationSuccess: () => {
        setConfirmation(null);
        setSuccess(
          current.kind === "comment"
            ? "Community comment hidden."
            : current.action === "publish"
              ? "Community post published."
              : current.action === "archive"
                ? "Community post archived."
                : "Community post hidden.",
        );
      },
      refresh: async () => {
        if (current.kind === "comment") {
          await Promise.all([
            refreshComments(current.comment.post_id),
            refreshPosts(selectedPostId),
          ]);
          return true;
        }
        return refreshPosts(current.post.id);
      },
    });

    if (!outcome.mutationSucceeded) {
      setActionError(
        getCommunityErrorMessage(outcome.mutationError, "Unable to update the Community item."),
      );
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating("");
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPost || mutating) return;
    const body = commentBody.trim();

    if (!body || !isPlainText(body)) {
      setActionError("Enter a plain-text comment before posting.");
      return;
    }

    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setMutating("save-comment");

    const outcome = await executeCommunityMutation({
      mutate: () => createTeamCommunityComment(selectedPost.id, body),
      onMutationSuccess: () => {
        setCommentBody("");
        setSuccess("Community comment added.");
      },
      refresh: async () => {
        await Promise.all([
          refreshComments(selectedPost.id),
          refreshPosts(selectedPost.id),
        ]);
        return true;
      },
    });

    if (!outcome.mutationSucceeded) {
      setActionError(
        getCommunityErrorMessage(outcome.mutationError, "Unable to add the Community comment."),
      );
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating("");
  }

  function postActions(post: TeamCommunityPost) {
    const canEdit =
      post.author_type === "team" &&
      post.status !== "archived" &&
      post.status !== "hidden";
    const hasModeration = canModerate;

    if (!canEdit && !hasModeration) return null;

    return (
      <details className="relative text-sm">
        <summary className="cursor-pointer list-none rounded-lg px-3 py-2 font-semibold text-[#0B2A3D] hover:bg-[#EAF7FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2ECBEA]">
          Post actions
        </summary>
        <div className="mt-2 flex flex-wrap justify-end gap-2" role="group" aria-label={`Actions for ${post.title}`}>
          {canEdit ? (
            <Button onClick={() => openEditForm(post)} size="sm" type="button" variant="secondary">
              Edit
            </Button>
          ) : null}
          {post.status === "draft" && canModerate ? (
            <Button
              onClick={() => setConfirmation({ action: "publish", kind: "post", post })}
              size="sm"
              type="button"
            >
              Publish
            </Button>
          ) : null}
          {post.status !== "archived" && canModerate ? (
            <Button
              onClick={() => setConfirmation({ action: "archive", kind: "post", post })}
              size="sm"
              type="button"
              variant="outline"
            >
              Archive
            </Button>
          ) : null}
          {post.status !== "hidden" && canModerate ? (
            <Button
              onClick={() => setConfirmation({ action: "hide", kind: "post", post })}
              size="sm"
              type="button"
              variant="destructive"
            >
              Hide
            </Button>
          ) : null}
        </div>
      </details>
    );
  }

  const confirmationDetails = confirmation ? confirmationCopy(confirmation) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            <Button
              disabled={!selectedSpace || feedLoading}
              onClick={() => void refreshPosts(selectedPostId)}
              type="button"
              variant="secondary"
            >
              Refresh
            </Button>
            {canCreate ? (
              <Button onClick={openCreateForm} type="button">
                Create post
              </Button>
            ) : null}
          </>
        }
        description="Run focused Program and Cohort discussions with Students from one operational view."
        eyebrow="Coaching Community"
        metadata={
          <>
            <Badge tone="info">Program and Cohort spaces</Badge>
            <Badge tone="outline">Draft, publish, moderate</Badge>
          </>
        }
        title="Community"
      />

      <div aria-live="polite" className="space-y-3">
        {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
        {success ? (
          <div ref={successRef} tabIndex={-1}>
            <FeedbackAlert tone="success">{success}</FeedbackAlert>
          </div>
        ) : null}
        {refreshWarning ? <FeedbackAlert tone="warning">{refreshWarning}</FeedbackAlert> : null}
      </div>

      <CommunitySpaceSelector
        id="coach-community-space"
        onChange={(key) => {
          setSelectedSpaceKey(key);
          setSelectedPostId(null);
          setPosts([]);
        }}
        selectedKey={selectedSpaceKey}
        spaces={spaces}
      />

      {!workspaceLoading && !canAccess ? (
        <FeedbackAlert tone="warning">
          Community is not available for your current Workspace role.
        </FeedbackAlert>
      ) : null}

      {workspaceLoading ? (
        <div aria-label="Loading Community" className="space-y-4">
          <Skeleton className="h-24" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : !selectedSpace ? (
        <EmptyState
          description={
            spaces.length === 0
              ? "No Program or Cohort Community space is available in your current assignment or delegation scope."
              : "Choose a Program or Cohort space to load its discussions."
          }
          icon="CM"
          title={spaces.length === 0 ? "No Community spaces available" : "Choose a Community space"}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 border-b border-[#D8E8F0] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeader
              description={`Showing ${selectedSpace.label}. Posts are filtered by this exact space.`}
              title="Discussion feed"
            />
            <FormField htmlFor="community-status-filter" label="Post state">
              <select
                className="h-11 min-w-44 rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="community-status-filter"
                onChange={(event) => setFilter(event.target.value as FilterStatus)}
                value={filter}
              >
                {statusFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {feedLoading ? (
            <div aria-label="Loading Community posts" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <Skeleton className="h-56" />
                <Skeleton className="h-48" />
              </div>
              <Skeleton className="h-72" />
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              action={canCreate && filter === "all" ? { label: "Create Draft", onClick: openCreateForm } : undefined}
              description={
                filter === "all"
                  ? `Start the first focused discussion in ${selectedSpace.label}.`
                  : `No ${filter} posts are available in ${selectedSpace.label}.`
              }
              icon="CM"
              title={filter === "all" ? "No discussions in this space" : "No matching posts"}
            />
          ) : (
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                {posts.map((post) => (
                  <CommunityPostCard
                    actions={postActions(post)}
                    isSelected={selectedPostId === post.id}
                    key={post.id}
                    onSelect={() => setSelectedPostId(post.id)}
                    post={post}
                    scopeLabel={selectedSpace.label}
                    status={post.status}
                  />
                ))}
                {postsHasMore ? (
                  <div className="flex justify-center">
                    <Button
                      isLoading={loadingMore}
                      loadingText="Loading..."
                      onClick={() => void loadMorePosts()}
                      type="button"
                      variant="secondary"
                    >
                      Load more posts
                    </Button>
                  </div>
                ) : null}
              </div>

              <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                <Card className="p-5">
                  <SectionHeader
                    description={
                      selectedPost
                        ? "One-level replies for the selected discussion."
                        : "Select a post to open its discussion."
                    }
                    title="Comments"
                  />

                  {selectedPost ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-4">
                        <p className="break-words text-sm font-semibold text-[#0B1F33]">
                          {selectedPost.title}
                        </p>
                        <p className="mt-1 text-xs text-[#64748B]">
                          {selectedPost.comment_count} {selectedPost.comment_count === 1 ? "comment" : "comments"}
                        </p>
                      </div>

                      {canCreate && selectedPost.status !== "archived" && selectedPost.status !== "hidden" ? (
                        <form onSubmit={handleCommentSubmit}>
                          <FormField
                            description="Reply as the Coach team in this exact Community space."
                            htmlFor="coach-community-comment"
                            label="Add a comment"
                          >
                            <textarea
                              className="min-h-28 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                              id="coach-community-comment"
                              maxLength={3000}
                              onChange={(event) => setCommentBody(event.target.value)}
                              placeholder="Write a focused reply."
                              value={commentBody}
                            />
                          </FormField>
                          <Button
                            className="mt-3"
                            disabled={!commentBody.trim()}
                            isLoading={mutating === "save-comment"}
                            loadingText="Posting..."
                            size="sm"
                            type="submit"
                          >
                            Post comment
                          </Button>
                        </form>
                      ) : null}

                      {commentsLoading ? (
                        <div aria-label="Loading comments" className="space-y-3">
                          <Skeleton className="h-24" />
                          <Skeleton className="h-20" />
                        </div>
                      ) : comments.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[#C7DDEA] bg-[#F8FAFC] p-4 text-sm text-[#425B76]">
                          No comments yet.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {comments.map((comment) => (
                            <article className="rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-4" key={comment.id}>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={comment.author_type === "team" ? "info" : "light"}>
                                  {comment.author_name}
                                </Badge>
                                <Badge tone={comment.status === "hidden" ? "danger" : "success"}>
                                  {comment.status === "hidden" ? "Hidden" : "Visible"}
                                </Badge>
                                <span className="text-xs text-[#64748B]">
                                  {formatCommunityDate(comment.created_at)}
                                </span>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#334155]">
                                {comment.body}
                              </p>
                              {comment.status !== "hidden" && canModerate ? (
                                <Button
                                  className="mt-3"
                                  onClick={() => setConfirmation({ comment, kind: "comment" })}
                                  size="sm"
                                  type="button"
                                  variant="destructive"
                                >
                                  Hide comment
                                </Button>
                              ) : null}
                            </article>
                          ))}
                          {commentsHasMore ? (
                            <Button
                              fullWidth
                              isLoading={commentsLoadingMore}
                              loadingText="Loading..."
                              onClick={() => void loadMoreComments()}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Load more comments
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-lg border border-dashed border-[#C7DDEA] bg-[#F8FAFC] p-4 text-sm text-[#425B76]">
                      Select a Community post to review its comments.
                    </p>
                  )}
                </Card>
              </aside>
            </section>
          )}
        </>
      )}

      {formOpen && selectedSpace ? (
        <CommunityDialog
          description={
            editing
              ? `Update this ${selectedSpace.label} post without changing its Community space.`
              : `Create a private Draft in ${selectedSpace.label}. Publishing is a separate confirmed action.`
          }
          disabled={mutating === "save-post"}
          onClose={() => setFormOpen(false)}
          title={editing ? "Edit Community post" : "Create Community post"}
        >
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-3">
            <Badge tone={selectedSpace.kind === "cohort" ? "trainer" : "info"}>
              {selectedSpace.label}
            </Badge>
            <span className="text-sm text-[#425B76]">Exact Community space</span>
          </div>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormField htmlFor="coach-community-title" label="Title" required>
              <input
                className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="coach-community-title"
                maxLength={180}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                required
                value={form.title}
              />
            </FormField>
            <FormField htmlFor="coach-community-type" label="Post type">
              <select
                className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="coach-community-type"
                onChange={(event) => setForm((current) => ({ ...current, postType: event.target.value as CommunityPostType }))}
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
              description="Plain text only. Keep the message focused on this coaching space."
              htmlFor="coach-community-message"
              label="Message"
              required
            >
              <textarea
                className="min-h-44 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="coach-community-message"
                maxLength={6000}
                onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                required
                value={form.body}
              />
            </FormField>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button disabled={mutating === "save-post"} onClick={() => setFormOpen(false)} type="button" variant="secondary">
                Cancel
              </Button>
              <Button isLoading={mutating === "save-post"} loadingText="Saving..." type="submit">
                {editing ? "Save changes" : "Create Draft"}
              </Button>
            </div>
          </form>
        </CommunityDialog>
      ) : null}

      {confirmation && confirmationDetails ? (
        <CommunityDialog
          description={confirmationDetails.description}
          disabled={Boolean(mutating)}
          onClose={() => setConfirmation(null)}
          title={confirmationDetails.title}
        >
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button disabled={Boolean(mutating)} onClick={() => setConfirmation(null)} type="button" variant="secondary">
              Cancel
            </Button>
            <Button
              isLoading={Boolean(mutating)}
              loadingText="Working..."
              onClick={() => void handleConfirm()}
              type="button"
              variant={confirmation.kind === "post" && confirmation.action === "publish" ? "primary" : "destructive"}
            >
              {confirmationDetails.confirm}
            </Button>
          </div>
        </CommunityDialog>
      ) : null}
    </div>
  );
}
