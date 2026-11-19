# JibonJori Web Deployment Guide

This guide records how the JibonJori web application is deployed to a static
host and how the deployment is verified.

## 1. Hosting provider

**Vercel** is the selected provider (preferred order: Vercel, Cloudflare Pages,
Netlify; Vercel was chosen first).

The production frontend is a pure static build (`frontend/dist`) produced by
`npm run build` (TypeScript + Vite). There is no server runtime and no first-party
API upstream.

**Current status (2026-11-19):** **DEPLOYED TO PRODUCTION** at
`https://jibon-jori-a88n.vercel.app/` by the project owner; live audit smoke suite passed
**17/17** against the production origin (see `docs/PRODUCTION_ACCEPTANCE_REPORT.md`).
Authentication redirect settings for the production domain must still be completed in the
Supabase dashboard if not already done.

## 2. Repository state

- The existing GitHub repository `syed-mehraz-monwar/Jibon-Jori` is used; the
  production source lives on the `master` branch.
- The Vercel project should be linked to the `frontend/` package with the Vite
  framework preset.

## 3. Vercel configuration

`frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self), payment=()" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://*.gstatic.com https://*.googleapis.com https://*.ggpht.com https://*.supabase.co https://*.supabase.in; font-src 'self' data:; connect-src 'self' https://maps.googleapis.com https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:" }
      ]
    }
  ]
}
```

The SPA rewrite sends every path to `index.html` so client-side routes
(`/app/...`, deep links) resolve on refresh.

The `headers` block applies the same security posture as the nginx static
server (`frontend/nginx.conf`): HSTS (Vercel terminates TLS in production), frame
denial, MIME sniffing protection, referrer policy, permissions policy,
cross-origin isolation and a CSP whose `connect-src` allows the Supabase project
(`https://*.supabase.co` / `wss://*.supabase.co`, plus `*.supabase.in`) for Auth,
Storage and Realtime, and whose `img-src` allows Supabase Storage signed URLs and
the media hosts. Vercel applies these on every response for the project.


## 4. Environment variables

Configured in the Vercel project (Production + Preview), never committed:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://jjbihxtthpclalruepul.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public, RLS-protected) |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps key, if available (referrer-restricted) |
| `VITE_YOUTUBE_VIDEO_IDS` | Curated YouTube ids, if any |

The build inlines `VITE_*` variables at build time, so they must be set before
the production build runs (Vercel does this automatically from project settings).

## 5. Supabase side

- The app uses the existing hosted project directly (no second backend).
- Auth redirect configuration: the Supabase project's Site URL must allow the
  production origin, e.g. `https://<deployed-domain>`; password recovery links
  should point back to the same origin.
- Database migrations are applied through the normal `supabase db push` workflow
  with target-checked history; never `db reset` on the hosted project.

## 6. Deploying

```bash
cd frontend
npm run build      # must pass before deploying
```

Then in the Vercel dashboard: import the Git repository, set the framework to
Vite, confirm build/output settings from `vercel.json`, add the environment
variables above, and deploy the `master` branch.

## 7. Post-deploy checks

1. Open the production URL; the landing page must render.
2. Sign in / register through the browser flow.
3. Open `/app/developer`, `/app/developer/graphql`, `/app/feedback`, `/app/demo`.
4. Confirm the SPA rewrite serves the app on deep links (refresh-safe).
5. Run the browser smoke suite against the production origin.

## 8. Rollback

Revert the commit on `master`; Vercel rebuilds automatically. Static hosting has
no database migration risk, but any applied migration must be reverted separately
through the Supabase workflow if it is ever found to be faulty.
