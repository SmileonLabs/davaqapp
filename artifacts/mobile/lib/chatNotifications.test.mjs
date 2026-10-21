import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { shouldClearChatNotification } from "./chatNotificationPolicy.ts";
function fixture(platform) {
  const cancelled = [],
    badges = [],
    ownerWaits = [];
  let owner = "me",
    wait = false;
  const notices = [
    { id: "read", notification: { data: { roomId: "room", messageSeq: "3" } } },
    {
      id: "unread",
      notification: { data: { roomId: "room", messageSeq: "9" } },
    },
    {
      id: "call",
      notification: { data: { roomId: "room", type: "incoming_call" } },
    },
    {
      id: "other-room",
      notification: { data: { roomId: "other", messageSeq: "1" } },
    },
  ];
  const api = {
    getDisplayedNotifications: async () => notices,
    cancelDisplayedNotification: async (...args) => cancelled.push(args),
    setBadgeCount: async (n) => badges.push(n),
  };
  const native = {
    getDeliveredNotifications: async () => notices,
    removeDeliveredNotifications: async (ids) => cancelled.push(ids),
  };
  const out = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("./chatNotifications.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports: out,
      require(name) {
        if (name === "@notifee/react-native") return api;
        if (name === "react-native")
          return {
            Platform: { OS: platform },
            NativeModules: { DavaQSystemCalls: native },
          };
        if (name === "./nativePushOwner")
          return {
            getCurrentNativePushOwner: () =>
              wait
                ? new Promise((resolve) => ownerWaits.push(resolve))
                : Promise.resolve(owner),
          };
        if (name === "./chatNotificationPolicy")
          return { shouldClearChatNotification };
        throw Error(name);
      },
    },
  );
  return {
    out,
    cancelled,
    badges,
    setOwner(v) {
      owner = v;
    },
    delayOwner() {
      wait = true;
    },
    releaseOwners() {
      ownerWaits.forEach((resolve) => resolve(owner));
    },
  };
}
for (const platform of ["ios", "android"])
  test(`${platform}: removes only acknowledged chat notifications via its OS transport`, async () => {
    const f = fixture(platform);
    await f.out.clearChatNotifications("room", {
      readThroughSeq: 3,
      ownerId: "me",
    });
    assert.equal(f.cancelled.length, 1);
    assert.equal(f.cancelled[0][0], "read");
  });
test("a stale account cleanup does not alter device notifications", async () => {
  const f = fixture("ios");
  f.setOwner("new-user");
  await f.out.clearChatNotifications("room", {
    readThroughSeq: 3,
    ownerId: "me",
  });
  assert.equal(f.cancelled.length, 0);
});
test("a slower outdated badge update cannot overwrite the newest unread count", async () => {
  const f = fixture("ios");
  f.delayOwner();
  const first = f.out.syncUnreadNotificationBadge(8, "me"),
    last = f.out.syncUnreadNotificationBadge(2, "me");
  f.releaseOwners();
  await Promise.all([first, last]);
  assert.deepEqual(f.badges, [2]);
});
