import assert from "node:assert/strict";
import { test } from "node:test";
// Node's strip-types runner uses the source extension.
import { attachCallVideoPlayback } from "./callVideoPlayback.ts";

function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    defaultView: window,
  });
  const attributes = new Map<string, string>([["autoplay", ""]]);
  let playCalls = 0;
  let detached = 0;
  let playResult = () => Promise.resolve();
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    autoplay: true,
    muted: false,
    defaultMuted: false,
    playsInline: false,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    play: () => { playCalls += 1; return playResult(); },
  });
  const mediaStreamTrack = new EventTarget();
  const track = {
    mediaStreamTrack,
    attach: () => {},
    detach: () => { detached += 1; },
  };
  const blocked: boolean[] = [];
  const attach = () => attachCallVideoPlayback(
    track as unknown as Parameters<typeof attachCallVideoPlayback>[0],
    element as unknown as HTMLVideoElement,
    { muted: true, onBlocked: (value) => blocked.push(value) },
  );
  return {
    window, document, element, mediaStreamTrack, attributes, blocked, attach,
    setPlay: (next: () => Promise<void>) => { playResult = next; },
    playCalls: () => playCalls,
    detached: () => detached,
  };
}

test("does not force autoplay back on when Safari's SDK intentionally omits it", () => {
  const f = fixture();
  const playback = f.attach();
  assert.equal(f.element.autoplay, false);
  assert.equal(f.attributes.has("autoplay"), false);
  assert.equal(f.element.playsInline, true);
  assert.equal(f.element.muted, true);
  assert.equal(f.element.defaultMuted, true);
  assert.equal(f.playCalls(), 1);
  playback.dispose();
});

test("surfaces blocked playback and permits a direct user-gesture retry", async () => {
  const f = fixture();
  f.setPlay(() => Promise.reject(Object.assign(new Error(), { name: "NotAllowedError" })));
  const playback = f.attach();
  await Promise.resolve();
  assert.deepEqual(f.blocked, [true]);
  f.setPlay(() => Promise.resolve());
  playback.play();
  f.element.dispatchEvent(new Event("playing"));
  assert.deepEqual(f.blocked, [true, false]);
  playback.dispose();
});

test("late failed play from an earlier attempt does not overwrite actual playback", async () => {
  const f = fixture();
  let reject: (error: Error) => void = () => {};
  f.setPlay(() => new Promise((_resolve, fail) => { reject = fail; }));
  const playback = f.attach();
  f.element.dispatchEvent(new Event("playing"));
  reject(Object.assign(new Error(), { name: "NotAllowedError" }));
  await Promise.resolve();
  assert.deepEqual(f.blocked, [false]);
  playback.dispose();
});

test("ignores stream replacement AbortError instead of showing a permissions recovery", async () => {
  const f = fixture();
  f.setPlay(() => Promise.reject(Object.assign(new Error(), { name: "AbortError" })));
  const playback = f.attach();
  await Promise.resolve();
  assert.deepEqual(f.blocked, []);
  playback.dispose();
});

test("foreground and track recovery work, and all callbacks stop after disposal", async () => {
  const f = fixture();
  let reject: (error: Error) => void = () => {};
  const playback = f.attach();
  f.document.visibilityState = "hidden";
  f.window.dispatchEvent(new Event("focus"));
  assert.equal(f.playCalls(), 1);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.mediaStreamTrack.dispatchEvent(new Event("unmute"));
  assert.equal(f.playCalls(), 3);
  f.setPlay(() => new Promise((_resolve, fail) => { reject = fail; }));
  playback.play();
  playback.dispose();
  playback.dispose();
  reject(Object.assign(new Error(), { name: "NotAllowedError" }));
  await Promise.resolve();
  f.window.dispatchEvent(new Event("focus"));
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.mediaStreamTrack.dispatchEvent(new Event("unmute"));
  f.element.dispatchEvent(new Event("playing"));
  playback.play();
  assert.equal(f.playCalls(), 4);
  assert.equal(f.detached(), 1);
  assert.deepEqual(f.blocked, []);
});
