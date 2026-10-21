import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- Node type-stripping runner requires the explicit source extension.
import { createToneController } from "./callToneController.ts";

function fixture() {
  let ready!: () => void;
  const preparation = new Promise<void>(resolve => { ready = resolve; });
  const played: number[] = [];
  const disposed: number[] = [];
  const errors: unknown[] = [];
  const tone = createToneController({
    prepare: () => preparation,
    create: (asset: number) => ({ asset, play() { played.push(asset); } }),
    dispose: player => { disposed.push(player.asset); },
    onError: error => { errors.push(error); },
  });
  return { ready, tone, played, disposed, errors };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("tone waits for audio readiness", async () => {
  const f = fixture(); f.tone.start(1);
  assert.deepEqual(f.played, []);
  f.ready(); await settle();
  assert.deepEqual(f.played, [1]);
  f.tone.stop(); assert.deepEqual(f.disposed, [1]);
});
test("accept or cancel during preparation cannot start a stale tone", async () => {
  const f = fixture(); f.tone.start(1); f.tone.stop();
  f.ready(); await settle(); assert.deepEqual(f.played, []);
});
test("replacement call plays only the latest tone", async () => {
  const f = fixture(); f.tone.start(1); f.tone.start(2);
  f.ready(); await settle(); assert.deepEqual(f.played, [2]);
});
test("playback failure disposes the player and reports the error", async () => {
  let removed = 0; const errors: unknown[] = [];
  const tone = createToneController({
    prepare: async () => {},
    create: () => ({ play() { throw new Error("audio unavailable"); } }),
    dispose: () => { removed++; }, onError: error => { errors.push(error); },
  });
  tone.start(1); await settle();
  assert.equal(removed, 1); assert.equal(errors.length, 1);
});
