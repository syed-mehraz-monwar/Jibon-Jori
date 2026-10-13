# Phone testing the JibonJori Android APK

Status vocabulary used throughout: **VERIFIED**, **PARTIAL**, **ENVIRONMENT-GATED**,
**BLOCKED**, **NOT VERIFIED**, **NOT APPLICABLE**.

This document describes how to build the Android APK and verify it manually on a
physical phone. Everything it describes is derived from the repository
(`scripts/build-android.mjs`, `package.json`, `capacitor.config.ts`, `android/`) and from
the toolchain that was actually measured on the build machine.

---

## 1. Purpose and scope

**Purpose.** Verify the JibonJori front-end, packaged as an Android APK, on a real
Android phone, against a hosted **Supabase Cloud** project reached over the public
internet. The point of the test is that the **PC is not in the loop**: the phone is on
mobile data (or any Wi-Fi other than the build machine's), the build machine is not
running any backend, and the app must still work.

**In scope.** Building a debug APK; building a (signed) release APK; installing it;
first-launch behaviour; and the manual acceptance checklist in section 7.

**Out of scope.** Configuring the Supabase project itself (schema, Auth, Storage,
Realtime, Edge Functions). See section 9.

The architecture the APK targets is fixed:

- The app is a static React bundle (`vite build --mode phone`) wrapped by Capacitor 6.
- It talks to **Supabase Cloud over HTTPS**. There is no PC backend, no LAN address, no
  Socket.IO, no local PostgreSQL and no Docker dependency at runtime.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are **inlined into the JavaScript at
  build time** and therefore cannot be changed after the APK is built.

---

## 2. Prerequisites

### 2.1 Toolchain on the build machine

These were measured on this machine (`VERIFIED`):

| Tool | Version / location | Status |
| --- | --- | --- |
| Node.js | v24.18.0 (on `PATH`) | VERIFIED |
| npm | 11.16.0 | VERIFIED |
| JDK | Temurin 17.0.19+10 at `C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot` | VERIFIED |
| `JAVA_HOME` (machine env) | `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\` | **BROKEN** - that path does not exist |
| `ANDROID_HOME` | `D:\Zeem\Andrd\sdk` | VERIFIED |
| Android platform | `android-34` | VERIFIED |
| Android build-tools | `34.0.0`, `36.0.0`, `37.0.0` | VERIFIED |
| `adb` | 1.0.41 (37.0.1) at `D:\Zeem\Andrd\sdk\platform-tools\adb.exe` | VERIFIED |
| Gradle wrapper | 8.2.1 | VERIFIED |
| Capacitor | `@capacitor/android` 6.2.2, `@capacitor/cli` 6.2.2 | VERIFIED |
| Android SDK levels | `minSdk 22`, `compileSdk 34`, `targetSdk 34` (`android/variables.gradle`) | VERIFIED |

Run `npm install` in `frontend/` once before any build; the build script fails with an
explicit message if a local binary is missing.

**The broken `JAVA_HOME` and how the script handles it.** `scripts/build-android.mjs`
has a `resolveJavaHome()` step: it trusts `JAVA_HOME` only if that directory actually
contains `bin/java`, and otherwise derives the JDK from whichever `java` the shell
resolves on `PATH`. On this machine `JAVA_HOME` is broken, so the script prints a
`java note` and uses the JDK found on `PATH` for every child process (Gradle, `tsc`,
`vite`, `cap`). This correction applies **only** to the build the script runs. If you
invoke `android/gradlew.bat` by hand, you must set a correct `JAVA_HOME` yourself
(see section 8).

### 2.2 The two public Supabase values

You need exactly two values, both public and both safe to ship in a client:

- **Project URL** - `https://<project-ref>.supabase.co`
- **anon (public) key** - the JWT whose `role` claim is `anon`.

The `service_role` key must **never** be used here. The build refuses a `service_role`
key for debug and release builds alike, because inlining it would hand full database
access (bypassing row level security) to everyone who unzips the APK.

The template is `frontend/.env.phone.example`. Copy it to `frontend/.env.phone.local`
(git-ignored) and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The optional
`VITE_GOOGLE_MAPS_API_KEY` and `VITE_YOUTUBE_VIDEO_IDS` are described in that template.

Resolution order (later wins): CLI flags, then the process environment, then
`.env`, `.env.phone`, `.env.phone.local`.

---

## 3. Build a debug APK

Run from `frontend/`.

**Flag form (no `.env.phone.local` needed):**

```
npm run build:android -- --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>
```

**Environment-file form** (after filling `frontend/.env.phone.local`):

```
npm run build:android
```

**Dry run that writes nothing.** `--print-config` resolves the configuration, runs the
release gate and exits *before* the cleartext config, `.env.phone.local` or any build
tool is touched. Use it to confirm which values would be baked in:

```
npm run build:android -- --print-config --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>
```

For a release-policy dry run, add `--release`:

```
npm run build:android -- --print-config --release --supabase-url https://<project-ref>.supabase.co --anon-key <anon-key>
```

`--print-config` exits `0` when the configuration is acceptable and `2` when the release
gate refuses it.

**Result.** A debug build produces:

```
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 4. Build a release APK (signed)

### 4.1 Create a keystore (once)

```
keytool -genkeypair -v -keystore D:/keys/jibonjori-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jibonjori
```

Keep the keystore safe and backed up: Android identifies an app by its signing key, so
losing it means you can never publish an update to an already-installed app. No script in
this repository creates a keystore, and none is stored in the repository.

### 4.2 Configure signing

Copy `frontend/android/keystore.properties.example` to
`frontend/android/keystore.properties` (git-ignored) and fill in all four keys:

```
storeFile=D:/keys/jibonjori-release.jks
storePassword=<your store password>
keyAlias=jibonjori
keyPassword=<your key password>
```

`storeFile` is resolved relative to `frontend/android/`, but an absolute path (as above)
is equally valid. `*.jks`, `*.keystore` and `keystore.properties` are git-ignored, so
signing material cannot be committed by accident. `android/app/build.gradle` fails loudly
if a value is missing or the keystore file does not exist.

### 4.3 Build

```
npm run build:android:release -- --supabase-url https://<project-ref>.supabase.co
```

The JSON anon key is read from the process environment or `.env.phone.local`. The release
gate (section 4.4, and section 4 of `ANDROID_BUILD_REPORT.md`) must accept the URL, or no
release APK is produced at all.

### 4.4 Debug vs. unsigned release vs. signed release

| Artifact | Path | Distributable | Notes |
| --- | --- | --- | --- |
| Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` | No | Debug key; manual testing only. |
| Unsigned release APK | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | No | Produced when `android/keystore.properties` is **absent**. Android refuses to install it. |
| Signed release APK | `android/app/build/outputs/apk/release/app-release.apk` | **Yes** | Produced when `android/keystore.properties` is **present**. This is the only distributable artifact. |

Only the **signed release APK** may be distributed. The script prints the signing
decision before it runs Gradle and repeats a warning if it produced the unsigned file.

---

## 5. Install on the phone

Ensure the phone has "USB debugging" enabled and is connected by USB, then:

```
D:\Zeem\Andrd\sdk\platform-tools\adb.exe devices
```

The device should appear in the list (accept the "Allow USB debugging" prompt on the
phone if asked). Then install/replace the app:

```
D:\Zeem\Andrd\sdk\platform-tools\adb.exe install -r "D:\Zeem\app\jibon_jori\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
```

For the signed release build, substitute the `release\app-release.apk` path.

**Manual alternative (no USB cable).** Copy the APK to the phone (for example by file
transfer or a download link), open it from the phone's Files app, and allow the browser/
file manager to "install unknown apps" when prompted. Then tap Install.

**Uninstall / clear app data:**

```
adb uninstall com.jibonjori.app
adb shell pm clear com.jibonjori.app
```

`pm clear` wipes the app's stored session without removing the app.

---

## 6. What to expect on first launch

The two Supabase values are inlined at build time, so a normally built APK already
contains them and the very first screen is the public landing page (`/`).

If a bundle is built without them (not possible through `npm run build:android`, which
refuses to build without both values, but possible if a bundle is produced some other
way), the client degrades to an explicit not-configured state rather than a stack trace:
`getSupabase()` throws `ApiError 503 SUPABASE_NOT_CONFIGURED`, `AuthContext` treats the
app as anonymous, and map components render a "Map not configured" state when the
optional `VITE_GOOGLE_MAPS_API_KEY` is absent. The app does not crash.

Because the values are baked in, changing the Supabase project requires **rebuilding the
APK**; there is no runtime setting.

---

## 7. Manual acceptance checklist

All rows below are **UNVERIFIED** until a tester actually performs them against a real
Supabase project on a real phone with no PC in the loop. Rows 9 and 10 require a
**second account**, signed in on a second device or a browser.

| # | Check | How to verify | Expected result | Tester |
| --- | --- | --- | --- | --- |
| 1 | Create account | On `/register`, submit a valid registration | Account is created and the app moves to the verify step (`/verify`) | |
| 2 | Verify email/phone (OTP) | Enter the OTP delivered by Supabase on `/verify` | Verification succeeds and the account can sign in | |
| 3 | Log in | On `/login`, sign in with the verified account | App opens the authenticated shell at `/app` | |
| 4 | Stay authenticated across restart | Fully close (swipe away) and reopen the app | Still signed in; no re-login prompt | |
| 5 | Session refresh | Leave the app idle past the access-token lifetime, then perform an action | The action succeeds; `autoRefreshToken` renews the session with no re-login | |
| 6 | View profile | Open `/app/profile` | Your own profile loads with its data | |
| 7 | Edit profile | Change a field on `/app/profile` and save; then reload | The change persists | |
| 8 | Search | Open `/app/search` and query | Results return, with pagination controls working | |
| 9 | Interact with another account (needs 2nd account) | From account A, like/dislike, comment on, and rate account B's profile (`/app/profiles/:id`) | A's interaction is recorded and visible on B's profile | |
| 10 | Receive a realtime update (needs 2nd account) | With A open, have B post a comment or like, or send a chat message | A's screen updates without a manual reload | |
| 11 | Upload / view media | Upload a profile photo from the profile page; open the learn/watch page | The image is stored in Supabase Storage and displayed; embedded video renders | |
| 12 | Log out | Use log out in the app | The session is cleared and public pages are shown | |
| 13 | Log back in | Sign in again after logging out | The account signs in successfully | |

Record the phone model, Android version and the Supabase project ref alongside the
results. A row is only **VERIFIED** once it has been performed; code inspection alone
does not verify it.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `adb` not found | Use the full path `D:\Zeem\Andrd\sdk\platform-tools\adb.exe`, or add `platform-tools` to `PATH`. |
| Manual `gradlew` fails with a JDK error | `JAVA_HOME` on this machine points at a non-existent path. Set it for the command, e.g. `$env:JAVA_HOME = "C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot"`, or run the build through `npm run build:android`, which corrects it automatically. |
| Gradle fails with "platform not found" | Install it: `sdkmanager "platforms;android-34"`. |
| Gradle fails with "no build-tools" | Install one: `sdkmanager "build-tools;34.0.0"`. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An existing install is signed with a different key (e.g. a debug build is on the phone). Uninstall first: `adb uninstall com.jibonjori.app`, then install again. |
| `--release` build refuses to produce an APK | The release gate rejected the configuration. Read the printed blockers: the URL must be `https://` on a publicly routable host and the anon key must be a JWT with `role: anon`. See section 4 of `ANDROID_BUILD_REPORT.md` for the full reject list. |
| `gradlew.bat` says there is no project | The wrapper must run with `frontend/android` as the working directory; it has no `settings.gradle` at the `frontend/` root. `npm run build:android` already does this. |

---

## 9. What this does NOT verify

Building and installing the APK, and the checklist above, do **not** prove that the
backend is set up. Specifically, none of the following is verified by phone testing:

- that a Supabase Cloud project exists or is reachable;
- that the database **migrations are applied**;
- that **email confirmation** is enabled on the hosted Auth config;
- that the **Storage buckets** exist with the right size and MIME limits;
- that **Realtime** is enabled and its publication configured;
- that the **Edge Functions** are deployed and their secrets set.

Those are Supabase-side concerns documented in **`docs/DEPLOYMENT.md`** (and the
migration documents it links to). The referenced `docs/SUPABASE_CLOUD_SETUP.md` was
created after this section was first written; it now exists and is the step-by-step
dashboard reference. Do not treat a green phone test as proof that the Supabase project is
configured.

---

## Status as of 2026-09-27 (appended)

This document is the checklist for the acceptance test. It has **not** been executed: no APK
configured for a real Supabase project exists, because no project exists. The `test:apk` gate
reports `SKIP` for that reason, and that is the correct outcome.

The test cannot start until these values and settings are supplied - project reference,
Project URL, anon key, service-role key, database password, and the Auth dashboard settings
(*Confirm email* enabled, the confirmation email template carrying `{{ .Token }}`, and
*Site URL* set to a valid value). **Redirect URLs stay empty**: the app confirms signup by
typing a 6-digit code and never starts a redirect flow. `https://localhost` is the Capacitor
WebView **request** origin (a CORS concern), not an Auth redirect target, and must not be
added there. See `docs/SUPABASE_CLOUD_SETUP.md` §2.2 and §8 for exactly where each value
lives.

Once supplied, the build is
`npm run build:android -- --supabase-url https://<REF>.supabase.co --anon-key <anon key>`,
then install with `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`, power the
PC **off**, and run the 20 steps above from mobile data. Only then may
`PHONE-INDEPENDENT BACKEND` change from `NOT VERIFIED` to `VERIFIED`.
