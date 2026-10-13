import { useRef, useState } from "react";
import { interactionsApi } from "../../api/interactions.api";
import { useToast } from "../../context/ToastContext";
import { pulse } from "../../lib/animations";
import { ApiError } from "../../lib/http";
import type { InteractionValue } from "../../lib/types";
import { Button } from "../ui/Button";

const ACTIONS: { value: InteractionValue; label: string; icon: string; variant: "secondary" | "danger" }[] = [
  { value: 2, label: "Favourite", icon: "\u2605", variant: "secondary" },
  { value: 1, label: "Like", icon: "\u2665", variant: "secondary" },
  { value: -1, label: "Dislike", icon: "\u2716", variant: "danger" },
];

/**
 * Like / dislike / favourite actions (Spec §7).
 *
 * The API has no "what is my current interaction with this profile" read — only a
 * paginated list of my own interactions — so the control reports the value that
 * *this session* just set rather than inventing a pre-existing state. Every click
 * calls the real endpoint and updates immediately, with no page reload.
 */
export function InteractionBar({ targetProfileId }: { targetProfileId: string }) {
  const toast = useToast();
  const [current, setCurrent] = useState<InteractionValue | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  async function apply(value: InteractionValue) {
    setBusy(true);
    try {
      await interactionsApi.set(targetProfileId, value);
      setCurrent(value);
      pulse(rowRef.current);
      toast.success(
        value === 2 ? "Added to favourites." : value === 1 ? "Liked." : "Disliked.",
        "Interaction saved."
      );
    } catch (caught) {
      toast.error("Could not save the interaction", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await interactionsApi.remove(targetProfileId);
      setCurrent(null);
      toast.info("Interaction removed.");
    } catch (caught) {
      toast.error("Could not remove the interaction", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rowRef} className="flex flex-wrap items-center gap-2">
      {ACTIONS.map((action) => (
        <Button
          key={action.value}
          variant={current === action.value ? "primary" : action.variant}
          size="sm"
          loading={busy}
          aria-pressed={current === action.value}
          onClick={() => void apply(action.value)}
        >
          <span aria-hidden="true">{action.icon}</span> {action.label}
        </Button>
      ))}
      {current !== null ? (
        <button
          type="button"
          onClick={() => void clear()}
          className="text-sm text-slate-500 underline-offset-2 hover:underline"
        >
          Clear my interaction
        </button>
      ) : null}
    </div>
  );
}
