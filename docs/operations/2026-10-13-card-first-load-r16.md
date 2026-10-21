# Home card image first load (r16)

CardArt used to clear its loaded state in a passive effect after a cached image could already have emitted onDisplay. The loading overlay could therefore cover a successfully loaded image. Completion is now tied to the URI and retry attempt, with a fresh keyed component for each card. Both onLoad and onDisplay complete loading; no reset effect races cached image events. Large card images request high priority. A stalled thumbnail falls back to the original after 15 seconds, and a second stall offers manual retry.

Four tests execute the actual component with controlled image callbacks and timers: early cached display, load without display callback, stalled fallback and retry, source-key reset. All passed. TypeScript passed. Android 30 production API/login configuration, signature, SDK 36 and 16 KB alignment checks passed.

Web deployed at /opt/davaq-web-card-r16-6744fe07be20/web-build-card-r16. Prior environment saved at /opt/davaq-backups/before-web-card-r16.env. Existing EIC deployment used; temporary keys removed and security groups unchanged. Browser loaded bundle index-68a16d9586da1dc9b53dfc82f149bd09.js and showed both home hero images after reload; 10/10 DOM image elements loaded and no progress indicators remained. Backend unchanged.

Android 1.0.0 (30), internal release 22, is available to internal testers. iOS 1.0.0 (21) archive and export/upload succeeded. Codesign deep/strict verification passed. CFBundleVersion is 21, DavaqMonoLaunchV2 present, legacy SplashScreen storyboard absent, and bundled loading/retry labels verified. WebRTC/hermes dSYM upload warnings were non-blocking. TestFlight group connection remains unverified because in-app browser CDP commands time out on both existing and fresh App Store Connect tabs; user asked to reopen the page. Physical device cold-launch image behavior remains unverified; this fixes a confirmed code race but does not establish that it was the sole cause of the reported symptom.

Completed DAVAQ local Gradle cache removed only after the signed APK/AAB were preserved and no active Gradle or xcodebuild process remained. Other TCGIndex source and build outputs preserved.

Completed Android app build intermediates removed after release files were preserved and native builds completed. Free space approximately 5 GiB. Signed APK/AAB and iOS archive preserved.

2026-10-13: Browser connection restored through logged-in Chrome. DAVAQ build 21 (a3d5497b-6b45-4676-9e4e-38585f2f0958) processed. Existing standard encryption / France no classification saved. DavaQ Internal group connected (3 testers), test notes saved; screenshot ios-21-internal.png. Previous browser blocker resolved. Physical cold launch verification remains pending.
