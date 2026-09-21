# JibonJori – AI Assisted Matrimony Platform

## Project Overview

JibonJori is an AI-assisted matrimony platform designed to help users create matrimonial profiles, discover compatible partners, communicate, and receive AI-powered matchmaking recommendations.

The project must satisfy the course requirements documented in:

`JibonJori_OpenCode_Spec.md`

That specification is the primary functional reference for the project.

---

# Development Rules

## 1. General Rules

- Do not blindly implement features without understanding the existing architecture.
- Do not make major architectural changes without explaining the reason first.
- Prefer simple, maintainable solutions over unnecessary complexity.
- Do not create duplicate functionality.
- Do not introduce dependencies unless they provide a clear benefit.
- Keep the code modular and maintainable.
- Do not leave known errors or broken functionality behind.
- Do not mark a feature as complete unless it has actually been implemented and verified.

## 2. Planning Before Implementation

Before implementing a major feature:

1. Inspect the existing project structure.
2. Read the relevant documentation.
3. Identify affected frontend, backend, database, and API components.
4. Explain the implementation approach.
5. Identify potential risks or dependencies.
6. Then implement the feature.

Do not immediately start coding large features from a vague request.

---

# Architecture

The planned architecture is:

- Frontend: React.js
- Backend: Node.js + Express.js
- Database: PostgreSQL
- REST API
- GraphQL API
- Firebase Storage
- Google Maps API
- LLM integration
- TensorFlow Lite/on-device ML where appropriate
- Docker
- Git/GitHub

Keep frontend, backend, database, and external-service responsibilities clearly separated.

---

# Frontend Rules

- Use React.js.
- Use Tailwind CSS and Sass.
- Use GSAP for meaningful animations and interactive effects.
- Build responsive interfaces.
- Avoid putting business logic directly inside UI components when it belongs in services/hooks/utilities.
- Reuse components where appropriate.
- Maintain consistent UI patterns.
- Handle loading, empty, error, and success states.
- Validate forms on the client side, but never rely only on client-side validation.

---

# Backend Rules

- Use Node.js with Express.js.
- Keep routes, controllers, services, validation, and database access logically separated.
- Validate all external input.
- Never trust client-provided data.
- Use appropriate HTTP status codes.
- Return consistent API responses.
- Handle errors centrally where practical.
- Do not expose internal errors, secrets, stack traces, or sensitive information to clients.

---

# Database Rules

- Use PostgreSQL.
- Design the database deliberately before implementing complex features.
- Maintain normalized relational data where appropriate.
- Use migrations for schema changes.
- Do not manually modify production/database schemas without documenting the change.
- Use foreign keys and constraints where appropriate.
- Add indexes where they provide meaningful performance benefits.
- Avoid storing derived data unless there is a clear reason.
- Never store plaintext passwords.
- Never store secrets in the database unless properly protected.

Whenever the database schema changes, update the relevant database documentation.

---

# Authentication and Security

The application will support:

- Email verification
- Phone verification
- OTP
- Authentication
- Session management
- Secure logout

Security requirements:

- Never hard-code credentials or API keys.
- Never commit `.env` files.
- Use environment variables for secrets.
- Passwords must be securely hashed.
- Validate and sanitize user input.
- Protect authenticated routes.
- Enforce authorization on the backend.
- Do not expose private user information unnecessarily.
- Validate uploaded files.
- Apply appropriate upload size/type restrictions.

---

# AI and Machine Learning

JibonJori will contain AI-assisted matchmaking functionality.

The system should distinguish between:

1. Deterministic business rules
2. Structured compatibility calculations
3. Machine-learning predictions
4. LLM-generated explanations or assistance

Do not use an LLM for tasks that should be handled by deterministic backend logic.

Do not generate fake AI results using random numbers.

Compatibility scores must be based on meaningful user/profile data.

The LLM chatbot should not directly access unrestricted database data.

