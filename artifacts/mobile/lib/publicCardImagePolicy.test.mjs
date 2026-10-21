import test from "node:test";
import assert from "node:assert/strict";
import {
  publicCardImageSources,
  publicCardImageUri,
  selectPublicCardImageUris,
  CARD_IMAGE_ATTEMPT_TIMEOUT_MS,
} from "./publicCardImagePolicy.ts";
const hash = "a".repeat(64);

test("Korean, US and European cached originals are stable first choices with one optional converter fallback", () => {
  for (const path of [
    "/market/images/kream/" + hash,
    "/api/catalog/images/" + hash,
    "/cardmarket/images/magic/123",
    "/cardmarket/review-images/" + hash,
  ]) {
    const sources = publicCardImageSources(path);
    assert.equal(sources.primary, "https://tcgindex.org" + path);
    assert.equal(sources.kind, "public");
    assert.equal(
      new URL(sources.fallback).searchParams.get("src"),
      sources.primary,
    );
    assert.equal(publicCardImageUri(path), sources.primary);
  }
});
test("relative and absolute forms share the exact cache key", () => {
  const path = "/market/images/kream/" + hash;
  assert.deepEqual(
    publicCardImageSources(path),
    publicCardImageSources("https://tcgindex.org" + path),
  );
});
test("an existing converter source unwraps once instead of nesting another conversion request", () => {
  const original = "https://cards.scryfall.io/normal/front/card.jpg?123";
  const converted =
    "https://tcgindex.org/api/mobile/v1/cards/image?v=2&src=" +
    encodeURIComponent(original);
  assert.deepEqual(publicCardImageSources(converted), {
    kind: "public",
    primary: original,
    fallback: converted,
  });
  assert.equal(
    publicCardImageSources(
      "https://tcgindex.org/api/mobile/v1/cards/image?src=" +
        encodeURIComponent(converted),
    ).kind,
    "missing",
  );
});
test("unsupported external providers load directly rather than waiting on a converter that rejects them", () => {
  assert.deepEqual(
    publicCardImageSources("https://kream-phinf.pstatic.net/image.jpg"),
    { kind: "public", primary: "https://kream-phinf.pstatic.net/image.jpg" },
  );
  assert.equal(
    publicCardImageSources("/api/kream/images/legacy-image").fallback,
    undefined,
  );
});
test("private objects and local previews never become public proxy requests or warmup jobs", () => {
  for (const path of ["/objects/photo", "/objects/photo?ticket=secret"])
    assert.deepEqual(publicCardImageSources(path), {
      kind: "private",
      primary: path,
    });
  for (const uri of [
    "blob:photo",
    "file:///photo.jpg",
    "content://photo/1",
    "data:image/jpeg;base64,AAAA",
  ]) {
    assert.equal(publicCardImageSources(uri).kind, "local");
    assert.equal(publicCardImageUri(uri), uri);
  }
  assert.deepEqual(
    selectPublicCardImageUris([
      "/objects/private",
      "blob:private",
      "https://tcgindex.org/market/images/kream/" + hash,
    ]),
    ["https://tcgindex.org/market/images/kream/" + hash],
  );
});
test("private/member URLs cannot be smuggled through an already proxied source", () => {
  for (const privatePath of [
    "/objects/photo",
    "/api/mobile/v1/images/private",
    "/api/storage/objects/photo",
  ]) {
    assert.equal(
      publicCardImageSources(privatePath).kind,
      privatePath.startsWith("/objects/") ? "private" : "missing",
    );
    assert.equal(
      publicCardImageSources(
        "https://tcgindex.org/api/mobile/v1/cards/image?src=" +
          encodeURIComponent(privatePath),
      ).kind,
      "missing",
    );
  }
  for (const invalid of [
    "http://cards.test/a.jpg",
    "https://secret@cards.test/a.jpg",
    "javascript:alert(1)",
    "https://cards.test/a.jpg#private",
  ])
    assert.equal(publicCardImageSources(invalid).kind, "missing");
});
test("public warmup deduplicates original identities and is bounded to four", () => {
  const first = "/market/images/kream/" + hash;
  const urls = [
    first,
    "https://tcgindex.org" + first,
    ...Array.from(
      { length: 9 },
      (_, index) => "https://cards.test/" + index + ".jpg",
    ),
  ];
  assert.equal(selectPublicCardImageUris(urls).length, 4);
  assert.equal(selectPublicCardImageUris(urls, 100).length, 4);
  assert.deepEqual(selectPublicCardImageUris(urls, 0), []);
  assert.ok(CARD_IMAGE_ATTEMPT_TIMEOUT_MS <= 5000);
});
