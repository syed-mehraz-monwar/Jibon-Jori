import { useId, useState } from "react";
import { Markdown } from "./Markdown";
import { Textarea } from "./Textarea";

/**
 * Long-form Markdown field with an Edit / Preview toggle.
 *
 * The source Markdown is what gets stored; the preview is rendered from the same
 * sanitiser the profile view uses, so what a member previews is exactly what
 * others will see.
 */
export function MarkdownField({
  id,
  value,
  onChange,
  rows = 6,
  maxLength,
  placeholder,
  label,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  label: string;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const previewId = useId();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          Supports **bold**, _italic_, lists, quotes and links.
        </span>
        <div role="tablist" aria-label={`${label} mode`} className="flex rounded-lg bg-slate-100 p-0.5">
          {(["edit", "preview"] as const).map((next) => (
            <button
              key={next}
              type="button"
              role="tab"
              aria-selected={mode === next}
              aria-controls={next === "preview" ? previewId : id}
              onClick={() => setMode(next)}
              className={
                mode === next
                  ? "rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
                  : "rounded-md px-3 py-1 text-xs font-medium text-slate-600"
              }
            >
              {next === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {mode === "edit" ? (
        <Textarea
          id={id}
          rows={rows}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={previewId}
        />
      ) : (
        <div
          id={previewId}
          role="tabpanel"
          className="min-h-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <p className="text-sm text-slate-500">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
