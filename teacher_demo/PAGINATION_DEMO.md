# PAGINATION_DEMO.md — server-side pagination, live

## Open (after logging in)

`http://localhost:5173/app/search` → `frontend/src/pages/SearchPage.tsx`
(component `src/components/ui/Pagination.tsx`, data `src/api/search.api.ts`).

## What the teacher sees

- 12 results per page (`PAGE_SIZE = 12`).
- **Previous / Next** buttons + numbered window + *"Page X of Y · N results"*.
- Previous disabled on page 1, Next disabled on the last page (invalid
  navigation impossible); single-page result shows just the count.
- Changing any filter resets to page 1 **but keeps the filters**; the filter
  set is part of every page request.
- Loading spinner, error-with-retry, and empty ("No profiles matched") states.

## Live script (2 minutes)

1. Clear all filters → results load, note *"Page 1 of Y · N results"*.
2. Click **Next** → grid changes to the next 12 (DevTools → Network shows a new
   `search_profiles` RPC with a larger `p_offset`; only 12 rows travel).
3. Click **Previous** → back to page 1, filters untouched.
4. Type a nonsense city → EmptyState with reset button.

## Say aloud

*"Pagination is server-side: the client sends page and limit, the database
function returns just that slice plus the total count — we never download the
whole table. Previous and Next are disabled where they would be invalid, and
the buttons carry the current page for screen readers."*

## Honest note on page counts (read this, don't hide it)

Two visible pages need **13+ public profiles**. If the database currently holds
fewer, say so and show: the `Pagination` control with the real count, the RPC
parameters in DevTools, and the offline unit tests (`rangeFor`/
`paginationFor` math, in `npm test`). To grow real data, register extra
members through `/register` and set their profiles public — normal workflow,
no fake rows, no production data touched.
