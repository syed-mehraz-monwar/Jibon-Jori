# AGENTS.md – JibonJori

## Repo state
- Spec-only repo. Only source of truth is `JibonJori_OpenCode_Spec.md`.
- No code, manifests, lockfiles, Dockerfiles, CI, or existing instruction files as of 2026-09-21. Do not assume any build/test/lint command works until scaffolding lands.

## Planned stack (from spec – follow unless explicitly overridden)
- Frontend: React + Tailwind CSS + Sass + GSAP
- Backend: Node.js + Express, REST + GraphQL side by side
- DB: PostgreSQL (all app data, comments, likes, ratings, file metadata)
- Storage: Firebase Storage for profile images/files; only metadata/refs in Postgres
- Auth: email/phone OTP verification, secure session management + logout, protected routes
- Maps: Google Maps API, location as matchmaking factor
- Media: YouTube embeds for relationship content
- AI/ML: LLM API for chatbot + matchmaking assist; on-device ML (TensorFlow Lite or equivalent) for compatibility prediction; scored breakdown (personality/interests/education/location)
- Reports: Crystal Reports; Deploy: Docker; VCS: Git/GitHub

## Conventions to enforce when scaffolding
- Separate frontend/backend services for Docker; keep Postgres as single source of truth for queryable data.
- Real-time without reload is a hard requirement: username availability while typing, comments, like/dislike/favorite updates.
- Required course features checklist lives in spec sections "Core Project Goal" + "Course Requirement Coverage" – verify against it, not memory.
- Profiles: text inputs + dropdowns + date picker (DOB), photo upload with validation/access control, partner preferences.
- Search: multi-criteria (age/gender/location/education/profession/interests) + combinable filters + pagination (never load all profiles).
- Styling: responsive desktop/tablet/mobile, GSAP for meaningful animation only.
