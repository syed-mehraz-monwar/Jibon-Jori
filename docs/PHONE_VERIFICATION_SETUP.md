# PHONE VERIFICATION SETUP — JibonJori (Supabase SMS OTP)

**Project:** JibonJori — AI-assisted matrimony platform
**Supabase project:** `jjbihxtthpclalruepul` — `https://jjbihxtthpclalruepul.supabase.co`
**Android package:** `com.jibonjori.app`
**SDK:** `@supabase/supabase-js` `2.117.2` (auth-js `2.117.x`) — native SMS OTP supported

---

## 1. What is implemented

The app now uses **Supabase Auth's native phone OTP flow** — no homemade OTP, no local
backend, no custom authentication.

| Concern | Implementation |
|---|---|
| Send OTP | `supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, data } })` |
| Verify OTP | `supabase.auth.verifyOtp({ phone, token, type: "sms" })` |
| Resend OTP | `supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } })` (Supabase enforces its send rate limit) |
| Authoritative verified state | Supabase Auth `auth.users.phone_confirmed_at` (read via `auth.getUser()`); the app mirrors it into `User.phoneVerifiedAt` |
| Bangladesh normalization | `01712345678` / `8801712345678` / `+8801712345678` → `+8801712345678` (`normalizePhoneNumber`) before any request |
| UI states | send / six-digit OTP / verify / resend with cooldown (`RESEND_COOLDOWN_SECONDS = 30`) / loading, error, delivery-notice handling |
| Signup UI | `/register` → phone channel → `/verify` (shared verification screen) → session applied on success |
| Login mapping | unverified phone → actionable `PHONE_NOT_CONFIRMED` message instead of wrong-password |

Email verification (Brevo) is untouched and still uses `signUp` / `verifyOtp({ type: "signup" })` /
`resend({ type: "signup" })`.

## 2. SMS provider selection

**Selected provider: Twilio** (the SMS provider currently supported by Supabase Auth for
phone OTP delivery).

Rationale:

- Supabase Auth's phone OTP documentation lists Twilio as the supported SMS provider.
- Twilio delivers internationally, which covers Bangladeshi `+880` numbers.
- The same credentials can back both the OTP SMS and (optionally) future WhatsApp flows.

## 3. Manual configuration still required (BLOCKED until completed)

The following steps must be performed by an operator with access to the Supabase project
dashboard and the Twilio account. They cannot be completed from this repository.

1. **Supabase Dashboard → Authentication → Providers → Phone**
   - Enable the Phone provider (toggle on).
   - Under SMS provider, configure Twilio with the account SID and auth token
     (or the equivalent credentials Supabase exposes for the SMS provider).
2. **Twilio account**
   - Create/verify a Twilio account with SMS capability.
   - (Optional, recommended) get a Twilio phone number that supports SMS.
   - Check balance/billing; OTP delivery consumes Twilio credits.
3. **Supabase Auth settings**
   - Ensure email confirmation and phone confirmation behaviour are consistent with the
     product (email confirmation remains governed by the Brevo flow).
4. **Supabase project**
   - No schema migration is required: phone state lives in Supabase Auth
     (`auth.users.phone`, `auth.users.phone_confirmed_at`). `profiles` intentionally does
     not duplicate the phone flag; the Auth value is authoritative and the DB-level
     active-member gate (`has_verified_contact`) already ORs email and phone confirmation.

## 4. Security properties

- No homemade OTPs, no OTP storage in the database or client.
- The client never sets or writes a verified flag; only Supabase Auth's OTP verification
  outcome can move a user to verified.
- Normalized phone numbers (`+880…`) are the values sent to Supabase Auth.
- Provider credentials are never requested from app users and never placed in Vite env vars,
  the Android APK or the repository.
- Resend cooldown (30 s) and Supabase send rate limits are in place.
- RLS and existing ownership rules are unchanged.

## 5. Live verification status (as of this pass)

| Check | Status |
|---|---|
| SMS OTP implementation (send / verify / resend, normalization) | **PASS** (automated, mocked) |
| Bangladesh number validation / normalization | **PASS** (automated) |
| Real SMS provider integration | **BLOCKED** — manual Supabase + Twilio dashboard configuration still required |
| Real SMS received | **NOT RUN** — no provider credentials / test number available in this environment |
| Real SMS + correct OTP verification | **NOT RUN** |
| Incorrect OTP rejection | **PASS** (automated) |
| Resend cooldown / abuse handling | **PASS** (automated) |
| Database verification synchronization | **PASS** (design: authoritative `auth.users.phone_confirmed_at`) |
| RLS / security | **PASS** (no RLS changes; no client-set verified flag) |
| Existing email OTP regression | **PASS** (automated) |

Real SMS delivery/verification remains **BLOCKED** until the manual provider steps above are
completed and a real Bangladeshi test number receives a code. Mocked delivery must never be
presented as proof of SMS success.

## 6. Troubleshooting quick reference

- `NO_PROVIDER` delivery reason → no SMS provider configured on the Supabase project yet.
- `DELIVERY_FAILED` → provider attempted and rejected (billing, unverified number, carrier).
- `PHONE_NOT_CONFIRMED` → phone never verified; user must complete the SMS OTP step.
- Supabase send-rate-limit errors → respect cooldown / provider limits; do not bypass.
- Invalid/expired OTP → `INVALID_OTP` mapped by the app; user retries via resend after cooldown.
