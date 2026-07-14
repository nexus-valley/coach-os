"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createStudentCommunityComment,
  createStudentCommunityPost,
  formatCommunityDate,
  getCommunityPostTypeLabel,
  getStudentCommunityComments,
  getStudentCommunityPosts,
  type CommunityPostType,
  type StudentCommunityComment,
  type StudentCommunityPost,
} from "@/src/lib/community";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";

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

const postTypes: CommunityPostType[] = [
  "discussion",
  "question",
  "resource",
  "update",
];

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
}

function getAuthorLabel(post: StudentCommunityPost) {
  if (post.author_type === "student") {
    return post.author_name || "Community member";
  }

  return post.author_name || "Coach team";
}

function getAuthorTone(authorType: StudentCommunityPost["author_type"]) {
  return authorType === "student" ? "light" : "info";
}

export function StudentPortalCommunity({
  context,
}: {
  context: StudentPortalContext;
}) {
  const [actionError, setActionError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [comments, setComments] = useState<StudentCommunityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [postForm, setPostForm] = useState<PostFormState>(emptyPostForm);
  const [posts, setPosts] = useState<StudentCommunityPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? null,
    [posts, selectedPostId],
  );

  async function loadPosts(preferredPostId?: string | null) {
    setActionError("");
    setLoading(true);

    try {
      const nextPosts = await getStudentCommunityPosts();
      const nextSelectedPostId =
        preferredPostId && nextPosts.some((post) => post.id === preferredPostId)
          ? preferredPostId
          : nextPosts[0]?.id ?? null;

      setPosts(nextPosts);
      setSelectedPostId(nextSelectedPostId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load community posts."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialPosts() {
      setActionError("");
      setLoading(true);

      try {
        const nextPosts = await getStudentCommunityPosts();

        if (active) {
          setPosts(nextPosts);
          setSelectedPostId(nextPosts[0]?.id ?? null);
        }
      } catch (caught) {
        if (active) {
          setActionError(getErrorMessage(caught, "Unable to load community posts."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialPosts();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadComments() {
      if (!selectedPostId) {
        setComments([]);
        return;
      }

      setCommentsLoading(true);

      try {
        const nextComments = await getStudentCommunityComments(selectedPostId);

        if (active) {
          setComments(nextComments);
        }
      } catch (caught) {
        if (active) {
          setActionError(getErrorMessage(caught, "Unable to load comments."));
        }
      } finally {
        if (active) {
          setCommentsLoading(false);
        }
      }
    }

    void loadComments();

    return () => {
      active = false;
    };
  }, [selectedPostId]);

  async function refreshSelectedPost() {
    if (!selectedPostId) {
      return;
    }

    const [nextPosts, nextComments] = await Promise.all([
      getStudentCommunityPosts(),
      getStudentCommunityComments(selectedPostId),
    ]);

    setPosts(nextPosts);
    setComments(nextComments);
  }

  async function handlePostSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = postForm.title.trim();
    const body = postForm.body.trim();

    if (!title || !body) {
      setActionError("Add a title and message before starting a discussion.");
      return;
    }

    if (!isPlainText(title) || !isPlainText(body)) {
      setActionError("Community posts must use plain text without HTML.");
      return;
    }

    setActionError("");
    setSuccess("");
    setMutating("save-post");

    try {
      const savedPost = await createStudentCommunityPost(
        context.tenant.id,
        title,
        body,
        postForm.postType,
      );

      setPostForm(emptyPostForm);
      setComposerOpen(false);
      setSuccess("Your discussion is live in the community.");
      await loadPosts(savedPost.id);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to start the discussion."));
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
      await createStudentCommunityComment(selectedPost.id, commentBody);
      setCommentBody("");
      setSuccess("Your comment was added.");
      await refreshSelectedPost();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add your comment."));
    } finally {
      setMutating("");
    }
  }

  if (loading) {
    return <PortalLoadingCard label="Loading community" />;
  }

  if (actionError && posts.length === 0) {
    return <PortalError message={actionError} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        actions={
          <Button onClick={() => setComposerOpen(true)} type="button">
            Start discussion
          </Button>
        }
        description={`Connect with students and the ${context.tenant.name} coach team in a private workspace community.`}
        eyebrow="Private coach community"
        metadata={
          <>
            <Badge tone="light">{posts.length} published posts</Badge>
            <Badge tone="outline">Students and coach team</Badge>
          </>
        }
        title="Community"
      />

      <Card className="overflow-hidden border-[#CBD5E1] bg-white shadow-sm">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0B1F33] text-sm font-bold text-white">
                {context.student.full_name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "ST"}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0B1F33]">
                  Share a win, question, or resource
                </p>
                <p className="text-sm text-[#425B76]">
                  Posts are visible to your private coach community.
                </p>
              </div>
            </div>
            <Button onClick={() => setComposerOpen(true)} type="button" variant="secondary">
              Write a post
            </Button>
          </div>
        </div>
      </Card>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      {posts.length === 0 ? (
        <PortalEmptyState>
          No community discussions yet. Start the first conversation for your
          workspace.
        </PortalEmptyState>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {posts.map((post) => {
              const isSelected = post.id === selectedPostId;

              return (
                <Card
                  className={[
                    "border-[#CBD5E1] bg-white p-0 shadow-sm transition",
                    isSelected ? "ring-2 ring-[#2ECBEA]/35" : "hover:border-[#94A3B8]",
                  ].join(" ")}
                  key={post.id}
                >
                  <button
                    className="block w-full p-5 text-left"
                    onClick={() => setSelectedPostId(post.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={[
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                            post.author_type === "student"
                              ? "bg-[#EAF8FC] text-[#0B2A3D]"
                              : "bg-[#0B1F33] text-white",
                          ].join(" ")}
                        >
                          {getAuthorLabel(post).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#0B1F33]">
                              {getAuthorLabel(post)}
                            </p>
                            <Badge tone={getAuthorTone(post.author_type)}>
                              {post.author_type === "student"
                                ? "Community member"
                                : "Coach team"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium text-[#64748B]">
                            Published {formatCommunityDate(post.published_at)}
                          </p>
                        </div>
                      </div>
                      <Badge tone="outline">
                        {getCommunityPostTypeLabel(post.post_type)}
                      </Badge>
                    </div>
                    <h2 className="mt-5 text-xl font-semibold text-[#0B1F33]">
                      {post.title}
                    </h2>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#334155]">
                      {post.body}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#E2E8F0] pt-4 text-sm font-medium text-[#425B76]">
                      <span>{post.comment_count} comments</span>
                      <span aria-hidden="true" className="text-[#CBD5E1]">
                        |
                      </span>
                      <span>{isSelected ? "Discussion open" : "Open discussion"}</span>
                    </div>
                  </button>
                </Card>
              );
            })}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Card className="border-[#CBD5E1] bg-white p-5 shadow-sm">
              {selectedPost ? (
                <div className="space-y-5">
                  <SectionHeader
                    description="Reply with respectful, plain-text comments."
                    title="Discussion thread"
                  />
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <p className="text-sm font-semibold text-[#0B1F33]">
                      {selectedPost.title}
                    </p>
                    <p className="mt-2 text-xs font-medium text-[#64748B]">
                      Started by {getAuthorLabel(selectedPost)}
                    </p>
                  </div>

                  <form
                    className="rounded-xl border border-[#D8E8F0] bg-white p-4 shadow-sm"
                    onSubmit={handleCommentSubmit}
                  >
                    <FormField
                      description="Your reply appears in this private community thread."
                      label="Add a comment"
                    >
                      <textarea
                        className="min-h-28 w-full resize-none rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                        maxLength={3000}
                        onChange={(event) => setCommentBody(event.target.value)}
                        placeholder="Add a thoughtful reply."
                        value={commentBody}
                      />
                    </FormField>
                    <Button
                      className="mt-3"
                      disabled={mutating === "save-comment" || !commentBody.trim()}
                      size="sm"
                      type="submit"
                    >
                      {mutating === "save-comment" ? "Posting..." : "Post comment"}
                    </Button>
                  </form>

                  {commentsLoading ? (
                    <div className="h-32 animate-pulse rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]" />
                  ) : comments.length === 0 ? (
                    <PortalEmptyState>No comments yet. Start the discussion.</PortalEmptyState>
                  ) : (
                    <div className="space-y-3">
                      {comments.map((comment) => (
                        <div
                          className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4"
                          key={comment.id}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={comment.author_type === "team" ? "info" : "light"}>
                              {comment.author_name}
                            </Badge>
                            <span className="text-xs font-medium text-[#64748B]">
                              {formatCommunityDate(comment.created_at)}
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#334155]">
                            {comment.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <PortalEmptyState>Select a discussion to read comments.</PortalEmptyState>
              )}
            </Card>
          </aside>
        </section>
      )}

      {composerOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm">
          <div className="flex min-h-full items-end justify-center sm:items-center">
            <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge tone="info">Private community</Badge>
                  <h2 className="mt-3 text-2xl font-semibold text-[#0B1F33]">
                    Start a discussion
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#425B76]">
                    Ask a question, share a win, or start a useful conversation
                    with your coach community.
                  </p>
                </div>
                <Button
                  onClick={() => setComposerOpen(false)}
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handlePostSubmit}>
                <FormField
                  description="Use a clear title so other students can scan the feed."
                  label="Title"
                  required
                >
                  <input
                    className="h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    maxLength={180}
                    onChange={(event) =>
                      setPostForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="What would you like to discuss?"
                    required
                    value={postForm.title}
                  />
                </FormField>
                <FormField description="Choose the best fit for this post." label="Type">
                  <select
                    className="h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    onChange={(event) =>
                      setPostForm((current) => ({
                        ...current,
                        postType: event.target.value as CommunityPostType,
                      }))
                    }
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
                  description="Write a clear message for your private coach community. Keep it respectful and useful for other students."
                  label="Message"
                  required
                >
                  <textarea
                    className="min-h-44 w-full resize-none rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                    maxLength={6000}
                    onChange={(event) =>
                      setPostForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                    placeholder="Write your discussion in plain text."
                    required
                    value={postForm.body}
                  />
                </FormField>
                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    onClick={() => setComposerOpen(false)}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button disabled={mutating === "save-post"} type="submit">
                    {mutating === "save-post" ? "Posting..." : "Publish discussion"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
