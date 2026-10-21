import test from "node:test";
import assert from "node:assert/strict";
import {
  runScopedMessageBatch,
  groupReactions,
  focusLayout,
  toggleMessageSelection,
} from "./chatInteractionPolicy.ts";
import { shouldCaptureChatEdgeBack } from "./chatEdgeBackPolicy.ts";
test("reactions aggregate all users, mark own code, and do not count duplicate user snapshots", () => {
  assert.deepEqual(
    groupReactions(
      [
        { userId: "a", code: "heart" },
        { userId: "b", code: "heart" },
        { userId: "c", code: "thumb" },
        { userId: "a", code: "heart" },
      ],
      "a",
    ),
    [
      { code: "heart", count: 2, mine: true },
      { code: "thumb", count: 1, mine: false },
    ],
  );
  assert.deepEqual(groupReactions([], "a"), []);
});
test("selection adds, removes and does not mutate prior selection", () => {
  const previous = ["first"];
  assert.deepEqual(toggleMessageSelection(previous, "second"), [
    "first",
    "second",
  ]);
  assert.deepEqual(toggleMessageSelection(previous, "first"), []);
  assert.deepEqual(previous, ["first"]);
});
test("focus preview and action menu remain inside safe areas for tall, low and offscreen messages", () => {
  for (const [width, height] of [
    [320, 568],
    [844, 390],
    [430, 932],
  ]) {
    for (const anchor of [
      undefined,
      { x: -20, y: -100, width: 1000, height: 2000 },
      { x: 300, y: 900, width: 220, height: 80 },
    ]) {
      const l = focusLayout(anchor, width, height, 44, 34);
      assert.ok(l.x >= 12);
      assert.ok(l.x + l.width <= width - 12);
      assert.ok(l.y >= 44);
      assert.ok(l.y + l.previewHeight + 8 + l.menuHeight <= height - 34 - 12);
    }
  }
});
test("background navigation never steals vertical scroll or left reply; center requires background ownership", () => {
  assert.equal(shouldCaptureChatEdgeBack({ x0: 150, dx: 80, dy: 2 }), false);
  assert.equal(
    shouldCaptureChatEdgeBack({ x0: 150, dx: 80, dy: 2 }, true),
    true,
  );
  assert.equal(
    shouldCaptureChatEdgeBack({ x0: 150, dx: -80, dy: 2 }, true),
    false,
  );
  assert.equal(
    shouldCaptureChatEdgeBack({ x0: 150, dx: 15, dy: 50 }, true),
    false,
  );
});

test("batch failure preserves uncommitted selection and retry sends only remaining items", async () => {
  let selected = ["a", "b", "c"],
    fail = true;
  const sent = [];
  const run = () =>
    runScopedMessageBatch({
      items: [...selected],
      isCurrent: () => true,
      send: async (id) => {
        sent.push(id);
        if (id === "b" && fail) throw Error("offline");
      },
      onCommitted: (id) => {
        selected = selected.filter((value) => value !== id);
      },
    });
  await assert.rejects(run(), /offline/);
  assert.deepEqual(selected, ["b", "c"]);
  fail = false;
  assert.equal(await run(), true);
  assert.deepEqual(sent, ["a", "b", "b", "c"]);
  assert.deepEqual(selected, []);
});
test("scope switch during a request cannot alter the new selection or send remaining items", async () => {
  let current = true;
  const sent = [],
    committed = [];
  const done = await runScopedMessageBatch({
    items: ["a", "b"],
    isCurrent: () => current,
    send: async (id) => {
      sent.push(id);
      current = false;
    },
    onCommitted: (id) => committed.push(id),
  });
  assert.equal(done, false);
  assert.deepEqual(sent, ["a"]);
  assert.deepEqual(committed, []);
});
