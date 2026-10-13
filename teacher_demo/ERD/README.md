# ERD — entities and relationships (read this with the diagrams)

Source of truth: `supabase/migrations/20260927000001_foundation.sql`,
`20260927000002_activity.sql`, `20260927000009_ml_artifacts.sql`
(plus CHECK-constraint parity in `...10_...`). Every table and arrow below
exists in those files — nothing invented.

Files: `simplified-erd.svg` (present this one), `complete-erd.svg` (all
17 tables), `simplified-erd.mmd` / `complete-erd.mmd` (Mermaid sources,
viewable at https://mermaid.live), `render-erd.mjs` (dependency-free
generator: `node teacher_demo/ERD/render-erd.mjs`).

## The 5 sentences that explain the whole schema

1. Everything hangs off **`profiles`** — one row per member (`id` = the
   Supabase Auth user id, `username` unique, adult-only `dob`, city/country,
   `is_public`, `role`).
2. **Lookups + link table:** `education_levels`, `professions` (each profile
   points at one of each, RESTRICT so options can't be deleted while used),
   and `interests` joined through **`profile_interests`** — the classic
   many-to-many (one profile has many interests, one interest belongs to many
   profiles).
3. **One-to-one:** each profile has exactly one `partner_preferences` row
   (age range, genders, locations) — shared primary key `profile_id`.
4. **One-to-many activity:** `media`, `interactions` (like −1/1/2/favorite),
   `ratings` (1–5, one per rater pair), `comments`, `notifications`,
   `chat_conversations → chat_messages`, all deleted with the profile
   (CASCADE). `compatibility_scores` caches one row per *unordered* pair
   (`profile_a_id < profile_b_id` enforced in SQL).
5. **Support tables:** `audit_logs` (append-only security log),
   `curated_videos` (YouTube embeds), `ml_artifacts` (the on-device model,
   no FK — standalone).

## Cardinality cheat-sheet (for questions)

| Relationship | Type | How it's enforced |
|---|---|---|
| profiles → partner_preferences | 1 : 1 | PK is also the FK, CASCADE delete |
| profiles → education/profession | N : 1 | nullable FK, RESTRICT delete |
| profiles ↔ interests | N : M | `profile_interests` junction, composite PK |
| profiles → media/interactions/ratings/comments/notifications/conversations | 1 : N | FK with CASCADE delete |
| profile pair → compatibility_scores | 1 : 1 per pair | composite PK + `a < b` CHECK |
| conversations → messages | 1 : N | FK with CASCADE delete |

Say aloud: *"The users table itself lives in Supabase Auth; our `profiles.id`
is the same id, so deleting an auth user cascades through the whole graph."*
