# DavaQ exchange MVP — 2026-09-12
This release replaces the inherited game navigation with Home / Discover / Chat / My AI / My Exchanges.
The separate DavaQ repository, database role/database, Redis, Neo4j and S3 remain independent; only approved authentication/provider credentials are reused.

## Included
- Editable AI registration drafts and manual fallback, owner-scoped image uploads, goods/talents/experiences, offer and wish listings.
- Reciprocal matching with explicit reasons and unresolved constraints; favorite and recommendation feedback.
- Versioned two-person proposals in existing chat, dual acceptance, provider and recipient calendar conflict checks, reservation, fulfillment, mutual receipt, reviews, cancellation and operator review.
- Private 큐 conversations, consent-scoped learning candidates, confirmed memory editing/removal, expiry, event-based growth and opt-in automatic matching.
- DavaQ landing page and responsive light UI based on the approved nine-screen design.

## Verification
- TypeScript checks: shared libraries, API, mobile and landing.
- API regression: 100 passed, 2 skipped.
- Messenger/PWA reliability: 63 passed.
- Isolated real-PostgreSQL integration: 30 checks passed (including two live OpenAI calls); generated schema removed after each run.
- OpenAPI route coverage: 263 source operations checked; documented new DavaQ endpoints included.
- Production web build: landing + Expo PWA completed.
- Live OpenAI draft and personal-agent reply both passed against synthetic test input. Production/browser validation is recorded below after deployment.

## Release boundaries
- Initial release supports two-party exchange. Three/four-party chains and autonomous outreach are not included.
- Confirmed schedule changes use mutual cancellation and a new proposal; editing is available before the original reservation is confirmed.
- EV is a reference preference, with no wallet, payment or conversion.
- Templates are drafting aids, not fabricated live people or inventory.
- Native app-store publication, dedicated Firebase/EAS setup and two-device call testing remain separate from this PWA release.
- Learning defaults off. Only current-user messages in allowed DavaQ conversations are eligible; confirmed memories can be removed.
- Rollback switches the DavaQ image and immutable web roots to the previous environment. New tables remain additive and do not affect the old API.
