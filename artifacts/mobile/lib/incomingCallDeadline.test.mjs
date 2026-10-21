import test from "node:test";
import assert from "node:assert/strict";
import {
  incomingCallDeadline,
  incomingCallRemaining,
} from "./incomingCallDeadline.ts";

test("a delayed push preserves the server deadline instead of restarting ringing", () => {
  assert.equal(incomingCallDeadline("46000", 40000), 46000);
  assert.equal(incomingCallRemaining(46000, 40000, 45000), 1000);
  assert.equal(incomingCallRemaining(46000, 40000, 47000), 0);
});
test("duplicates cannot extend the first display window", () => {
  assert.equal(incomingCallRemaining(100000, 1000, 40000), 6000);
});
test("missing legacy deadlines are bounded, explicit malformed deadlines expire", () => {
  assert.equal(incomingCallDeadline(undefined, 1000), 46000);
  for (const value of ["bad", Infinity, -1, 0])
    assert.equal(incomingCallDeadline(value, 1000), 0);
  assert.equal(incomingCallDeadline(9999999, 1000), 46000);
});
