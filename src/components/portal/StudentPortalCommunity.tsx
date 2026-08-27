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
import {
  PortalEmptyState,
  PortalError,
} from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import {
  appendUniqueCommunityItems,
  canWriteCommunityPost,
  communityPageSize,
  createStudentCommunityComment,
  createStudentCommunityPostV2,
  executeCommunityMutation,
  formatCommunityDate,
  getCommunityPostTypeLabel,
  getStudentCommunityCommentsV2,
  getStudentCommunityPostsV2,
  getStudentCommunityScopes,
  type CommunityCreateScope,
  type CommunityPostType,
  type StudentCommunityComment,
  type StudentCommunityPost,
} from "@/src/lib/community";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

type PostFormState = {
  body: string;
  postType: CommunityPostType;
  title: string;
};

const emptyPostForm: PostFormState = {
  body: "",
  postType: "discussion",
  title: "",
};
const refreshFailureMessage =
  "Your Community action succeeded, but the latest view could not be refreshed. Refresh the page to see the current state.";
const postTypes: CommunityPostType[] = [
  "discussion",
  "question",
  "resource",
  "update",
];

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

  if (code === "42501" || /permission|participation|scope access/.test(message)) {
    return "Your Community access changed. Refresh to see the spaces currently available to you.";
  }
  if (/not found|unavailable/.test(message)) {
    return "This Community discussion is no longer available.";
  }
  if (/plain text|required|title|body/.test(message)) {
    return "Enter a plain-text title and message before posting.";
  }

  return fallback;
}

