# DavaQ (다바꿔)

Independent service forked from SmileonLabs/anotherme at commit 49ca3cd.
The first release preserves the existing messenger application. Barter-specific
workflows are future work.

- URL: https://davaq.anothermeai.app (web messenger at /app/).
- Source repository: SmileonLabs/davaq; no source links to AnotherMe.
- PostgreSQL: a new `davaq` database and `davaq` login role on the existing RDS
  instance. Existing users, conversations and media are not copied.
- Dedicated Redis and Neo4j containers and volumes in Compose project `davaq-prod`.
- Dedicated private object bucket with a bucket-scoped `davaq-prod-storage` IAM identity. Clerk login identities and external API credentials
  are shared by the owner's explicit choice; application profiles and content
  remain separate. Provider quotas and billing remain shared.
- LiveKit rooms use the `davaq_call_` prefix. Configure an additional webhook
  destination at `/api/webhooks/livekit` in LiveKit when provider access is available;
  the inherited polling reconciliation also runs independently.
- Only the web gateway joins the host's existing edge network. Application,
  Redis and graph services have no published host ports.
- Environment secrets are stored only in the deployment `.env`, never committed.

Deploy an immutable source release with its own API image and web outputs, then run
`bash docker/deploy-davaq.sh`. For subsequent schema changes, take and test a DavaQ
database backup first. The old AnotherMe deployment script is historical and must
not be used to deploy DavaQ. Preserve the prior DavaQ source/image/volume mappings
for rollback; do not reverse applied migrations without a reviewed recovery plan.

The host edge Caddyfile includes `docker/edge-davaq.caddy`'s site block. Validate
the combined configuration before a graceful reload. Rollback routing by removing
only that DavaQ block and reloading; this does not stop AnotherMe.

Native APK distribution is disabled for this initial web release. Configure a new
EAS project and Firebase Android/iOS application for DavaQ before native publishing.
