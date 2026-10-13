import { useState } from "react";

export type VideoEntry = { id: string; title: string; description?: string };

/**
 * Click-to-load YouTube embed (Spec §14).
 *
 * The player is only created after the user presses play, so opening a page that
 * contains videos does not immediately contact YouTube or set third-party
 * cookies. `youtube-nocookie.com` is used for the same reason. The iframe carries
 * a `title` and the surrounding region is labelled, so the embed is not an
 * unlabelled frame for assistive technology.
 *
 * YouTube was chosen because the requirement names it and it is the only
 * provider with a stable, key-free embed endpoint; no API key or SDK is needed.
 */
export function AudioVideoEmbed({ video, height = 340 }: { video: VideoEntry; height?: number }) {
  const [playing, setPlaying] = useState(false);
  const thumbnail = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`;

  return (
    <figure className="flex flex-col gap-2">
      <div
        className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
        style={{ height }}
      >
        {playing ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(
              video.id
            )}?autoplay=1&rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group relative h-full w-full"
            aria-label={`Play video: ${video.title}`}
          >
            <img
              src={thumbnail}
              alt=""
              className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100"
              loading="lazy"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-2xl text-brand-700 shadow-lg transition group-hover:scale-105">
                &#9654;
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="text-sm">
        <span className="font-medium text-slate-800">{video.title}</span>
        {video.description ? <span className="block text-slate-500">{video.description}</span> : null}
      </figcaption>
    </figure>
  );
}
