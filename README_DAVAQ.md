# DavaQ — TCG collector marketplace

DavaQ is a person-to-person TCG card marketplace: private collection, wishlist,
public sale/swap listings, matching notifications, versioned offers, chat and
confirmed delivery/receipt. Generic goods/services barter, relay exchanges, EV,
brand-reward campaigns and their application routes/workers have been removed.
Historical SQL migrations remain immutable; existing historical records are not
silently deleted during the renewal.

## Shared card source

TCGIndex remains the only catalog, image, reference-price and scanner-data source.
DavaQ stores source card identifiers and user-owned inventory/trading records;
it does not run another catalog or price collector. Catalog reads use the existing
TCGIndex mobile API. The imported live scanner uses the original TCGIndex native
recognition pipeline and versioned compact manifests, including foreground and
five-minute refresh. Native scanner code changes require source sync and a new
app build; daily card/price data refresh without reinstalling the app.

- `TCGINDEX_ORIGIN`: defaults to `https://tcgindex.org`.
- `EXPO_PUBLIC_TCGINDEX_ORIGIN`: live scanner data host; same default.
- `TCG_DAVAQ_SHARED_KEY`: matching private, random 32+ character secret in both
  APIs for shared server photo recognition. Never expose it to the client.
- `TCG_AI_MODEL`: optional model for card trading assistance.

TCGIndex integration source: `apps/web/src/lib/davaq-bridge.server.ts`, called by
its existing mobile API. It must be deployed with the shared secret before DavaQ
server photo recognition/card requests can operate. Live native recognition and
public card/price reads do not use this secret.

To refresh native scanner code from the adjacent source checkout:
`python3 scripts/tcg/sync-scanner.py /path/to/tcgindex`.
The import preserves algorithm/native sources and records provenance hashes;
DavaQ adapters cover host routing, localization, registration and Expo file APIs.

## Release

Migration `0040_davaq_tcg` creates the dedicated marketplace tables. Before
cutover, inspect existing live exchanges and reward obligations, back up and test
recovery for the DavaQ database, and arrange their closure/support. The renewal
removes their old application endpoints and is not a transparent rolling upgrade.

Build the API, landing and PWA, deploy the TCGIndex bridge, install the shared
secret on the existing DavaQ server, apply migration and switch the DavaQ release.
Use `docker/deploy-davaq-tcg.py --revision <content-revision>` on the existing
host after staging the verified API/web archives. It checks database isolation,
verifies a PostgreSQL dump, applies migrations and rolls back the service switch
if health verification fails. Archives contain `artifacts/mobile/web-build-tcg`
and `artifacts/landing/dist/public`; build output names must match those paths.
AnotherMe and TCGIndex catalog/collector data must remain separate and unchanged.
Native scanner additions require new Android/iOS binaries and device checks.

No in-app payment or escrow is implemented. Monetary agreement and fulfillment
are separate from payment verification. Operators need verified agreement/return
records before resolving a disputed transaction.

## Production renewal — 2026-10-12

The DavaQ API/database/landing/PWA renewal is deployed at
`https://davaq.anothermeai.app/app/`. API content revision:
`1b0d63031bb3e9ddbb67040a03601a3675f8de2b`. API image digest:
`sha256:4cc376b9f68a68ada59211541d250e9d2321dc87972b529a20a6d32f60e49923`.
The final PWA release is `tcg-20261012-r2`, with archive SHA-256
`0388fc916d5ea2dc74661b79f5b231aba8c8169baa3ec92107bb6b33141bf843`.

Deployment records are on the existing server:
`/opt/davaq-release-20260912/tcg-release-1b0d63031bb3.json` and
`/opt/davaq-release-20260912/tcg-web-release-r2.json`. The verified database
backup is `/opt/davaq-backups/before-tcg-1b0d63031bb3.dump`; environment backups
in the same protected directory preserve the pre-cutover service paths.
The initial audit found no exchange proposals, relay records, brand participation
or brand claims requiring an outstanding-obligation migration.

Production checks confirmed DavaQ health/landing/PWA and TCGIndex health (200),
unauthenticated collection access (401), retired exchange/brand endpoints (404),
11 TCG tables and successful bridge authentication (a missing record returns
404 instead of 401). The existing signed-in browser displayed the real catalog,
card details, reference-price history and collection/wishlist input forms.

TCGIndex uses its existing web and photo-engine images, with narrow bridge and
privacy overlays at `/opt/davaq-tcg-bridge-20261012-r1`. Systemd drop-ins append
the bridge mounts and secret environment file to the existing commands. Preserve
these integration mounts in subsequent TCGIndex patch deployments, or deploy the
equivalent bridge/privacy code already present in the TCGIndex source checkout.
AnotherMe remained healthy throughout the cutover.

Native scanner changes are source-integrated. Android ARM64 scanner-module
assembly and application Kotlin compilation passed; iOS CocoaPods integration
completed with TCGOpenCV, VisionCamera, NitroImage and NitroModules. No physical
Android test device was connected. iOS compilation, physical-device camera
verification and new mobile binary distribution remain outstanding. A new mobile
binary is required for the live camera scanner; server photo recognition is
shared through the authenticated TCGIndex bridge.
