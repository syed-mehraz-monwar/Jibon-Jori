# FORM_DEMO.md — profile form: text boxes + dropdowns + validation

## Open (after logging in)

`http://localhost:5173/app/profile` → component
`frontend/src/components/profile/ProfileForm.tsx` (page: `src/pages/ProfilePage.tsx`).

## What the teacher sees on one screen

**Text inputs:** Display name · Religion · Caste/community · Education detail ·
Profession detail · Income band · City (required) · District · Country ·
Height · *About you* (textarea, max 2000) · **Date picker** for Date of birth.
**Dropdowns (7):** Gender (required) · Marital status · Highest education
(loaded live from `education_levels`) · Profession (live from `professions`) ·
Smoking · Drinking · Diet · Who-can-see-my-photos.
**Toggles:** profile visibility, list-in-discovery.

## Live script (2 minutes)

1. Clear **Display name** → Save → red inline error appears (client validation,
   `lib/validation.ts`), nothing sent.
2. Type a 1-letter name → Save → rejected (server CHECK `2..80` would also
   reject it — validation at two layers).
3. Set **Date of birth** to last year via the date picker → Save → rejected
   (must be 18+; enforced in SQL too: `profiles_adult_only`).
4. Fill Display name + City, pick **Gender**, **Education**, **Profession** →
   Save → success toast, reload the page → values persisted (real UPDATE under RLS).
5. Open DevTools → Network → save again → show the `PATCH /rest/v1/profiles`
   request and its `200` response.

## Say aloud

*"Every field is React state — `useState` per field, dropdown options fetched
from the reference tables, not hardcoded. Validation runs instantly in the
browser for UX, but the database re-checks everything with CHECK constraints,
so a forged request fails too. Saving issues a real PATCH against Supabase."*

## If the internet is down

Open `ProfileForm.tsx` + `lib/validation.ts`, run `npm test -- validation`
(validation unit tests pass offline) — labeled as code evidence, not live.
