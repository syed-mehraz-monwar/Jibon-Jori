# REST_API_DEMO.md — one real REST endpoint, live

## The endpoint (PostgREST over Supabase — no local server involved)

- **Method:** GET
- **URL:** `https://jjbihxtthpclalruepul.supabase.co/rest/v1/education_levels?select=slug,label,tier&order=tier`
- **Headers:** `apikey: <anon key>` and `Authorization: Bearer <anon key>`
  (the public anon key — safe for a client; Row Level Security still applies).
- **Verified live 2026-10-14:** `200 OK`, **8 rows** (`Below Secondary` first);
  without the key: **401 Unauthorized**.
## Run it live (key is read from the local config file — never pasted)

```powershell
cd D:\Zeem\app\jibon_jori
$cfg = Get-Content frontend/.env.phone.local
$url = (($cfg | Where-Object { $_ -match 'VITE_SUPABASE_URL' }) -replace '^[^=]*=\s*','').Trim()
$key = (($cfg | Where-Object { $_ -match 'VITE_SUPABASE_ANON_KEY' }) -replace '^[^=]*=\s*','').Trim()
Invoke-RestMethod -Uri "$url/rest/v1/education_levels?select=slug,label,tier&order=tier" `
  -Headers @{ apikey = $key; Authorization = "Bearer $key" } |
  Format-Table slug, label, tier
```

Expected JSON (array of objects):

```json
[
  { "slug": "below-secondary", "label": "Below Secondary", "tier": 1 },
  { "slug": "secondary",       "label": "Secondary",       "tier": 2 }
]
```

## Demonstrate authorization (the impressive part)

```powershell
# No key → must fail closed:
try { Invoke-RestMethod -Uri "$url/rest/v1/education_levels?select=slug" }
catch { $_.Exception.Response.StatusCode.value__ }   # → 401
```

Say aloud: *"The same URL returns real reference data with the public key and
401 without it. Private tables like `profiles` additionally enforce
row-level security per logged-in user, so a forged request fails in the
database, not just in the UI."*

## REST principles to name (one line each)

Resource (`education_levels`) · representation (JSON) · uniform verbs (GET
reads, POST/PATCH/DELETE write under RLS) · stateless (key + optional JWT per
request) · status codes (200/401/…) · filtering/sorting in the URL
(`select=`, `order=`).

## If the internet is down

Show `frontend/src/api/reference.api.ts` (`referenceTable` builds exactly this
GET) plus the captured output above, labeled as previously captured — not live.
