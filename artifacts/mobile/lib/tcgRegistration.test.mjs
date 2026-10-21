import test from "node:test";
import assert from "node:assert/strict";
import {
  registrationId,
  registrationReturnHref,
  registrationCatalogHref,
  registrationOwnedHref,
  withRegistrationItem,
} from "./tcgRegistration.ts";
const target = "11111111-1111-4111-8111-111111111111",
  owned = "22222222-2222-4222-8222-222222222222",
  listing = "33333333-3333-4333-8333-333333333333";

test("registration route identifiers reject arrays, arbitrary links, and malformed UUIDs", () => {
  assert.equal(registrationId(target), target);
  assert.equal(
    registrationId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  for (const value of [
    undefined,
    null,
    [target],
    "https://evil.test",
    "../sell",
    "not-a-uuid",
    target + "&published=evil",
  ])
    assert.equal(registrationId(value), undefined);
  assert.equal(
    registrationCatalogHref("https://evil.test"),
    "/tcg/catalog?publish=1",
  );
  assert.equal(
    registrationReturnHref("https://evil.test", listing),
    `/(tabs)/search?published=${listing}`,
  );
});

test("owned registration continues publication and publication resumes the original offer", () => {
  assert.equal(
    registrationCatalogHref(target),
    `/tcg/catalog?publish=1&offerListing=${target}`,
  );
  assert.equal(
    registrationOwnedHref(true, target, owned),
    `/tcg/sell?collection=${owned}&offerListing=${target}`,
  );
  assert.equal(
    registrationReturnHref(target, listing),
    `/(tabs)/search?offerListing=${target}&offeredListing=${listing}`,
  );
  assert.equal(
    registrationReturnHref(undefined, listing),
    `/(tabs)/search?published=${listing}`,
  );
  assert.equal(
    registrationOwnedHref(false, target, owned),
    `/(tabs)/exchanges?registered=${owned}`,
  );
  assert.equal(registrationReturnHref(target, "invalid"), "/(tabs)/search");
});

test("authoritative registration responses replace duplicates without changing the previous cache", () => {
  const previous = {
    items: [
      { id: owned, quantity: 1 },
      { id: target, quantity: 2 },
    ],
  };
  const next = withRegistrationItem(previous, { id: owned, quantity: 3 });
  assert.deepEqual(next.items, [
    { id: owned, quantity: 3 },
    { id: target, quantity: 2 },
  ]);
  assert.equal(previous.items[0].quantity, 1);
  assert.deepEqual(withRegistrationItem(undefined, { id: listing }).items, [
    { id: listing },
  ]);
});
