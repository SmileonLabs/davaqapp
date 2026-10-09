import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callActionDisposition,
  incomingCallExpiry,
} from "./androidCallPolicy.ts";
test("cold start keeps an unexpired action until authentication restores", () => {
  assert.equal(callActionDisposition(null, "A", 2000, 1000), "retain");
  assert.equal(callActionDisposition("A", "A", 2000, 1000), "deliver");
});
test("switched accounts never receive the old owner's action", () => {
  assert.equal(callActionDisposition("B", "A", 2000, 1000), "discard");
});
test("expired or malformed actions cannot be replayed", () => {
  for (const expiry of [999, 1000, NaN, Infinity])
    assert.equal(callActionDisposition(null, "A", expiry, 1000), "discard");
  assert.equal(callActionDisposition("A", "", 2000, 1000), "discard");
});
test("delayed FCM retains only the remaining ring window", () => {
  assert.equal(incomingCallExpiry(1000, 30000), 46000);
  assert.equal(incomingCallExpiry(1000, 46000), null);
  assert.equal(incomingCallExpiry(undefined, 30000), null);
  assert.equal(incomingCallExpiry(1000000, 30000), null);
});
