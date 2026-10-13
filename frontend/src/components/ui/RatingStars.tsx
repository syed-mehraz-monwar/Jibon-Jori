import { useState } from "react";
import { cn } from "../../lib/cn";

/**
 * Rating control (1..5).
 *
 * Rendered as a radio group so it is keyboard-operable and announced correctly:
 * arrow keys move between values and the current value is exposed via
 * `aria-checked`. `readOnly` renders the average for display.
 */
export function RatingStars({
  value,
  onChange,
  readOnly = false,
  size = "md",
  label,
}: {
  value: number;
  onChange?: (score: number) => void;
  readOnly?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const dimensions = size === "sm" ? "text-base" : size === "lg" ? "text-3xl" : "text-2xl";

  if (readOnly) {
    return (
      <span
        className={cn("inline-flex items-center gap-0.5", dimensions)}
        role="img"
        aria-label={label ?? `Rating ${value} out of 5`}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={star <= Math.round(value) ? "text-amber-500" : "text-slate-300"}>
            &#9733;
          </span>
        ))}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={label ?? "Rating"}
      className={cn("inline-flex items-center gap-0.5", dimensions)}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} of 5`}
          tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
          onMouseEnter={() => setHover(star)}
          onClick={() => onChange?.(star)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              onChange?.(Math.min(5, (value || 0) + 1));
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              onChange?.(Math.max(1, (value || 1) - 1));
            }
          }}
          className={cn(
            "rounded transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            star <= shown ? "text-amber-500" : "text-slate-300"
          )}
        >
          &#9733;
        </button>
      ))}
    </div>
  );
}
