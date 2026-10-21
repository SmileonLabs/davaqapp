import test from "node:test";
import assert from "node:assert/strict";
import { visibleReadTarget } from "./chatReadVisibility.ts";
const messages = [{ id: "old", roomSeq: 4 }, { id: "new", roomSeq: 5 }, { id: "temp-x", roomSeq: 0 }];
const active = { active: true, focused: true, ready: true };
test("arrival alone does not read a new row that has not appeared on screen", () => {
  assert.equal(visibleReadTarget(messages, new Set(["old"]), active)?.id, "old");
  assert.equal(visibleReadTarget(messages, new Set(), active), null);
});
test("hidden tab, background app, unfocused conversation and initial layout cannot read", () => {
  for (const field of ["active", "focused", "ready"]) {
    assert.equal(visibleReadTarget(messages, new Set(["new"]), { ...active, [field]: false }), null);
  }
});
test("only confirmed visible rows advance the read cursor", () => {
  assert.equal(visibleReadTarget(messages, new Set(["temp-x"]), active), null);
  assert.equal(visibleReadTarget(messages, new Set(["new", "old"]), active)?.roomSeq, 5);
});
