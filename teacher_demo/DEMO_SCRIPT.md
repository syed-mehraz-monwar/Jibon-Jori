# DEMO_SCRIPT.md — 5–10 minute live presentation (follow top to bottom)

Preparation (tonight): `cd frontend; npm install`; register one demo account
at `/register` (complete the email OTP); log in once so the session persists;
keep this folder open. Backstop: if the internet fails, use the per-section
offline fallbacks — all are real code/tests, labeled as such.

## 1. ERD (1 min) — open `teacher_demo/ERD/simplified-erd.svg` in the browser

- **Click:** open the SVG; zoom to `profiles` in the centre.
- **See:** 12 boxes, blue FK columns, labeled arrows.
- **Say:** *"Profiles is the heart — one row per member. Lookups on the left,
  one-to-one preferences below, activity like comments and ratings on the
  right, and interests are many-to-many through the junction table. The full
  database is seventeen tables — the complete diagram is in the same folder —
  and every box comes straight from our SQL migrations."*
- **Verify:** arrow labels name real FK columns (`education_id`, `profile_a_id`…).
- **Offline:** unaffected — local files.

## 2. Git (1 min) — terminal in project root

- **Run:** `git log --oneline -5`, `git status --short`, `git remote -v`.
- **See:** three genuine commits with real messages and dates; clean status;
  empty remote output.
- **Say:** *"Real repository, real history — setup, instructions, then the full
  implementation in one honest commit. Nothing pushed yet, which is why there
  is no remote; and our secrets were never committed — the gitignore blocks
  env files, keys and build output."*
- **Verify:** `git show --stat HEAD` lists real source files.
- **Offline:** unaffected.

## 3. React frontend (1.5 min) — browser at `http://localhost:5173`

- **Open:** landing page → `/login` → `/app`.
- **See:** instant client-side navigation, no reloads.
- **Say:** *"React 18 with TypeScript. Everything is a component of props and
  state — hooks for local state, context for the session. TypeScript catches
  type errors before anything runs; our typecheck, lint, build and 142 tests
  are all green."*
- **Verify:** `cd frontend; npm run typecheck` exits 0 (run it live if time).
- **Offline:** `npm run build` + `npm test` still run (local evidence).

## 4. REST API (2 min) — PowerShell (commands in `REST_API_DEMO.md`)

- **Run:** the `Invoke-RestMethod` GET with the file-read key.
- **See:** table of 8 real education levels from the cloud database.
- **Say:** *"One genuine REST call: GET on the education_levels resource,
  JSON back, HTTP 200. Now watch without the key — 401. And private data is
  guarded per-user by database security rules, not just by hiding buttons."*
- **Verify:** status codes + JSON on screen.
- **Offline:** show `reference.api.ts` + previously captured output, labeled.

## 5. Form (2 min) — browser at `/app/profile`

- **Do:** blank Display name → Save (red error) → fill name/city → pick Gender,
  Education, Profession → Save (success toast) → reload (values persist).
- **See:** 10+ text inputs, 7 dropdowns, date picker, inline errors, toast.
- **Say:** *"Every field is React state; dropdown options come from the
  database, not hardcoded lists. The browser validates for speed, the database
  re-validates for safety — try saving a one-letter name or a child's birth
  date and both layers refuse."*
- **Verify:** toast + persisted values + Network tab PATCH 200.
- **Offline:** validation source + `npm test -- validation`.

## 6. Pagination (1.5 min) — browser at `/app/search`

- **Do:** clear filters → Next → Previous → nonsense city.
- **See:** 12 cards, *"Page X of Y · N results"*, disabled buttons at the ends,
  empty state with reset.
- **Say:** *"Server-side pagination — each page fetches only twelve rows with
  an offset; filters survive page changes. If we have fewer than thirteen
  public profiles today you'll see one honest page plus the count, and the
  paging math itself is unit-tested."*
- **Verify:** DevTools shows `p_offset` changing per page.
- **Offline:** `Pagination.tsx` source + pagination unit tests.
