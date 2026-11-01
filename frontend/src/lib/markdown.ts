import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Safe Markdown rendering for long-form profile text.
 *
 * Two maintained libraries do the work, in this order:
 *   1. `marked` turns the stored Markdown source into HTML.
 *   2. `DOMPurify` sanitises that HTML against an allow-list.
 *
 * The allow-list contains formatting only — no images, no script, no style, no
 * event attributes — so a member cannot smuggle active content into another
 * member's profile view. Links are constrained to `http(s)` and always open with
 * `rel="noopener noreferrer"`, which also covers the Capacitor WebView.
 *
 * The raw HTML produced by `marked` is never inserted into the DOM without
 * passing through `DOMPurify.sanitize`.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

const ALLOWED_ATTR = ["href", "title"];

let hookRegistered = false;

function registerLinkHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    const href = node.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) {
      node.removeAttribute("href");
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  });
}

marked.setOptions({ gfm: true, breaks: true });

/** Markdown source -> sanitised HTML string. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return "";
  registerLinkHook();
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "img"],
    FORBID_ATTR: ["style", "srcset", "onerror", "onload", "onclick"],
  });
}

/** Strip Markdown to plain text, for list previews and meta descriptions. */
export function markdownToPlainText(source: string, maxLength = 240): string {
  const withoutHtml = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[>#\-*+\s]+/gm, " ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutHtml.length > maxLength ? `${withoutHtml.slice(0, maxLength - 1).trimEnd()}…` : withoutHtml;
}
