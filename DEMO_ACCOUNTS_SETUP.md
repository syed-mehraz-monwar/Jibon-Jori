# JibonJori Demo Accounts Setup

**Date:** 2026-11-21
**Production URL:** `https://jibon-jori-a88n.vercel.app/`
**Supabase project:** `jjbihxtthpclalruepul` (`https://jjbihxtthpclalruepul.supabase.co`)

## Purpose

This document records the six dedicated fictional demo/test accounts created for the
JibonJori teacher demonstration and acceptance testing.

All accounts are real Supabase Auth identities with real `public.profiles` rows.
They were created through the authorized Supabase Auth Admin API with
`email_confirm = true` and fictional Bangladesh-based profile data. No real user
was modified, deleted, or reset, and no RLS policy was weakened.

## Demo accounts

| # | Display name | Gender | Age (dob) | Username | Email (Gmail plus-alias) | Auth user UUID | Profile status | Login status | Interaction status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Araf Rahman | male | 27 (1998-04-12) | demo_araf | zeemsaneton+demo_araf@gmail.com | f430c46f-4a38-428a-a84e-9441390bf702 | fictional, public, completeness 80 | LOGIN_OK (live) | Like/comment tested |
| 2 | Nabila Ahmed | female | 25 (2001-08-19) | demo_nabila | zeemsaneton+demo_nabila@gmail.com | 39109c73-9482-46c5-a485-d5201c8a98e4 | fictional, public, completeness 80 | LOGIN_OK (live) | Like/comment tested |
| 3 | Sami Hasan | male | 29 (1997-03-30) | demo_sami | zeemsaneton+demo_sami@gmail.com | c0ce02ff-75eb-475c-a88a-36d8b3d1af8d | fictional, public, completeness 80 | LOGIN_OK (live) | Profile/login verified; interactions pending for this pair |
| 4 | Maya Chowdhury | female | 26 (2000-01-22) | demo_maya | zeemsaneton+demo_maya@gmail.com | 92ffe78f-a715-48f8-9433-289fc8a86214 | fictional, public, completeness 80 | LOGIN_OK (live) | Profile/login verified; interactions pending for this pair |
| 5 | Rafi Islam | male | 28 (1998-11-05) | demo_rafi | zeemsaneton+demo_rafi@gmail.com | 2acfe32a-2c00-4e6c-858b-93ce55116ec2 | fictional, public, completeness 80 | LOGIN_OK (live) | Profile/login verified; interactions pending for this pair |
| 6 | Tania Karim | female | 24 (2002-05-14) | demo_tania | zeemsaneton+demo_tania@gmail.com | 10706aaf-42cf-4c68-b21b-29ac1c15354c | fictional, public, completeness 80 | LOGIN_OK (live) | Profile/login verified; interactions pending for this pair |

## Safety and identification rules

- All usernames begin with `demo_` and are distinct from real usernames.
- All profile data is fictional and Bangladesh-based; adults aged 23+.
- No fabricated verification status; admin-confirmed demo identities only.
- No admin privileges were granted to demo accounts.
- No destructive cleanup or reset was performed.

## Local credentials

- Local-only credentials file (outside the repository, never committed):  
  `D:\Zeem\JibonJori-Demo-Accounts.txt`
- Contains: display name, email, username, temporary password, statuses.
- **Passwords are intentionally not recorded here.**

## Teacher demonstration instructions

1. Open `https://jibon-jori-a88n.vercel.app/`.
2. Login with a demo account from the local credentials file.
3. Use the developer hub and demo mode as previously documented.

## Honest limitations

- Authenticated browser E2E, full Discover/likes/comments/reactions via UI, and
  teacher demo delivery were not all executed in this pass; only real Auth login
  and real REST interaction writes were verified (see production acceptance report).
- Feedback migration was not applied during this pass.
- Demo reset function was not deployed during this pass.
