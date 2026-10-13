# Android build report

Status vocabulary used throughout: **VERIFIED**, **PARTIAL**, **ENVIRONMENT-GATED**,
**BLOCKED**, **NOT VERIFIED**, **NOT APPLICABLE**.

This report describes the Android build pipeline that exists in the repository, the
results that were actually observed, and the parts that remain unverified. Nothing here
is fabricated: every claim below is either taken from the source files or was measured.

---

## 1. What `npm run build:android` does, in order

`npm run build:android` runs `scripts/build-android.mjs`. `npm run build:android:release`
runs the same script with `--release`. The exact order in the script:

1. **Parse flags** - `--supabase-url`, `--anon-key`, `--print-config`, `--release`. An
   unknown flag is a hard error.
2. **Resolve the Supabase configuration** - CLI flags, then the process environment, then
   `.env`, `.env.phone`, `.env.phone.local` (later wins). The URL is normalised (trailing
   slashes stripped).
3. **Validate presence and shape** - a URL and an anon key are required; the URL must be a
   valid `http(s)://` URL.
4. **Reject privileged keys** - a `service_role` key is refused for **any** build; a key
   whose readable `role` claim is anything other than `anon` is also refused.
5. **Release gate** (`--release` only) - `VITE_SUPABASE_URL` must be `https://` on a
   publicly routable host; the anon key must be a readable JWT with `role: anon`; and the
   main source set's `network_security_config.xml` must deny cleartext. The gate **fails
   closed**: blockers mean no APK at all.
6. **`--print-config` short-circuit** - when set, the script prints the resolved
   configuration and the gate decision and exits (`0` accept, `2` refuse) before writing
   anything or invoking any build tool.
7. **Toolchain checks** - resolves a usable JDK 17+ (correcting a broken `JAVA_HOME`),
   requires `ANDROID_HOME`/`ANDROID_SDK_ROOT`, the required `android-<n>` platform, at
   least one build-tools version, the Gradle wrapper, and `android/app/build.gradle`. A
   missing prerequisite fails with the exact install command.
8. **`local.properties`** - writes `android/local.properties` (`sdk.dir`) if absent
   (git-ignored).
9. **Debug cleartext rewrite** - rewrites the GENERATED-LAN-HOST block in the **debug-only**
   `network_security_config.xml`. With an HTTPS Supabase URL the block is cleared; with a
   plain-HTTP local `supabase start` host, that single host is allowed (debug only).
10. **Write `.env.phone.local`** - the machine-local, git-ignored two public values.
11. **Frontend validation** - `tsc -p tsconfig.json --noEmit`, then `eslint .` (the same
    commands as `npm run typecheck` / `npm run lint`).
12. **React production build** - removes `dist/`, then `vite build --mode phone`.
13. **Verify the values are embedded** - reads the built JS chunks and fails unless the
    Supabase host and the anon key's signature segment are both present.
14. **Capacitor sync** - `cap sync android` copies the web build into the Android project.
15. **Read back the synced config** - confirms `assets/capacitor.config.json` has
    `appId: com.jibonjori.app`, does **not** enable `android.allowMixedContent`, and that
    `assets/public/index.html` exists.
16. **Signing decision** - reads `android/keystore.properties`; present means a signed
    release, absent means an unsigned release. It never creates a keystore.
17. **Gradle assemble** - `assembleDebug` or `assembleRelease` via the wrapper, run with
    `frontend/android` as the working directory.
18. **APK checks** - the output file must exist and be non-empty, start with the zip magic
    `PK\x03\x04`, and contain the entries `AndroidManifest.xml`,
    `assets/public/index.html`, `assets/capacitor.config.json`,
    `res/xml/network_security_config.xml`.
19. **Report** - prints the APK path, size, package id (`com.jibonjori.app`) and variant,
    plus the install command or the unsigned warning.

---

## 2. What was actually executed

### 2.1 Debug APK build (recorded this session)

`npm run build:android` was executed end-to-end successfully with **synthetic placeholder**
Supabase values and produced:

| Item | Value |
| --- | --- |
| Output | `frontend/android/app/build/outputs/apk/debug/app-debug.apk` |
| Size | 4,698,728 bytes (4.48 MiB) |
| Package id | `com.jibonjori.app` |
| Required zip entries confirmed | 4 of 4 - `AndroidManifest.xml`, `assets/public/index.html`, `assets/capacitor.config.json`, `res/xml/network_security_config.xml` |

Because the values were synthetic, the smoke APK was **deleted afterwards**, and the
app's live connectivity to a real Supabase project is therefore **NOT VERIFIED**. As of
this writing only `android/app/build/outputs/apk/debug/output-metadata.json` remains, so
the APK itself is gone.

This establishes that the **toolchain and the build pipeline work**. It does not establish
that the app can reach Supabase over the internet, because no real project credentials
were supplied.

### 2.2 Checks re-run for this report

| Command | Result | Status |
| --- | --- | --- |
| `npm run test:release-gate` | `release gate: 18/18 passed` | VERIFIED |
| `npm run typecheck` (`tsc --noEmit`) | exit `0` | VERIFIED |
| `npm run lint` (`eslint .`) | exit `0` | VERIFIED |

### 2.3 Not executed for this report

- A full APK assembly was **not** re-run while writing this report (the previous smoke APK
  was deleted; a fresh one would require credentials and would re-touch the debug network
  config and `.env.phone.local`).
- No **signed release** build was attempted (no keystore).
- The browser/unit test suites (`npm test`) were not run here.

---

## 3. Toolchain matrix

Measured on the build machine:

