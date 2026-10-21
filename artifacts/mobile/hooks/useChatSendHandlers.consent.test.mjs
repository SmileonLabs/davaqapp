import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  ChatSendOwnerFence,
  ChatOutboxCapacityError,
} from "../lib/chatOutboxPolicy.ts";

function fixture({ accepted = false, gated = false, os = "android" } = {}) {
  const refs = [],
    states = [],
    calls = [],
    output = {};
  const effects = [], browserEvents = new Map();
  let refCursor = 0,
    stateCursor = 0,
    owner = "owner-a",
    finish;
  const consent = gated
    ? new Promise((resolve) => {
        finish = resolve;
      })
    : Promise.resolve(accepted);
  const react = {
    useCallback: (fn) => fn,
    useEffect(effect) { effects.push(effect); },
    useRef(value) {
      const i = refCursor++;
      return (refs[i] ??= { current: value });
    },
    useState(value) {
      const i = stateCursor++;
      if (!(i in states)) states[i] = value;
      return [
        states[i],
        (value) => {
          states[i] = typeof value === "function" ? value(states[i]) : value;
        },
      ];
    },
  };
  const source = ts.transpileModule(
    readFileSync(new URL("./useChatSendHandlers.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports: output,
    Map,
    Set,
    Date,
    Math,
    AbortController,
    setTimeout,
    clearTimeout,
    document: { addEventListener: (name, callback) => browserEvents.set(name, callback), removeEventListener() {} },
    navigator: { onLine: false },
    require(name) {
      if (name === "react") return { ...react, default: react };
      if (name === "react-native") return { Platform: { OS: os } };
      if (name === "@tanstack/react-query")
        return {
          useQueryClient: () => ({
            setQueryData: (...args) => calls.push({ cache: args }),
            invalidateQueries() {},
          }),
        };
      if (name === "@workspace/api-client-react")
        return {
          getFetchRoomMessagesQueryKey: (room) => [
            "/api/rooms/" + room + "/messages",
          ],
        };
      if (name === "@/lib/chatOutboxPolicy")
        return { ChatSendOwnerFence, ChatOutboxCapacityError };
      if (name === "@/lib/chatMessageOutbox")
        return {
          upsertChatOutboxEntry: async (...args) =>
            calls.push({ outbox: args }),
          tryAcquireChatOutboxDelivery: () => null,
        };
      if (name === "@/lib/uploadImage")
        return {
          ImageTooLargeError: class extends Error {},
          PermissionDeniedError: class extends Error {},
          UploadCancelledError: class extends Error {},
          pickAndUploadImages: async () => {
            calls.push({ picker: "image" });
          },
        };
      if (name === "@/lib/uploadFile")
        return {
          FileTooLargeError: class extends Error {},
          pickAndUploadFile: async () => {
            calls.push({ picker: "file" });
          },
          pickAndUploadVideo: async () => {
            calls.push({ picker: "video" });
          },
        };
      if (name === "@/lib/chatScreenUtils")
        return { replyPreviewFromMessage: () => null, isImageTransferFile: file => file.type?.startsWith("image/"), uploadFileName: () => "photo.jpg", dragEventHasFiles: () => true };
      if (name === "@/lib/chatPerformanceDiagnostics")
        return { noteChatPending() {} };
      if (name === "@/lib/crossAlert")
        return { crossAlert: (...args) => calls.push({ alert: args }) };
      if (
        [
          "@/lib/chatFailedMessagePolicy",
          "@/lib/chatImagePreparation",
          "@/lib/chatTransport",
          "@/lib/chatMessageReliability",
          "@/lib/fileMessage",
        ].includes(name)
      )
        return {};
      throw new Error(name);
    },
  });
  return {
    calls,
    mountBrowserEvents: () => effects.at(-1)(),
    browserEvent: (name, event) => browserEvents.get(name)(event),
    finish: () => finish(true),
    setOwner: (value) => {
      owner = value;
    },
    render() {
      refCursor = stateCursor = 0;
      return output.useChatSendHandlers({
        roomId: "room",
        me: { id: owner },
        senderProfile: { id: "profile" },
        replyTo: { id: "reply" },
        clearReply: () => calls.push({ clearReply: true }),
        clientKeyRef: { current: new Map() },
        forceStickToBottom: () => calls.push({ scroll: true }),
        isDungeon: false,
        beginDungeonThinking() {},
        clearDungeonThinking() {},
        ensureUgcConsent: () => consent,
      });
    },
  };
}
test("declining consent returns false before optimistic cache, outbox writes, or reply clearing", async () => {
  const f = fixture();
  assert.equal(await f.render().sendText("보존할 메시지 초안"), false);
  assert.equal(f.calls.length, 0);
});
test("accepted consent allows normal durable send and keeps the original message body", async () => {
  const f = fixture({ accepted: true });
  assert.equal(await f.render().sendText("보낼 메시지"), true);
  assert.equal(
    f.calls.find((call) => call.outbox).outbox[1].content,
    "보낼 메시지",
  );
  assert.equal(f.calls.filter((call) => call.clearReply).length, 1);
});
test("account change while consent is pending cannot enqueue the previous owner's message", async () => {
  const f = fixture({ gated: true });
  const sending = f.render().sendText("이전 계정 초안");
  f.setOwner("owner-b");
  f.render();
  f.finish();
  assert.equal(await sending, false);
  assert.equal(f.calls.length, 0);
});
test("camera, gallery, file, and video pickers do not run before acceptance", async () => {
  const f = fixture(),
    handlers = f.render();
  await handlers.handlePickImage(false);
  await handlers.handlePickImage(true);
  await handlers.handlePickFile();
  await handlers.handlePickFile("camera");
  assert.equal(f.calls.length, 0);
});
test("pending consent preserves account fence before a system picker is opened", async () => {
  const f = fixture({ gated: true });
  const picking = f.render().handlePickImage(false);
  f.setOwner("owner-b");
  f.render();
  f.finish();
  await picking;
  assert.equal(f.calls.length, 0);
});

test("paste and drop cancel before uploading and never create pending messages", async () => {
  const file = { type: "image/jpeg", name: "photo.jpg" };
  for (const name of ["paste", "drop"]) {
    const f = fixture({ os: "web" }); f.render(); f.mountBrowserEvents();
    f.browserEvent(name, { preventDefault() {}, clipboardData: { items: [{ kind: "file", type: file.type, getAsFile: () => file }] }, dataTransfer: { files: [file] } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
  }
});
test("changing accounts while a pasted attachment awaits consent never starts media preparation", async () => {
  const f = fixture({ os: "web", gated: true }); f.render(); f.mountBrowserEvents();
  f.browserEvent("paste", { preventDefault() {}, clipboardData: { items: [{ kind: "file", type: "image/jpeg", getAsFile: () => ({ type: "image/jpeg" }) }] } });
  f.setOwner("owner-b"); f.render(); f.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
});
