import { useEffect, useState } from "react";
import { mediaApi } from "../../api/media.api";
import { cn } from "../../lib/cn";
import type { MediaItem } from "../../lib/types";

/**
 * Preview thumbnail for a stored photo.
 *
 * Both storage buckets are private, so a stored path is not directly loadable:
 * the component asks the API for a short-lived signed URL and shows a neutral
 * placeholder when the item is a document, when signing fails, or while the URL
 * is still being fetched. That keeps "no preview" distinguishable from a broken
 * image and avoids an <img> with an unloadable `src`.
 */
export function MediaThumbnail({
  item,
  className,
  alt,
}: {
  item: MediaItem;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none">(
    item.kind === "photo" ? "loading" : "none"
  );

  useEffect(() => {
    if (item.kind !== "photo") {
      setStatus("none");
      return;
    }
    let live = true;
    setStatus("loading");
    setUrl(null);

    void mediaApi
      .deliveryUrl(item.id, 3600)
      .then((result) => {
        if (!live) return;
        if (result.url) {
          setUrl(result.url);
          setStatus("ready");
        } else {
          setStatus("none");
        }
      })
      .catch(() => {
        if (live) setStatus("none");
      });

    return () => {
      live = false;
    };
  }, [item.id, item.kind]);

  if (status === "ready" && url) {
    return (
      <img
        src={url}
        alt={alt ?? ""}
        loading="lazy"
        className={cn("rounded-lg border border-slate-200 bg-slate-100 object-cover", className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] font-medium uppercase tracking-wide text-slate-400",
        className
      )}
    >
      {status === "loading" ? "Loading…" : item.kind === "photo" ? "No preview" : "Document"}
    </div>
  );
}
