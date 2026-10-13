# FRONTEND_DEMO.md — React + TypeScript demonstration

## Start the app

```powershell
cd D:\Zeem\app\jibon_jori\frontend
npm install        # once
npm run dev        # → http://localhost:5173
```

Open `http://localhost:5173` in the browser. The landing page (`/`) loads
without login — the teacher immediately sees a real React app.

## Facts to state (all verified in `frontend/package.json`)

- React **18.3.1**, TypeScript **5.6.2**, Vite **5.4.8**, react-router-dom **6.26.2**,
  Tailwind + Sass, GSAP, `@supabase/supabase-js`.
- `npm run typecheck` → exit 0, `npm run lint` → exit 0,
  `npm run build` → exit 0, `npm test` → **142/142**.

## Files to open (in order, 2 minutes)

1. `frontend/src/main.tsx` — entry point: creates the React root, providers
   (Auth, ReferenceData, Toast), router.
2. `frontend/src/App.tsx` — route table: `/`, `/register`, `/verify`,
   `/login`, `/app/search`, `/app/profile`, … (client-side routing, no reloads).
3. `frontend/src/pages/SearchPage.tsx` — a real page: `useState` for 12 filter
   fields, `useReferenceData` context, `useAsync` + `useDebouncedValue` custom
   hooks, conditional loading/error/empty/success UI.
4. `frontend/src/components/ui/Pagination.tsx` — reusable component with props
   (`page`, `totalPages`, `onChange`).
5. `frontend/src/lib/supabase.ts` — the Supabase client: `createClient(url,
   anonKey)` with persisted auto-refresh sessions; refuses to run unconfigured.

## Say aloud

*"React qualifies as modern because it is component-based — every piece of UI
is a reusable function of props and state. State lives in hooks like
`useState`; shared state in context providers. TypeScript adds compile-time
types, so an entire class of bugs is caught before the browser runs anything —
I can prove that with the typechecker. Routing is client-side, and every byte
of data comes from Supabase over HTTPS; there is no local server."*

## Click path (needs one registered account; register live at `/register` if needed)

`/` → `/login` → `/app` → `/app/search` → `/app/profile`.
If the internet is down: run `npm test` and open `src/pages/SearchPage.tsx` —
tests plus source are genuine evidence, labeled as such.
