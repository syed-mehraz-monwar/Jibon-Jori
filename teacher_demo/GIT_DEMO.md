# GIT_DEMO.md — Git + modern workflow demonstration

## What to run live (in `D:\Zeem\app\jibon_jori`)

```powershell
git status --short
git log --oneline -10
git branch --show-current
git remote -v
git show --stat HEAD
```

## What the teacher sees (verified 2026-10-14)

- Real repository: `.git/` present, branch `master`.
- Genuine history, oldest first:
  - `f4a5b69 chore: initialize JibonJori project`
  - `7bffe33 docs: add OpenCode project instructions`
  - `85a51cd feat: Supabase-only JibonJori implementation (React client, 15 migrations, 5 edge functions, docs)`
- `git status` is clean after the commits (only gitignored locals remain:
  `supabase.txt`, `frontend/.env.phone.local`, `node_modules/`, `dist/`,
  `*.apk`, keystores).
- `git remote -v` prints **nothing — no remote configured** (nothing has ever
  been pushed; say so openly and see "Adding GitHub" below).
- `git show --stat HEAD` lists the real implementation files committed.

## Say aloud

*"This is a real Git repository. The first commits set up the project, and the
implementation commit adds the React client, the fifteen database migrations
and the five edge functions — about three hundred files, all real work, all
with today's date, nothing fabricated. No remote is configured yet because we
have never pushed; the secrets were never committed, which I can prove with
the gitignore."*

## Prove no secrets are committed

```powershell
git ls-files | Select-String "env|keystore|apk|supabase.txt"   # no output = clean
git log -p --all | Select-String "service_role|sb_secret|AIza" # no output = clean
```

`.gitignore` excludes: `.env*`, `supabase.txt`, `*credentials*.txt`,
`*.apk/*.aab`, `*.jks/*.keystore`, `keystore.properties`, `local.properties`,
`node_modules/`, `dist/`, `coverage/`.

## Modern workflow tools to point at (all in the repo)

| Tool | Evidence |
|---|---|
| npm scripts | `frontend/package.json` (`typecheck`, `lint`, `test`, `build`, `build:android`) |
| Type safety | `npm run typecheck` (tsc, exit 0) |
| Linting | `npm run lint` (eslint, exit 0) |
| Tests | `npm test` — 142 passed, 18 files |
| CI | `.github/workflows/ci.yml` (typecheck+lint+test+edge-function gates) |
| Custom gates | `test:deploy` 16/16, `test:release-gate` 21/21, `test:apk` CLEAN |
| Docs-as-code | `docs/`, course-matrix checker (45/45) |

Run one live for effect: `cd frontend; npm run test:deploy` finishes in seconds.

## Adding GitHub (do this only with the owner's permission)

```powershell
git remote add origin https://github.com/<user>/jibonjori.git
git push -u origin master
```

Safe to push: the Entry-26 audit verified the tracked set contains no
service-role key, DB password, SMTP credential, `.env`, keystore or APK.
