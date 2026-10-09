# DavaQ Google Play Android test distribution

## Build

Use `app.davaq.mobile`, versionName `1.0.0`, versionCode `9`, minimum API 26,
and target/compile API 36. iOS settings are unchanged. The first local Play build
contains ARM64 only; expand `-Architectures` when additional ABI testing is available.

1. Configure JDK 17 and an Android SDK with platform/build-tools 36.
2. Supply the existing ignored `google-services.json` for Firebase `davaq-43e77`.
3. Run Expo Android prebuild so the Telecom and upload-signing plugins are applied.
4. Keep the upload keystore and credentials outside tracked source. The local
   `.local-signing/credentials.json` contains `keystorePath`, `keystorePassword`,
   `keyAlias`, `keyPassword`. Back up this directory securely; never commit it.
5. Run `./scripts/build-play.ps1` from PowerShell. Optional `-GradleInitScript`
   supports a workstation toolchain override; `-Architectures` defaults to ARM64.
6. Verify the release APK with:
   `node scripts/verify-android-apk.js android/app/build/outputs/apk/release/app-release.apk 9 --release`
   and `./scripts/verify-android-elf.ps1 -Apk android/app/build/outputs/apk/release/app-release.apk`.
7. Upload the signed `android/app/build/outputs/bundle/release/app-release.aab` to
   the existing Google Play internal release draft. Do not upload the debug APK.

The build script supplies signing values only as process environment variables and
restores them afterward. Release tasks fail without upload signing, including tasks
reached through aggregate Gradle commands. The Expo monorepo bundle entry is passed
as an absolute path, with one Metro worker to keep memory usage bounded.

## Console setup (2026-10-10)

- Developer account: SmileOn Labs, ID `5339000452196792538`.
- App: DavaQ (다바꿔), ID `4975101285636395490`, Korean default language, free app.
- Internal track: `4700858542884065904`.
- Draft release: `1.0.0 (9) - Android internal test`.
- One DavaQ tester list is selected. Six submitted addresses were accepted;
  two were rejected as nonexistent Google accounts. Personal emails stay out of Git.
- Ads declaration: contains ads (brand exchange); advertising ID: not used.
- App creation declarations were explicitly approved by the owner.
- Privacy URL saved in Play Console: https://smileonlabs.github.io/davaqapp/privacy.html
- Account/data deletion instructions: https://smileonlabs.github.io/davaqapp/delete-account.html
- Public support contact: contact@smileon.app; website: https://davaq.anothermeai.app.
- These pages are a static snapshot on the separate `codex/privacy-pages` branch
  with GitHub Pages source `/`. Editable source copies live in `docs/legal`;
  publishing later edits requires updating that branch as well. No app code,
  signing key or private user records are included on the Pages branch.
- Deletion requests currently go to the operating team's mailbox for manual owner
  verification and processing. This is not an automated deletion endpoint.
- Android settings, sign-in and signup link to both public pages; iOS behavior is unchanged.
- Government-app and health-feature declarations are saved as not applicable.

At this checkpoint the signed build/upload and rollout are still pending. A tester
link is not evidence of an active release until Play Console confirms rollout.

## Review and wider release gates

Internal testing is for the invited group; it is not public production approval.
This personal developer account's Console requires a closed test with at least 12
opted-in testers for 14 continuous days before production access can be requested.

Before closed-test review, complete truthful store assets/content declarations,
verified data-retention/processor details and dedicated reviewer login instructions.
The public privacy/deletion pages and Android request links are in place; the
operating team must actually process mailbox requests and retention exceptions. The shared AnotherMe Clerk account must not be deleted merely
to delete DavaQ app data. Determine the accessible inherited wallet/financial
features before completing the financial declaration.

The currently deployed web service and Android test build use the same Clerk
**development** instance. Migrate deliberately to production authentication before
public rollout. Real incoming FCM and two-party calls have not been signed off;
see `davaq-android-native-calling.md`. Do not represent these as fully verified.