Only provide the minimum necessary information to AI services.

API keys for AI services must remain server-side.

---

# Real-Time Features

Potential real-time functionality includes:

- Comments
- Likes/dislikes
- Notifications
- Messaging
- Online status
- Username availability

Use real-time technologies only where they provide actual value.

Do not introduce WebSockets or other real-time infrastructure unnecessarily.

---

# APIs

The project will support both REST and GraphQL.

REST should be used for appropriate conventional API operations.

GraphQL should be introduced where flexible querying provides meaningful value.

Do not duplicate every endpoint unnecessarily across both systems.

Keep API contracts documented.

---

# File and Image Uploads

Profile images and appropriate files will use Firebase Storage.

Rules:

- Validate file type.
- Validate file size.
- Do not trust filenames.
- Do not expose unrestricted storage access.
- Store appropriate metadata/references in PostgreSQL.
- Do not store large binary files directly in PostgreSQL unless there is a specific reason.

---

# Google Maps

Google Maps functionality should be used for meaningful location-related features such as:

- User location
- Location visualization
- Location-based matchmaking

Do not expose API keys unnecessarily.

Do not reveal precise private location information without appropriate user consent.

---

# Reporting

Crystal Reports will be used for relevant reports such as:

- User/profile reports
- Matchmaking reports
- Compatibility reports
- Ratings/interaction reports
- Administrative reports

Reports should use real application data.

Do not create fake/demo report data in the production implementation.

---

# Docker

The application should be containerizable.

Docker configuration should:

- Be reproducible.
- Use environment variables for configuration.
- Avoid storing secrets in images.
- Keep images reasonably small.
- Clearly document how to build and run the project.

---

# Git

Use Git consistently.

Commit messages should describe the actual change.

Prefer focused commits such as:

- `feat: add user authentication`
- `feat: add matrimonial profile`
- `feat: implement compatibility scoring`
- `fix: validate profile image upload`
- `docs: update database architecture`

Do not commit:

- `.env`
- secrets
- credentials
- generated temporary files
- unnecessary build artifacts

---

# Testing and Verification

A feature is not complete merely because the code compiles.

When appropriate:

1. Run the relevant tests.
2. Run type checking.
3. Run linting.
4. Verify database migrations.
5. Test API behavior.
6. Test important UI states.
7. Verify error handling.
8. Verify authentication/authorization.
9. Verify the feature against the requirements specification.

Before declaring a major feature complete, report what was tested.

---

# Course Requirements

The project must intentionally cover the requirements listed in:

`JibonJori_OpenCode_Spec.md`

Important requirements include:

- Real-time commenting
- Like/dislike
- Username availability verification
- Email/phone verification
- Multiple textboxes and dropdowns
- Rating system
- Pagination
- Embedded audio/video
- Google Maps
- Session management
- TensorFlow Lite/on-device ML
- Image/file upload
- Cloud storage
- Date picker
- GSAP/Framer Motion
- Sass/Tailwind CSS
- Git/GitHub
- GraphQL
- REST API
- Crystal Reports
- React
- Docker
- LLM integration
- AI-powered matchmaking

Never claim a requirement is satisfied without verifying the implementation.

---

# Documentation

Maintain useful documentation as the project grows.

Important documentation should include:

- Architecture
- Database/ERD
- API documentation
- Authentication
- AI matchmaking
- Real-time architecture
- Deployment
- Course requirement mapping

Keep documentation synchronized with the actual implementation.

---

# Important Agent Behavior

When uncertain:

- Inspect the code first.
- Read relevant documentation.
- Do not invent existing functionality.
- Do not assume a dependency is installed.
- Do not assume an API exists.
- Do not silently change architecture.
- Explain important trade-offs.

When a request could cause a major architectural change, stop and explain the proposed change before implementing it.

When a task is small and unambiguous, implement it directly.

Always prioritize correctness, maintainability, security, and requirement coverage over speed.