export function StudentPortalCommunity({
  context,
}: {
  context: StudentPortalContext;
}) {
  const successRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [comments, setComments] = useState<StudentCommunityComment[]>([]);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutating, setMutating] = useState("");
  const [postForm, setPostForm] = useState<PostFormState>(emptyPostForm);
  const [posts, setPosts] = useState<StudentCommunityPost[]>([]);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");
  const [spaces, setSpaces] = useState<CommunityCreateScope[]>([]);
  const [success, setSuccess] = useState("");

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.key === selectedSpaceKey) ?? null,
    [selectedSpaceKey, spaces],
  );
  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? null,
    [posts, selectedPostId],
  );
  const canWriteSelectedPost = Boolean(
    selectedPost && canWriteCommunityPost(selectedPost, spaces),
  );

  useEffect(() => {
    let active = true;

    async function loadSpaces() {
      setInitialLoading(true);
      setActionError("");

      try {
        const nextSpaces = await getStudentCommunityScopes({
          studentId: context.student.id,
          tenantId: context.tenant.id,
        });
        if (!active) return;
        setSpaces(nextSpaces);
        setSelectedSpaceKey(nextSpaces.length === 1 ? nextSpaces[0].key : "");
      } catch (caught) {
        if (active) {
          setActionError(
            getCommunityErrorMessage(caught, "Unable to load your Community spaces."),
          );
        }
      } finally {
        if (active) setInitialLoading(false);
      }
    }

    void loadSpaces();
    return () => {
      active = false;
    };
  }, [context.student.id, context.tenant.id]);

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      if (!selectedSpace) {
        setPosts([]);
        setSelectedPostId(null);
        setFeedLoading(false);
        return;
      }

      setFeedLoading(true);
      setActionError("");

      try {
        const nextPosts = await getStudentCommunityPostsV2({ scope: selectedSpace });
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
            getCommunityErrorMessage(caught, "Unable to load Community discussions."),
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
  }, [selectedSpace]);

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
        const nextComments = await getStudentCommunityCommentsV2({
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

  async function refreshPosts(preferredPostId?: string | null) {
    if (!selectedSpace) return false;
    const nextPosts = await getStudentCommunityPostsV2({ scope: selectedSpace });
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
    const nextComments = await getStudentCommunityCommentsV2({ postId });
    setComments(nextComments);
    setCommentsHasMore(nextComments.length === communityPageSize);
    return true;
  }

  async function loadMorePosts() {
    if (!selectedSpace || loadingMore || posts.length === 0) return;
    const last = posts[posts.length - 1];
    setLoadingMore(true);

    try {
      const nextPosts = await getStudentCommunityPostsV2({
        cursor: { id: last.id, timestamp: last.published_at ?? last.updated_at },
        scope: selectedSpace,
      });
      setPosts((current) => appendUniqueCommunityItems(current, nextPosts));
      setPostsHasMore(nextPosts.length === communityPageSize);
    } catch (caught) {
      setActionError(
        getCommunityErrorMessage(caught, "Unable to load more Community discussions."),
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
      const nextComments = await getStudentCommunityCommentsV2({
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

  function openComposer() {
    if (!selectedSpace?.canWrite) return;
    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setPostForm(emptyPostForm);
    setComposerOpen(true);
  }

  async function handlePostSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSpace?.canWrite || mutating) return;

    const title = postForm.title.trim();
    const body = postForm.body.trim();

    if (!title || !body || !isPlainText(title) || !isPlainText(body)) {
      setActionError("Enter a plain-text title and message before posting.");
      return;
    }

    setActionError("");
    setSuccess("");
    setRefreshWarning("");
    setMutating("save-post");
    let savedId: string | null = null;

    const outcome = await executeCommunityMutation({
      mutate: async () => {
        const saved = await createStudentCommunityPostV2(
          selectedSpace.courseId,
          selectedSpace.cohortId,
          title,
          body,
          postForm.postType,
        );
        savedId = saved.id;
      },
      onMutationSuccess: () => {
        setPostForm(emptyPostForm);
        setComposerOpen(false);
        setSuccess("Your Community post is live.");
      },
      refresh: () => refreshPosts(savedId),
    });

    if (!outcome.mutationSucceeded) {
      setActionError(
        getCommunityErrorMessage(outcome.mutationError, "Unable to publish your Community post."),
      );
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating("");
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPost || !canWriteSelectedPost || mutating) return;
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
      mutate: () => createStudentCommunityComment(selectedPost.id, body),
      onMutationSuccess: () => {
        setCommentBody("");
        setSuccess("Your Community comment was added.");
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
        getCommunityErrorMessage(outcome.mutationError, "Unable to add your Community comment."),
      );
    } else {
      if (!outcome.refreshSucceeded) setRefreshWarning(refreshFailureMessage);
      window.requestAnimationFrame(() => successRef.current?.focus());
    }
    setMutating("");
  }

  if (initialLoading) {
    return (
      <div aria-label="Loading Community" className="mx-auto max-w-6xl space-y-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-24" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (actionError && spaces.length === 0) {
    return <PortalError message={actionError} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        actions={
          selectedSpace?.canWrite ? (
            <Button onClick={openComposer} type="button">
              Start a post
            </Button>
          ) : null
        }
        description={`Join focused Program and Cohort discussions with the ${context.tenant.name} Coach team.`}
        eyebrow="Your coaching Community"
        metadata={
          <>
            <Badge tone="light">Coach and Student discussions</Badge>
            {selectedSpace && !selectedSpace.canWrite ? (
              <Badge tone="neutral">Historical read only</Badge>
            ) : null}
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
        id="student-community-space"
        onChange={(key) => {
          setSelectedSpaceKey(key);
          setSelectedPostId(null);
          setPosts([]);
        }}
        selectedKey={selectedSpaceKey}
        spaces={spaces}
      />

      {spaces.length === 0 ? (
        <PortalEmptyState>
          No Program or Cohort Community space is available for your current access.
        </PortalEmptyState>
      ) : !selectedSpace ? (
        <PortalEmptyState>
          Choose a Program or Cohort space to open its Community discussions.
        </PortalEmptyState>
      ) : (
        <>
          <section className="flex flex-col gap-3 border-b border-[#D8E8F0] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeader
              description={selectedSpace.description}
              title={selectedSpace.label}
            />
            {selectedSpace.canWrite ? (
              <Button onClick={openComposer} type="button" variant="secondary">
                Write a post
              </Button>
            ) : (
              <Badge tone="neutral">Read-only history</Badge>
            )}
          </section>

          {feedLoading ? (
            <div aria-label="Loading Community discussions" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <Skeleton className="h-56" />
                <Skeleton className="h-48" />
              </div>
              <Skeleton className="h-72" />
            </div>
          ) : posts.length === 0 ? (
            <PortalEmptyState>
              {selectedSpace.canWrite
                ? "No discussions yet. Start a focused question, resource, update, or conversation."
                : "No historical Community discussions are available in this space."}
            </PortalEmptyState>
          ) : (
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                {posts.map((post) => (
                  <CommunityPostCard
                    isSelected={post.id === selectedPostId}
                    key={post.id}
                    onSelect={() => setSelectedPostId(post.id)}
                    post={post}
                    scopeLabel={selectedSpace.label}
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
                        ? "Read and join this one-level discussion."
                        : "Select a post to open its comments."
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
                          Started by {selectedPost.author_name || "Community member"}
                        </p>
                      </div>

                      {canWriteSelectedPost ? (
                        <form onSubmit={handleCommentSubmit}>
                          <FormField
                            description="Your reply appears in this exact Community space."
                            htmlFor="student-community-comment"
                            label="Add a comment"
                          >
                            <textarea
                              className="min-h-28 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                              id="student-community-comment"
                              maxLength={3000}
                              onChange={(event) => setCommentBody(event.target.value)}
                              placeholder="Add a thoughtful reply."
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
                      ) : (
                        <p className="rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-4 text-sm leading-6 text-[#425B76]">
                          This Community space is available as read-only history. New posts and comments are unavailable.
                        </p>
                      )}

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
                                <Badge tone={comment.author_type === "team" ? "info" : "neutral"}>
                                  {comment.author_type === "team" ? "Coach" : "Student"}
                                </Badge>
                                <span className="text-xs text-[#64748B]">
                                  {formatCommunityDate(comment.created_at)}
                                </span>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#334155]">
                                {comment.body}
                              </p>
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
                      Select a Community post to read its comments.
                    </p>
                  )}
                </Card>
              </aside>
            </section>
          )}
        </>
      )}

      {composerOpen && selectedSpace?.canWrite ? (
        <CommunityDialog
          description={`Publish a focused post directly in ${selectedSpace.label}.`}
          disabled={mutating === "save-post"}
          onClose={() => setComposerOpen(false)}
          title="Start a Community post"
        >
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-3">
            <Badge tone={selectedSpace.kind === "cohort" ? "trainer" : "info"}>
              {selectedSpace.label}
            </Badge>
            <span className="text-sm text-[#425B76]">Publishes immediately</span>
          </div>
          <form className="space-y-4" onSubmit={handlePostSubmit}>
            <FormField htmlFor="student-community-title" label="Title" required>
              <input
                className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="student-community-title"
                maxLength={180}
                onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))}
                required
                value={postForm.title}
              />
            </FormField>
            <FormField htmlFor="student-community-type" label="Post type">
              <select
                className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="student-community-type"
                onChange={(event) => setPostForm((current) => ({ ...current, postType: event.target.value as CommunityPostType }))}
                value={postForm.postType}
              >
                {postTypes.map((postType) => (
                  <option key={postType} value={postType}>
                    {getCommunityPostTypeLabel(postType)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              description="Plain text only. Keep the message useful for this coaching space."
              htmlFor="student-community-message"
              label="Message"
              required
            >
              <textarea
                className="min-h-44 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
                id="student-community-message"
                maxLength={6000}
                onChange={(event) => setPostForm((current) => ({ ...current, body: event.target.value }))}
                required
                value={postForm.body}
              />
            </FormField>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button disabled={mutating === "save-post"} onClick={() => setComposerOpen(false)} type="button" variant="secondary">
                Cancel
              </Button>
              <Button isLoading={mutating === "save-post"} loadingText="Publishing..." type="submit">
                Publish post
              </Button>
            </div>
          </form>
        </CommunityDialog>
      ) : null}
    </div>
  );
}
