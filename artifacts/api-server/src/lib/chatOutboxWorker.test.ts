import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  rows: [] as any[][],
  recipients: { realtimeUserIds: ["alice", "bob"], pushUserIds: ["bob"] },
}));
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  pool: {},
  db: {
    select: () => ({
      from: () => ({ where: async () => fixture.rows.shift() ?? [] }),
    }),
  },
}));
vi.mock("./chatDelivery", () => ({
  getRoomDeliveryRecipients: async () => fixture.recipients,
}));
vi.mock("./push", () => ({ sendPushToUsers: vi.fn(async () => {}) }));
vi.mock("./realtime", () => ({ publishRealtimeEvent: vi.fn(async () => {}) }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { deliverChatJob } from "./chatOutboxWorker";
import { sendPushToUsers } from "./push";
import { publishRealtimeEvent } from "./realtime";
import type { ChatDeliveryJob } from "./chatOutboxStore";
const job = {
  id: "job",
  room_id: "room",
  actor_user_id: "alice",
  audience_user_id: "bob",
  channel: "push",
  payload: { title: "Alice", body: "message", data: { messageId: "message" } },
  attempts: 1,
  claim_token: "claim",
} as ChatDeliveryJob;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.recipients = {
    realtimeUserIds: ["alice", "bob"],
    pushUserIds: ["bob"],
  };
  fixture.rows = [
    [
      { userId: "alice", lastReadSeq: 0 },
      { userId: "bob", lastReadSeq: 0 },
    ],
    [{ id: "message", roomSeq: 10, deletedAt: null }],
    [],
  ];
});
it("delivers one recipient using strict provider error handling", async () => {
  await deliverChatJob(job);
  expect(sendPushToUsers).toHaveBeenCalledWith(["bob"], job.payload, {
    strict: true,
  });
});
it("suppresses delayed notifications after another device has read the message", async () => {
  fixture.rows[0][1].lastReadSeq = 10;
  await deliverChatJob(job);
  expect(sendPushToUsers).not.toHaveBeenCalled();
});
it("suppresses messages deleted for everyone before delivery", async () => {
  fixture.rows[1][0].deletedAt = new Date();
  await deliverChatJob(job);
  expect(sendPushToUsers).not.toHaveBeenCalled();
});
it("suppresses a message personally deleted on another device", async () => {
  fixture.rows[2] = [{ userId: "bob" }];
  await deliverChatJob(job);
  expect(sendPushToUsers).toHaveBeenCalledWith([], job.payload, {
    strict: true,
  });
});
it("rechecks mute and block policy rather than trusting stale queued recipients", async () => {
  fixture.recipients.pushUserIds = [];
  await deliverChatJob(job);
  expect(sendPushToUsers).not.toHaveBeenCalled();
});
it("personal invalidation reaches only the current member, even after blocking the author", async () => {
  fixture.recipients.realtimeUserIds = ["alice"];
  const realtime = {
    ...job,
    channel: "realtime",
    payload: { type: "message.updated", roomId: "room" },
  } as ChatDeliveryJob;
  await deliverChatJob(realtime);
  expect(publishRealtimeEvent).toHaveBeenCalledWith(
    { ...realtime.payload, userIds: ["bob"] },
    { durable: true },
  );
});
