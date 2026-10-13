import { useState } from "react";
import { cn } from "../../lib/cn";
import { initials } from "../../lib/format";

/**
 * Profile image with a graceful fallback.
 *
 * `src` may be a Firebase Storage path (which the API returns as a string, not a
 * signed URL — R-056) or null when the photo is withheld by visibility rules. When
 * there is nothing loadable, the initials are shown instead of a broken image, so
 * "no photo available" is distinguishable from "failed to load".
 */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dimensions = {
    sm: "h-9 w-9 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-20 w-20 text-lg",
    xl: "h-28 w-28 text-2xl",
  }[size];

  const showImage = src && !failed;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700 ring-1 ring-brand-200",
        dimensions,
        className
      )}
      aria-hidden={!showImage ? undefined : true}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <span aria-label={name}>{initials(name)}</span>
      )}
    </div>
  );
}
