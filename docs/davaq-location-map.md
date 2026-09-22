# DavaQ location maps

## User flow

Home and Discover link to /app/map. Users can select a region or explicitly request their current area, then search listing text, type, category and radius (1–50 km). Map panning does not trigger requests until “이 지역 다시 찾기”. Results are ordered by straight-line distance and capped at 80 with a visible notice. Listings at the same coordinate share a selectable popup.

Offline/mixed listing forms have optional map coordinates. Default “동네만 공개” rounds coordinates to two decimal places on both client and server (roughly a kilometer); precise source coordinates are not stored. “만남 장소 공개” is an explicit alternative for an intentionally public venue. Older listings are not geocoded or assigned invented locations. Online listings never expose map coordinates. Owners can remove their location.

Direct proposal terms and each relay leg support a separate participant-only meetingPoint. Changing terms clears existing approvals through the existing versioned acceptance flow. Detail screens offer a map and Kakao Maps directions. Directions are initiated by the user.

Location permission is requested only after pressing the current-area button. There is no background tracking or persisted user-location history. Denial leaves region selection and map navigation available. The registration flow asks users to tap a public area/venue rather than automatically publishing device location.

## API and storage

- GET /api/exchange/map/config: authenticated tile configuration.
- POST /api/exchange/map/search: authenticated, rate-limited coordinate/radius/text filters. Request center is coarsened to two decimals; coordinates are not put in query URLs.
- Migration 0037 adds nullable listing map columns, all-or-none/range/precision constraints and a partial published-coordinate index. No existing listing is backfilled.
- Search combines bounding-box prefilter with clamped Haversine distance and stable distance/id ordering. Drafts, paused, online listings, either direction of a block, and goods held by direct or relay reservations are excluded.
- Public listing DTOs recheck/coarsen coordinates. Private meeting points remain in existing participant-authorized proposal/relay terms; they are never merged into public listing coordinates.

## Rendering and operation

Leaflet 1.9.4 is pinned and copied from the installed package during web builds, including its license. The map lives at /app/maps/map.html in a same-origin iframe or a native WebView. Messages validate source, origin, channel and coordinates. Marker labels use textContent. Leaflet loads only with an opened map, and no tile prefetch/offline download is performed. Service-worker iframe navigation does not fall back to the full app.

Default raster tiles use https://tile.openstreetmap.org/{z}/{x}/{y}.png with visible OpenStreetMap attribution, browser caching and a normal browser referer. Operators can set DAVAQ_MAP_TILE_URL (HTTPS XYZ template) and DAVAQ_MAP_ATTRIBUTION to switch to a compatible provider. Provider-specific required attribution links must also be adapted if replacing OSM. Do not remove attribution or build offline/prefetch functionality against the public OSM service. Review capacity/provider terms as usage grows.

Region selection uses a small predefined set of city/district centers followed by free panning. This release intentionally has no address autocomplete/geocoding service and needs no new external API key.

Web/PWA is the deployed target. Native WebView and foreground Expo Location adapters type-check; a new native binary and physical-device permission testing are required before shipping native apps.

## Verification

Geo schema unit tests cover rounding, coordinate bounds, online/legacy sanitization and bounding-box behavior. Isolated PostgreSQL integration tests cover map auth, persistence, search modes/text/categories, blocks, private meeting point access, renewed consent, reservation exclusions, clearing locations and bounded result counts. Existing messenger, rewards and relay tests run in the same suite. Browser QA uses synthetic local listings/tiles and a denied-location stub, with 320/390px responsive checks, grouped pin selection, detail navigation, region changes, public precision controls and private venue selection. Production is verified read-only after deployment.

References: https://operations.osmfoundation.org/policies/tiles/ ; https://leafletjs.com/reference.html ; https://apis.map.kakao.com/web/guide/
