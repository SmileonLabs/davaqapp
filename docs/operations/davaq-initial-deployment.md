# DavaQ initial deployment — 2026-09-12

Source: independent private repository SmileonLabs/davaq, forked from AnotherMe
49ca3cd. Local checkout: C:/Users/mirac/Desktop/Projects/davaq.

Public endpoint: https://davaq.anothermeai.app; PWA at /app/.
Host: existing AnotherMe EC2 host 43.203.184.26.
Release: /opt/davaq-release-20260912. Compose project: davaq-prod.
API image: localhost:5000/davaq-api@sha256:4d4770489c9cdc9a0f434033a22f0c28fb633abab3c5c0b54db18af37c301c0c.

## Isolation

- PostgreSQL database and login role: davaq, on the existing RDS instance.
  The role cannot SELECT AnotherMe's public.users table. PUBLIC access is revoked
  on the new database. All 29 committed migrations were applied to the empty DB.
- Initial verification: zero real users, messages, and calls. Only committed
  application seeds were installed; no production data was copied.
- Redis and Neo4j have independent containers, networks and named volumes.
- S3 bucket: davaq-prod-723146859992-ap-northeast-2. The bucket belongs to storage
  account 746491202681, from the existing local production storage configuration.
  A new IAM identity, davaq-prod-storage, is restricted to this bucket. Bucket
  versioning and public-access blocking are enabled. Browser CORS allows only
  https://davaq.anothermeai.app.
- Clerk login identities, OpenAI, LiveKit and Google Search credentials match
  AnotherMe's running API. Provider usage/billing is shared. VAPID and graph/DB
  credentials are separate. Native APK publishing requires new Firebase/EAS setup.

## Routing and recovery

Route 53 public hosted zone Z01175341N99DKI77NV98 contains a new A record
davaq.anothermeai.app → 43.203.184.26, TTL 300. Existing records were preserved.
The existing edge Caddy routes only this hostname to davaq-web:80; its previous
config is /opt/davaq-release-20260912/edge-before-davaq.caddy.
The shared edge was validated and gracefully reloaded. AnotherMe health remained
HTTP 200 before and after activation; its app containers were not replaced.

Only DavaQ's web gateway joins the existing edge Docker network; DavaQ's app,
Redis and graph have no published host ports. Future AnotherMe edge deployments
must retain the DavaQ site block. DavaQ code and data deploy independently.

## Validation

Workspace type checks passed. API tests: 92 passed, two database integration tests
skipped; a single import hook timeout under simultaneous web compilation passed
on isolated retry (7/7). PWA cache/push-owner tests: 7 passed. Sensitive tracked-file
checks passed. Landing, PWA and API builds passed.

Public HTTPS, API health and login screen were checked; unauthenticated /users/me
returns 401. S3 upload/read/delete and a dedicated temporary LiveKit room
create/read/delete passed using the deployed credentials. No other user's room
or object was modified. A real two-user media call and interactive credential
login were not exercised. An additional LiveKit webhook destination can be added
later; the inherited server reconciliation runs independently in DavaQ.
