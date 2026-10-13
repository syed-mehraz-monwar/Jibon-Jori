# JibonJori Frontend

The React client for the JibonJori matrimony platform. It talks **directly to
Supabase** — PostgREST for REST, `pg_graphql` for GraphQL, Supabase Auth for
identity, Storage for files and Realtime for live updates. There is no first-party
backend to proxy to, and no server URL other than the Supabase project URL.

This file is the build/run reference. The architecture and the migration record live
in [`../docs/`](../docs).

## Stack

- React 18 + TypeScript 5, bundled by Vite 5
- Tailwind CSS **and** Sass
- GSAP for the deliberate animations
- `@supabase/supabase-js` as the data layer (the api modules wrap it)
- react-router-dom for routing
- Capacitor for the Android wrapper
- Vitest + Testing Library for tests

## Environment

Only `VITE_`-prefixed variables reach the bundle, so nothing here may be a secret.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project URL, e.g. `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | Public anon API key (guarded by RLS) |
| `VITE_GOOGLE_MAPS_API_KEY` | no | Location map/picker; without it the map renders an explicit "not configured" state |
| `VITE_YOUTUBE_VIDEO_IDS` | no | Curated video ids for the learn page |

Copy `.env.example` to `.env.local` and fill it in. **The `service_role` key must
never appear under `frontend/`.**

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Typecheck, then the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest run |
| `npm run verify` | typecheck + lint + build + test + deploy config |
| `npm run test:deploy` | Asserts the nginx/Docker deployment config matches the architecture |
| `npm run build:android` | Android debug APK; add `--release` for a signed release build |

The unit suite runs against an in-memory Supabase double
(`src/__tests__/fake-supabase.ts`), so it needs no project and no credentials.

## Layout

```
src/api/         one module per former REST group; the page-facing contract
src/context/     Auth, ReferenceData, Realtime (SocketContext), Toast providers
src/hooks/       data + realtime hooks
src/lib/         supabase client, graphql transport, realtime adapter, mappers,
                 types, validation, formatting, animations
src/pages/       route components
src/components/  presentation components
```

### The data layer

Pages import from `src/api/*` and never touch `@supabase/supabase-js` directly.
Each api module maps snake_case database rows to the camelCase domain types in
`src/lib/types.ts` (shared row→DTO mappers live in `src/lib/mappers.ts`) and throws
the single `ApiError` contract from `src/lib/http.ts`, so the UI's error branches
are unchanged from the previous architecture.

`src/lib/supabase.ts` owns the one `SupabaseClient` (created lazily) and the
error-mapping/`unwrap`/`callRpc`/`invokeFunction` helpers. `src/lib/realtime.ts`
is a Supabase Realtime adapter that preserves the old socket event surface, so no
component had to change when Socket.IO was removed. `src/lib/graphql.ts` posts to
`pg_graphql`; the reference-data read uses it with a PostgREST fallback, because
`pg_graphql` may be disabled on a given project.

## Android

```bash
npm run build:android -- --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>
```

The Android WebView serves the app from `https://localhost` and reaches the hosted
Supabase project over HTTPS, so the phone needs no PC on the network. A release
build is refused unless the Supabase URL is `https://`.
