import { renderMarkdown } from "../../lib/markdown";
import { cn } from "../../lib/cn";

/**
 * Sanitised Markdown output.
 *
 * The HTML string comes from `lib/markdown.ts`, which runs `DOMPurify` over the
 * `marked` output against an allow-list. This component only inserts that
 * already-sanitised string; no other code path may pass raw HTML here.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = renderMarkdown(source);
  if (!html) return null;

  return (
    <div
      className={cn(
        "jj-markdown text-sm leading-relaxed text-slate-700",
        className
      )}
      // The string is sanitised by DOMPurify in `lib/markdown.ts`; nothing raw
      // from a member ever reaches this component.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
