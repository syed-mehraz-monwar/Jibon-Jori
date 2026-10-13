import { paginationWindow } from "../../lib/format";
import { cn } from "../../lib/cn";

/**
 * Pagination for the shared offset contract (`page`/`limit`/`total`/`totalPages`),
 * documented in `API_DOCUMENTATION.md` §1.7. Only pages that exist are offered,
 * and the control is hidden when there is a single page.
 */
export function Pagination({
  page,
  totalPages,
  total,
  onChange,
  busy,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (totalPages <= 1) {
    return total !== undefined ? (
      <p className="text-sm text-slate-500">{total} result{total === 1 ? "" : "s"}</p>
    ) : null;
  }

  const items = paginationWindow(page, totalPages);

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1 || busy}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
      >
        Previous
      </button>

      {items.map((item, index) =>
        item === "..." ? (
          <span key={`gap-${index}`} className="px-1.5 text-slate-400">
            &hellip;
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            disabled={busy}
            aria-current={item === page ? "page" : undefined}
            className={cn(
              "min-w-9 rounded-lg border px-3 py-1.5 text-sm",
              item === page
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-300 text-slate-700 hover:bg-slate-50"
            )}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages || busy}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
      >
        Next
      </button>

      {total !== undefined ? (
        <span className="ml-1 text-sm text-slate-500">
          Page {page} of {totalPages} &middot; {total} result{total === 1 ? "" : "s"}
        </span>
      ) : null}
    </nav>
  );
}
