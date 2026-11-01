import { useState } from "react";
import { mediaApi } from "../../api/media.api";
import { useAsync } from "../../hooks/useAsync";
import type { PhotoVisibility, Profile } from "../../lib/types";
import { PHOTO_VISIBILITY_LABELS } from "../../lib/format";
import { Avatar } from "../ui/Avatar";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";

/**
 * Large preview of the primary profile photo.
 *
 * The photo itself lives in a private storage bucket, so the preview is a
 * short-lived signed URL fetched through the API. When there is no primary
 * photo — or signing fails — the member's initials are shown, which is
 * distinguishable from a broken image.
 *
 * The caption restates the photo visibility rule, because a member uploading a
 * photo needs to know who will see it before they upload, not afterwards.
 */
export function ProfilePhotoCard({ profile }: { profile: Profile | null }) {
  const [cacheBust, setCacheBust] = useState(0);
  const photo = useAsync(() => mediaApi.primaryPhoto(), [cacheBust]);
  const visibility: PhotoVisibility = profile?.photoVisibility ?? "members";

  return (
    <Card title="Profile photo">
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          {photo.status === "loading" ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : (
            <Avatar
              name={profile?.displayName ?? "?"}
              src={photo.data?.url ?? null}
              size="xl"
              className="h-24 w-24"
            />
          )}
        </div>
        <div className="min-w-0 text-sm">
          {photo.status === "error" ? (
            <>
              <p className="font-medium text-slate-800">Preview unavailable</p>
              <p className="mt-1 text-xs text-slate-500">
                Your photo is still stored. Reopen this page to try again.
              </p>
            </>
          ) : photo.data ? (
            <>
              <p className="font-medium text-slate-800">Primary photo</p>
              <p className="mt-1 text-xs text-slate-500">
                Shown to: {PHOTO_VISIBILITY_LABELS[visibility].toLowerCase()}.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-800">No primary photo yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Upload a photo below and mark it as the primary one.
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => setCacheBust((value) => value + 1)}
            className="mt-2 text-xs font-medium text-brand-700 hover:underline"
          >
            Refresh preview
          </button>
        </div>
      </div>
    </Card>
  );
}
