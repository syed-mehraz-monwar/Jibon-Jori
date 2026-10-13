/**
 * Profile completeness as reported by the server (`profile.completeness`).
 *
 * The value is computed and stored by the backend; the UI only visualises it, so
 * there is a single source of truth and no client-side re-derivation to drift.
 */
export function CompletenessMeter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = clamped >= 80 ? "bg-emerald-500" : clamped >= 50 ? "bg-amber-500" : "bg-brand-500";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">Profile completeness</span>
        <span className="text-slate-500">{clamped.toFixed(0)}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label="Profile completeness"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
