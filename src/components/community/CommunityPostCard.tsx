import type { ReactNode } from "react";

import { Badge } from "@/src/components/ui/Badge";
import {
  formatCommunityDate,
  getCommunityPostTypeLabel,
  type CommunityPostStatus,
  type StudentCommunityPost,
} from "@/src/lib/community";

function statusTone(status: CommunityPostStatus) {
  if (status === "published") return "success" as const;
  if (status === "hidden") return "danger" as const;
  if (status === "archived") return "neutral" as const;
  return "warning" as const;
}

function titleCase(value: string) {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function authorInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "CF";
}

export function CommunityPostCard({
  actions,
  isSelected,
  onSelect,
  post,
  scopeLabel,
  status,
}: {
  actions?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  post: StudentCommunityPost;
  scopeLabel: string;
  status?: CommunityPostStatus;
}) {
  const authorName = post.author_name || (post.author_type === "team" ? "Coach team" : "Student");
  const timestamp = post.published_at ?? post.updated_at ?? post.created_at;

  return (
    <article
      className={[
        "overflow-hidden rounded-lg border bg-white shadow-sm transition",
        status === "published" ? "border-l-4 border-l-[#059669]" : "border-[#CBD5E1]",
        status === "draft" ? "border-l-4 border-l-[#F59E0B]" : "",
        isSelected ? "ring-2 ring-[#2ECBEA]/35" : "hover:border-[#94A3B8]",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        aria-pressed={isSelected}
        className="block w-full px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#2ECBEA] sm:px-5"
        onClick={onSelect}
        type="button"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className={[
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                post.author_type === "team"
                  ? "bg-[#0B1F33] text-white"
                  : "bg-[#EAF8FC] text-[#0B2A3D]",
              ].join(" ")}
            >
              {authorInitials(authorName)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words text-sm font-semibold text-[#0B1F33]">
                  {authorName}
                </p>
                <Badge tone={post.author_type === "team" ? "info" : "light"}>
                  {post.author_type === "team" ? "Coach" : "Student"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-[#64748B]">
                {formatCommunityDate(timestamp)}
              </p>
            </div>
          </div>
          <Badge tone="outline">{getCommunityPostTypeLabel(post.post_type)}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={post.audience_type === "cohort" ? "trainer" : "neutral"}>
            {scopeLabel}
          </Badge>
          {status ? <Badge tone={statusTone(status)}>{titleCase(status)}</Badge> : null}
        </div>

        <h2 className="mt-4 break-words text-lg font-semibold text-[#0B1F33]">
          {post.title}
        </h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#334155]">
          {post.body}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E2E8F0] pt-3 text-xs font-medium text-[#52677D]">
          <span>{post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}</span>
          <span aria-hidden="true">|</span>
          <span>{isSelected ? "Discussion open" : "Open discussion"}</span>
        </div>
      </button>
      {actions ? (
        <div className="flex justify-end border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 sm:px-5">
          {actions}
        </div>
      ) : null}
    </article>
  );
}