| Tool | Version / where found | Status |
| --- | --- | --- |
| Node.js | v24.18.0 (on `PATH`) | VERIFIED |
| npm | 11.16.0 | VERIFIED |
| JDK | Temurin 17.0.19+10 at `C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot` | VERIFIED |
| `JAVA_HOME` (machine env) | `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\` | **BROKEN** - path absent |
| `ANDROID_HOME` | `D:\Zeem\Andrd\sdk` | VERIFIED |
| Android platform | `android-34` | VERIFIED |
| Android build-tools | `34.0.0`, `36.0.0`, `37.0.0` | VERIFIED |
| `adb` | 1.0.41 (37.0.1), `D:\Zeem\Andrd\sdk\platform-tools\adb.exe` | VERIFIED |
| Gradle wrapper | 8.2.1 (`android/gradle/wrapper/gradle-wrapper.properties`) | VERIFIED |
| Capacitor | `@capacitor/android` 6.2.2, `@capacitor/cli` 6.2.2 | VERIFIED |
| Android SDK levels | `minSdk 22`, `compileSdk 34`, `targetSdk 34` (`android/variables.gradle`) | VERIFIED |

---

## 4. The release gate: what is rejected and why

`--release` refuses to build unless all of the following hold. A refusal means **no
release APK is produced at all** (the gate fails closed).

| Rejected input | Why |
| --- | --- |
| `VITE_SUPABASE_URL` not starting with `https://` | A release APK must not carry a cleartext origin. |
| A malformed URL | The host cannot be validated or contacted. |
| Loopback/LAN literal hosts: `localhost`, `127.0.0.1`, `0.0.0.0`, `::`, `::1`, `10.0.2.2` | Unreachable from a phone on the open internet. |
| IPv4 private/reserved ranges: `0/8`, `10/8`, `127/8`, `100.64/10` (CGNAT), `169.254/16` (link-local), `172.16/12`, `192.168/16`, `198.18/19` | Same reason; classified as loopback/LAN. |
| IPv6 link-local `fe80::/10`, unique-local `fc00::/7`, loopback, and IPv4-mapped forms (both dotted `::ffff:a.b.c.d` and hex `::ffff:xxxx:xxxx`) | Mapped forms reach the same place as their IPv4 form, so they are judged by the same rules. |
| A single-label hostname (no dot) | No public DNS zone can resolve it. |
| Reserved suffixes: `.local`, `.localhost`, `.localdomain`, `.lan`, `.internal`, `.home.arpa`, `.test`, `.invalid`, `.example`, `.onion` | Defined local/documentation-only; a phone cannot resolve them. |
| The anon key is not a readable JWT (role claim unknown) | The gate cannot confirm the key is the `anon` key. |
| The main source set's `network_security_config.xml` permits cleartext | A release build must deny cleartext outright. |

Two checks apply to **every** build (debug and release):

| Rejected input | Why |
| --- | --- |
| A `service_role` key | Inlined into the bundle, it would bypass row level security for every installer. |
| A key whose readable `role` claim is not `anon` | The client requires the anon key. |

The regression suite `test-support/release-gate.mjs` exercises these cases by driving the
real script through `--print-config`; it is run with `npm run test:release-gate`. The
observed result of that run is recorded in section 2.2.

---

## 5. Signing status

**NOT VERIFIED.** No release keystore exists and `android/keystore.properties` is absent
(`Test-Path` returns `False`). No keystore or password was created, supplied or fabricated.
Consequently no signed `app-release.apk` has been produced. When a real keystore is
supplied, `android/app/build.gradle` produces a signed APK; without one it produces
`app-release-unsigned.apk`, which Android will refuse to install. See `PHONE_TESTING.md`
section 4 for the keystore procedure.

---

## 6. Known environment issues

1. **Broken `JAVA_HOME`.** The machine environment points `JAVA_HOME` at
   `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot\`, which does not exist. The
   real JDK is `C:\Eclipse Adoptium\jdk-17.0.19.10-hotspot`. `scripts/build-android.mjs`
   detects this (`resolveJavaHome`) and auto-corrects `JAVA_HOME` for the build it runs,
   printing a `java note`. A **manual** `gradlew` invocation does not benefit from this, so
   a manual build needs `JAVA_HOME` set correctly.
2. **Wrapper working directory.** `gradlew.bat` must be invoked with `frontend/android` as
   the working directory; there is no `settings.gradle` at the `frontend/` root. The build
   script already runs Gradle from `android/`.

Contextual, from `docs/DEPLOYMENT.md`: the local Docker daemon is unusable, which blocks
`supabase start` / image builds but not the Android build (the app targets Supabase Cloud
and needs no local container).

---

## 7. Status summary

| Item | Status | Basis |
| --- | --- | --- |
| Android toolchain (JDK 17, SDK, build-tools, Gradle 8.2.1, Capacitor 6, adb) | **VERIFIED** | Measured versions, section 3 |
| Android build pipeline (`scripts/build-android.mjs`) | **VERIFIED** | Debug APK built end-to-end, section 2.1 |
| Release-gate logic and regression suite | **VERIFIED** | `npm run test:release-gate` -> 18/18 passed, section 2.2 |
| Frontend typecheck and lint as run by the build | **VERIFIED** | exit `0`, section 2.2 |
| App's live Supabase connectivity over the internet | **NOT VERIFIED** | No real project credentials supplied; smoke build used synthetic values |
| Distributable signed release APK | **NOT VERIFIED / ENVIRONMENT-GATED** | No keystore supplied; none fabricated |
| Supabase-side setup (migrations, Auth confirmation, Storage, Realtime, Edge Functions) | **NOT VERIFIED** | Out of scope for the build; see `docs/DEPLOYMENT.md` |
| Docker image build | **BLOCKED** | Recorded in `docs/DEPLOYMENT.md`; unrelated to this pipeline |
