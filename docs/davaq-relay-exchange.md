# 이어 바꾸기

DavaQ offers directed 3–4 person exchange cycles. Each participant gives their own offer to the next person and receives the last person's offer. Intermediate goods are delivered directly to their recipients. This is a candidate discovery and consent workflow; it does not guarantee a match, availability, quality, or fulfillment.

## Entry and flow

Home, My Exchanges, Q search and Q chat link to /relay. The interactive example is explicitly illustrative. Users see their own give/receive outcome before the complete path. /relay/new previews real public offers and collects a schedule and location for each leg. Creating a proposal opens a private group with zero approvals. Every participant must approve the same version; a revision refreshes listing snapshots and clears all approvals.

Only unanimous approval reserves all legs in one transaction. Each provider marks delivery after their agreed start time, and their recipient confirms receipt. All receipts are required for completion. Goods close at completion; services remain reusable. Cancellation after confirmation requires unanimous consent before any delivery. Partial delivery or disagreement uses the operator review queue. Operators must verify returns or an agreed resolution before cancelling a partially delivered chain.

## Isolation and matching

Migration 0036 creates relay proposals, members, reservations and events in the DavaQ database. AnotherMe is unaffected. Authentication is shared as previously configured; relay data stays in DavaQ.

Discovery uses at most 20 own offers, 300 other recent public offers, 24 outgoing candidates per node, 40,000 explored nodes and 12 results. Matching follows wanted categories with text relevance, delivery location and weekday compatibility. Broad category matches remain tentative. Blocks between any participants exclude the entire route. Reserved goods are excluded. Each owner appears once. Q shows actual discovered IDs; it cannot invent offers or consent.

Final approval revalidates listing versions, publication, blocks and all schedules under ordered listing and participant locks. Direct and relay reservations check one another, including goods exclusivity at different times. Creation and actions are idempotent. Participants alone can read and act on a proposal. Shared realtime events refresh relay data and group messages after changes; navigation focus also refreshes it.

## Validation

Unit tests cover directed cycles, nonclosure, distinct owners, eligibility, blocks, geography and weekdays. Isolated PostgreSQL API integration covers three- and four-party fulfillment, competing direct reservations, unique goods, concurrent approval, revisions, stale versions, duplicate requests, nonparticipant access, cancellation, expiry and audited operator resolution. A separate synthetic browser fixture exercises the actual UI without creating production listings, messages or transactions.
