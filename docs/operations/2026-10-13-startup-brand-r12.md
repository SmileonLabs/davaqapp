# DAVAQ startup branding — 2026-10-13

The OS launch screen now stays visible until authentication and the entry redirect have completed. The timed JavaScript startup animation and the white entry loading panel were removed. Font/auth/routing loading screens use the same 240px DAVAQ wordmark on black. Native root windows also use black as their initial background.

All native/PWA icon exports come from `artifacts/mobile/assets/images/davaq/queue.png`; the previous purple icon exporter was replaced. Both the app and landing page use a new, dated PNG favicon URL. Legacy ICO/SVG resources were also updated.

- Web: deployed `/opt/davaq-web-brand-r12-602d87cdeec3/web-build-brand-r12`. Both favicon links and served monochrome image verified in the browser. Health endpoint returned `ok`.
- Android: 1.0.0 (28), Google Play internal testing release 20, available to internal testers. Signing, standalone bundle, production API/login configuration and 16KB ZIP/41 ARM64 library alignment passed. Supported devices unchanged.
- iOS: 1.0.0 (19), archive/export succeeded; TestFlight processing completed and assigned to DavaQ Internal (3 testers). Test notes saved. Build ID: `84aed4bb-ec19-4b52-a726-3be1d8573ff0`. Strict deep signature verification and packaged production API/login checks passed. Native splash images at 1x/2x/3x and app icon were verified monochrome with black backgrounds. Source launch storyboard is black with a 240px centered logo.
- TypeScript and native configuration checks passed. Physical-device cold launch has not been tested.

Release files and hashes: `.local/releases/brand-20261013-r12/release.json`.
Web rollback: `/opt/davaq-backups/before-web-brand-r12.env`.
Landing icon rollback: `/opt/davaq-backups/landing-brand-r12`.
Temporary EC2 Instance Connect key was removed after deployment; security groups were unchanged.

Build storage: previous iOS 17 and uploaded-18 archives are preserved as byte-verified `.xcarchive.tar.gz` backups, with verification/restore records beside them. Reproducible Android preview caches and Gradle dependency/transforms caches were removed after Android 28 was saved and published. The iOS build initially hit disk exhaustion in the app compile step and was restarted using the restored Pods and generated native branding resources.

After upload, the completed DAVAQ Xcode `Build` cache was cleared; Pods and SourcePackages were retained. Available storage returned to approximately 4.5 GiB. iOS 19 remains available locally as a signed `.xcarchive`.
