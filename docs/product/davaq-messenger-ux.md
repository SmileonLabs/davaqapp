# DavaQ messenger UX — 2026-09-22

The messenger now uses a compact conversation list and shared chat controls, while retaining DavaQ's Q, exchange cards, friends, invitations, groups, AI permissions and existing voice/video call engine.

## Navigation and reading

- Web viewports at least 960px wide show a 350px conversation sidebar and an embedded Q or ordinary chat. Smaller screens keep the existing full-screen chat routes.
- Search covers room names and the latest message. Unread, group, proposal and ongoing filters remain separate from room categories. Ctrl/Cmd+K focuses search on web.
- New conversation and room settings use consistent, scrollable sheets with accessible close controls. Light and dark themes use the same color tokens.
- Consecutive messages by the same author within five minutes have tighter spacing and fewer repeated avatars. Delivery/read states retain their actual backend meaning.

## Writing and actions

- Drafts are saved locally after 300ms and when leaving a room, keyed by user, active profile and room. Serialized writes prevent a delayed autosave from restoring a sent draft. Empty drafts are removed. This is device-local draft storage, not cross-device draft synchronization.
- The composer retains Korean IME handling, Enter to send, Shift+Enter for a newline, reply preview, stickers, retry/outbox integration and upload cancellation. Attachments share one photo/file menu.
- Supported web browsers size the textarea with CSS field-sizing; other browsers use bounded line-based sizing. Native retains content-size events.
- Long press, web right-click and keyboard context-menu actions expose reply, copy, pin, forward, selection, deletion and five quick reactions. Forwarding has a destination search.

## Responsiveness

- Conversation rows are memoized and virtualized. Search filtering uses a deferred value; proposal lookup uses a map instead of repeated array scans per row.
- Typing state stays inside the composer. Textarea sizing avoids a synchronous layout read on each web keystroke.
- Content/layout updates share one pending scroll operation. Reading an older message or jumping to a quoted/pinned message disables automatic bottom-following; the latest-message button restores it.
- Q's initial scroll no longer waits for an ordinary-room unread snapshot. Typing animation honors reduced-motion preferences and cleans up on unmount.

## Verification

- Mobile TypeScript checks and the 60 reliability tests plus 7 service-worker tests pass, including new draft ordering, ownership separation and storage recovery cases.
- Browser fixture renders the real inbox, Q conversation, ordinary chat and shared components, with synthetic network/auth/call boundaries. Checked 1280px desktop, 390px mobile and 320px narrow layout; opening rooms, draft restoration, sending, attachments, message actions, reply, unread filtering and search.
- The fixture does not establish real voice/video calls or measure device FPS. The existing call transport is unchanged by this release. Real-device keyboard and assistive-technology coverage remain separate from browser checks.
- Production delivery uses a new PWA cache version and verifies the served bundle checksum, API health, authentication boundaries and unchanged AnotherMe containers.
