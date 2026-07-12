"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createStudentCommunityComment,
  formatCommunityDate,
  getCommunityPostTypeLabel,
  getStudentCommunityComments,
  getStudentCommunityPosts,
  type StudentCommunityComment,
  type StudentCommunityPost,
} from "@/src/lib/community";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { PortalEmptyState, PortalError, PortalLoadingCard } from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { FormField } from "@/src/components/ui/FormField";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function isPlainText(value: string) {
  return !/[<>]/.test(value);
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
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [posts, setPosts] = useState<StudentCommunityPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? null,
    [posts, selectedPostId],
  );

  useEffect(() => {
    let active = true;

    async function loadPosts() {
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

    void loadPosts();

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
    setMutating(true);

    try {
      await createStudentCommunityComment(selectedPost.id, commentBody);
      setCommentBody("");
      setSuccess("Your comment was added.");
      await refreshSelectedPost();
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to add your comment."));
    } finally {
      setMutating(false);
    }
  }

  if (loading) {
    return <PortalLoadingCard label="Loading community" />;
  }

  if (actionError && posts.length === 0) {
    return <PortalError message={actionError} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description={`Join moderated discussions shared by ${context.tenant.name}. Students can comment on published academy posts.`}
        eyebrow="Academy community"
        metadata={<Badge tone="light">{posts.length} published posts</Badge>}
        title="Community"
      />

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      {posts.length === 0 ? (
        <PortalEmptyState>
          No community posts have been published for your academy yet.
        </PortalEmptyState>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border-[#D8E8F0] bg-white p-5">
            <SectionHeader
              description="Choose a published discussion to read and comment."
              title="Published discussions"
            />
            <div className="mt-5 space-y-3">
              {posts.map((post) => (
                <button
                  className={[
                    "w-full rounded-2xl border p-4 text-left transition",
                    selectedPostId === post.id
                      ? "border-[#2ECBEA] bg-[#EAF8FC]"
                      : "border-[#D8E8F0] bg-[#F6FBFE] hover:border-[#9ADDEA]",
                  ].join(" ")}
                  key={post.id}
                  onClick={() => setSelectedPostId(post.id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">
                      {getCommunityPostTypeLabel(post.post_type)}
                    </Badge>
                    <Badge tone="outline">{post.comment_count} comments</Badge>
                  </div>
                  <p className="mt-3 font-semibold text-[#0B1F33]">{post.title}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#425B76]">
                    {post.body}
                  </p>
                  <p className="mt-3 text-xs font-medium text-[#66788F]">
                    Published {formatCommunityDate(post.published_at)}
                  </p>
                </button>
              ))}
            </div>
          </Card>

          <Card className="border-[#D8E8F0] bg-white p-5">
            {selectedPost ? (
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">
                      {getCommunityPostTypeLabel(selectedPost.post_type)}
                    </Badge>
                    <Badge tone="light">Academy discussion</Badge>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-[#0B1F33]">
                    {selectedPost.title}
                  </h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                    {selectedPost.body}
                  </p>
                </div>

                <form
                  className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                  onSubmit={handleCommentSubmit}
                >
                  <FormField
                    description="Your comment is visible to your academy community after it is posted."
                    label="Add a comment"
                  >
                    <textarea
                      className="min-h-28 w-full resize-none rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA]/70 focus:ring-4 focus:ring-[#2ECBEA]/10"
                      maxLength={3000}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="Write a respectful community reply."
                      value={commentBody}
                    />
                  </FormField>
                  <Button
                    className="mt-3"
                    disabled={mutating || !commentBody.trim()}
                    size="sm"
                    type="submit"
                  >
                    {mutating ? "Posting..." : "Post comment"}
                  </Button>
                </form>

                <SectionHeader
                  description="Only published comments are shown to students."
                  title="Discussion"
                />
                {commentsLoading ? (
                  <div className="h-32 animate-pulse rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE]" />
                ) : comments.length === 0 ? (
                  <PortalEmptyState>No comments yet. Start the discussion.</PortalEmptyState>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
                        key={comment.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={comment.author_type === "team" ? "info" : "light"}>
                            {comment.author_name}
                          </Badge>
                          <span className="text-xs font-medium text-[#66788F]">
                            {formatCommunityDate(comment.created_at)}
                          </span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#425B76]">
                          {comment.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <PortalEmptyState>Select a community post to read.</PortalEmptyState>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
