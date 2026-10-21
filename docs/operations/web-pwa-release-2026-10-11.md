# DavaQ web/PWA release 2026-10-11

Release: `web-20261011-chat-preload`, production `/app/`.

Web deployment completed on the existing DavaQ server. The prior web root was backed up at `/opt/davaq-backups/web-20261011-chat-preload-1791698271.tar.gz`. New hashed assets were copied first, followed by atomic replacement of index.html and sw.js. Existing hashed assets were retained for open browser sessions. API and web container identities/start times were unchanged; API health passed.

Production index SHA-256: `b4c4c54240173b6f398256682a895476b26718344db99fd192e002ae264768b7`. Production HTML hash and service-worker bytes match the local release. Existing public VAPID key was preserved. Temporary CloudShell SSH key and uploaded archive were removed after deployment.

Changes include the current chat preloader, upright empty states, profile/participant avatar navigation, shared profile colors, and narrow-web edge-back transitions with the previous page visible underneath. Desktop embedded conversations keep their split layout.

Validation: typecheck and diff whitespace checks passed; 13 chat-flow, 7 PWA-cache, and 12 notification tests passed. Authenticated production browser verified desktop chat loading, four group participants, and participant profile navigation, with no captured console errors. Real standalone mobile PWA keyboard, background push, live two-user calls, and edge gestures still require device testing; these were not claimed as verified.

Evidence: `evidence/web-release-deployed-20261011.jpg`.
