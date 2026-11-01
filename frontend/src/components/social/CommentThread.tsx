import { useState, type FormEvent } from "react";
import { commentsApi } from "../../api/comments.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/http";
import { relativeTime } from "../../lib/format";
import { COMMENT_MAX } from "../../lib/validation";
import type { Comment } from "../../lib/types";
import { useAsync } from "../../hooks/useAsync";
import { useProfileRoom } from "../../hooks/useProfileRoom";
import { useRealtime } from "../../hooks/useRealtime";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Pagination } from "../ui/Pagination";
import { Spinner } from "../ui/Spinner";
import { Textarea } from "../ui/Textarea";

type CommentEvent = {
  commentId: string;
  authorProfileId: string;
  targetProfileId: string;
  body: string;
  createdAt: string;
};

/**
 * Real-time comment thread (Spec §6).
 *
 * A posted comment is appended from the POST response immediately, so it appears
 * without a refresh. The thread also subscribes to the `comment:new` socket event and
 * joins the viewed profile's room (`useProfileRoom`), so a comment posted by *another*
 * member viewing the same profile is pushed here too - not only to the profile owner.
 */
export function CommentThread({ profileId, canComment }: { profileId: string; canComment: boolean }) {
  const { user } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [liveComments, setLiveComments] = useState<Comment[]>([]);

  useProfileRoom(profileId);

  const comments = useAsync(
    (signal) => commentsApi.list(profileId, { page, limit: 5 }, signal),
    [profileId, page]
  );

  useRealtime({
    "comment:new": (payload) => {
      const event = payload as CommentEvent;
      if (event.targetProfileId !== profileId) return;
      setLiveComments((current) =>
        current.some((item) => item.id === event.commentId)
          ? current
          : [
              {
                id: event.commentId,
                authorProfileId: event.authorProfileId,
                targetProfileId: event.targetProfileId,
                body: event.body,
                createdAt: event.createdAt,
              },
              ...current,
            ]
      );
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (body.length > COMMENT_MAX) {
      toast.error(`Comments are limited to ${COMMENT_MAX} characters.`);
      return;
    }

    setPosting(true);
    try {
      const result = await commentsApi.create(profileId, body);
      setDraft("");
      setLiveComments((current) => [result.comment, ...current]);
      toast.success("Comment posted.");
    } catch (caught) {
      toast.error("Could not post the comment", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPosting(false);
    }
  }

  async function remove(commentId: string) {
    try {
      await commentsApi.remove(commentId);
      setLiveComments((current) => current.filter((item) => item.id !== commentId));
      comments.reload();
      toast.success("Comment deleted.");
    } catch (caught) {
      toast.error("Could not delete the comment", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  const list = [...liveComments, ...(comments.data?.comments ?? [])];
  const pagination = comments.data?.pagination;

  return (
    <Card title="Comments">
      {canComment ? (
        <form className="mb-5 flex flex-col gap-2" onSubmit={onSubmit}>
          <Textarea
            rows={3}
            maxLength={COMMENT_MAX}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a good-wishes comment..."
            aria-label="New comment"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {draft.trim().length}/{COMMENT_MAX}
            </span>
            <Button type="submit" size="sm" loading={posting} disabled={!draft.trim()}>
              Post comment
            </Button>
          </div>
        </form>
      ) : null}

      {comments.status === "loading" ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-brand-600" />
        </div>
      ) : comments.status === "error" ? (
        <ErrorState error={comments.error} onRetry={comments.reload} />
      ) : list.length === 0 ? (
        <EmptyState title="No comments yet" description="Be the first to leave a good wish." />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {list.map((comment) => (
            <li key={comment.id} className="flex gap-3 py-3">
              <Avatar name={comment.authorProfileId.slice(0, 8)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400">
                  {relativeTime(comment.createdAt)}
                  {comment.authorProfileId === user?.id ? " \u00b7 you" : ""}
                </p>
                <p className="whitespace-pre-line text-sm text-slate-700">{comment.body}</p>
              </div>
              {comment.authorProfileId === user?.id ? (
                <button
                  type="button"
                  onClick={() => void remove(comment.id)}
                  className="self-start text-xs text-red-600 underline-offset-2 hover:underline"
                >
                  Delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pagination ? (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            onChange={setPage}
            busy={comments.status === "loading"}
          />
        </div>
      ) : null}
    </Card>
  );
}
