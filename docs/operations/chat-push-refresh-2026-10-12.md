# Immediate chat refresh, 2026-10-12

Implemented a session-level room refresh bridge for web service-worker data-changed events and owner-checked iOS/Android foreground message pushes. Native notification taps also start a room refresh before navigation. Closed rooms can now receive latest-window cache data without waiting for bounded preloading or mounting the chat screen.

Room entry requests its latest window independently of persisted cursor hydration. The authoritative reliable query uses staleTime 0 so the projected window cannot suppress contiguous cursor recovery. Latest-window projection never advances receive cursors or marks messages read. It preserves concurrent realtime writes and aborts late writes after route/session cleanup.

Verification: TypeScript and whitespace checks passed. Chat-flow 17, notification 12, native ownership/call/message 40, native configuration plugin 7 tests passed (76 total). New regression coverage includes closed-room population, concurrent realtime writes, cancellation, push bridge cleanup, and starting latest fetch before cursor hydration.

Production web/PWA release web-20261012-chat-resume and Google Play internal testing 1.0.0 (21) are distributed. iOS 1.0.0 (12) archive/export/upload succeeded after recovering from local disk exhaustion. Apple processing and export compliance are complete. Build 12 is linked to DavaQ Internal (3 testers), and App Store Connect confirms Testing. Device-level push timing remains to be verified on the new build; no exact latency target is claimed.

## Resume without tapping notifications

Added session-level cold-start and foreground recovery. Native AppState activation covers app-icon launch and returning from the app switcher. Web/PWA visibilitychange, pageshow, and online events run the same pass while visible. Concurrent wake events share a pass; backgrounding and account/profile cleanup abort it.

The pass fetches the current inbox first, publishes it, then queues every unread room (not only the six preload candidates) plus recent rooms with two workers. Latest-window caching neither marks unread messages read nor advances recovery cursors. Chat entry remains independent of this queue. Typecheck and all 20 chat-flow tests passed, including three new resume queue/cancellation regressions. Web/PWA and Android internal distribution are complete; iOS TestFlight internal distribution is complete; physical-device validation remains pending.

## Desktop scrolling and keyboard layout

Desktop wheel/trackpad input now establishes user scroll intent before inverted-list offset handling. The web message viewport attaches a passive DOM wheel listener because React Native Web does not forward an onWheel prop. This prevents history scrolling from being mistaken for keyboard displacement and snapped back to latest. Native keyboard settled events correct the latest position only when the reader is already following latest. Chat and inbox detail flex parents have minHeight 0. Web/PWA uses visualViewport height for its root, including resume/page-show refresh, while leaving pinch zoom alone.

Current validation: typecheck, whitespace, 21 chat-flow tests and 7 PWA policy tests passed. Production desktop wheel scrolling was exercised in an authenticated conversation, remained at a historical position, and produced no console errors. Physical PWA software-keyboard behavior still needs device confirmation.

Production index SHA-256: 72ff1d6f3257d5362e65fc5e71744ea21e401f0452f60b54e2c6cf50cf5cb764. Deployment retained previous hashed assets, backed up the served web directory, and verified API health without restarting the API.

Android AAB SHA-256: 6a98a3795c53fdf0002a73fdda41e1129e98a8075fad48c9ba5bc4978297c9bd. Package, signing, standalone JavaScript bundle, production login/API settings and 16 KB native alignment checks passed. Google Play confirms internal testers are offered version 21.

Evidence: [desktop scrolling](evidence/web-scroll-fixed-20261012.jpg), [Android internal release](evidence/android-21-internal-20261012.jpg).

TestFlight evidence: [iOS 12 internal testing](evidence/ios-12-internal-20261012.jpg).

## Follow-up: ordinary web message ordering

The earlier wheel-intent patch was insufficient for the reported desktop jitter. Web/PWA now renders chronological, non-inverted FlatList data and computes latest proximity from content height minus viewport height and scrollTop. Latest navigation uses scrollToEnd; scrollbar mapping, chronological grouping and dungeon footer placement follow the ordinary ordering. Native lists retain their inverted ordering. Wheel or pointer intent immediately releases web latest-following; incidental layout offsets do not prematurely release it during initial entry.

Typecheck, whitespace and 22 chat-flow tests passed, including the web bottom-distance/history regression. Release web-20261012-scroll-stable-r2 is deployed with API health and unchanged containers checked. Production authenticated 1280 px desktop verification: initial scrollTop 2064, consecutive upwards 1344 then 624, backwards 1344, stable scrollHeight 2593; no console errors. This supersedes the earlier desktop-scroll result.

Index SHA-256: a1047f4b760757ea8a7d3ce727a78025f2caf1489dc077d9aa761594dca62fec. Backup: /opt/davaq-backups/web-20261012-scroll-stable-r2-1791775120.tar.gz. Temporary CloudShell transfer key and uploaded package removed. Evidence: [stable web scroll](evidence/web-scroll-stable-20261012.jpg).
