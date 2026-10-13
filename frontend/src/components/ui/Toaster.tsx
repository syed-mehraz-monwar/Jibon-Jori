import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/cn";

const STYLES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

/** Fixed-position toast stack, fed by `ToastContext`. */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-start justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg",
            STYLES[toast.variant]
          )}
        >
          <div>
            <p className="text-sm font-semibold">{toast.message}</p>
            {toast.detail ? <p className="text-xs opacity-90">{toast.detail}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="text-xs font-medium underline-offset-2 hover:underline"
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
