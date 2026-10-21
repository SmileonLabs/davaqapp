import test from "node:test";
import assert from "node:assert/strict";
import {
  ExchangeImagePreloader,
  selectExchangePhotos,
  shouldPrefetchExchangePage,
  uniqueExchangeItems,
} from "./exchangeFeedPolicy.ts";

const settle = () => new Promise(setImmediate);
function loaderFixture() {
  const calls = [],
    pending = [];
  const load = (source, current) => {
    calls.push(source);
    return new Promise((resolve, reject) =>
      pending.push({ source, current, resolve, reject }),
    );
  };
  return { calls, pending, load };
}

test("image window prioritizes the current and next three cards and retains one previous card", () => {
  const cards = Array.from({ length: 20 }, (_, index) => ({
    photos: [`photo-${index}`, `secondary-${index}`],
  }));
  assert.deepEqual(selectExchangePhotos(cards, 5), [
    "photo-5",
    "photo-6",
    "photo-7",
    "photo-8",
    "photo-4",
  ]);
  assert.deepEqual(selectExchangePhotos(cards, 19), ["photo-19", "photo-18"]);
  assert.deepEqual(selectExchangePhotos(cards, -3), [
    "photo-0",
    "photo-1",
    "photo-2",
    "photo-3",
  ]);
  assert.deepEqual(
    selectExchangePhotos([{ photos: ["same"] }, { photos: ["same"] }, {}], 0),
    ["same"],
  );
  assert.equal(cards[0].photos.length, 2);
});

test("cursor overlap never duplicates a slide and pagination prepares a full next page early", () => {
  const first = { id: "a", value: 1 },
    overlap = { id: "a", value: 2 },
    next = { id: "b" };
  assert.deepEqual(
    uniqueExchangeItems([{ items: [first] }, { items: [overlap, next] }]),
    [first, next],
  );
  assert.equal(shouldPrefetchExchangePage(60, 18, true, false), false);
  assert.equal(shouldPrefetchExchangePage(60, 19, true, false), true);
  assert.equal(shouldPrefetchExchangePage(20, 0, true, false), true);
  assert.equal(shouldPrefetchExchangePage(60, 19, true, true), false);
  assert.equal(shouldPrefetchExchangePage(30, 29, false, false), false);
});

test("a large card catalog resolves only the visible image window when swiping", () => {
  const catalog = Array.from({ length: 10000 }, (_, id) => ({
    card: { imageSrc: `catalog-${id}` },
  }));
  const touched = [];
  const images = selectExchangePhotos(catalog, 5000, (item) => {
    touched.push(item);
    return item.card.imageSrc;
  });
  assert.deepEqual(images, [
    "catalog-5000",
    "catalog-5001",
    "catalog-5002",
    "catalog-5003",
    "catalog-4999",
  ]);
  assert.equal(
    touched.length,
    5,
    "a swipe does not resolve every cached catalog row",
  );
});

test("rapid swipes keep only the latest queued image window and never exceed two downloads", async () => {
  const preloader = new ExchangeImagePreloader(),
    f = loaderFixture();
  preloader.request("me", ["a", "a", "b", "c", "d"], f.load, () => true);
  await settle();
  assert.deepEqual(f.calls, ["a", "b"]);
  preloader.request("me", ["f", "g"], f.load, () => true);
  f.pending[0].resolve(true);
  await settle();
  assert.deepEqual(f.calls, ["a", "b", "f"]);
  f.pending[1].resolve(true);
  await settle();
  assert.deepEqual(f.calls, ["a", "b", "f", "g"]);
  f.pending[2].resolve(true);
  f.pending[3].resolve(true);
  await settle();
  preloader.request("me", ["f", "g"], f.load, () => true);
  await settle();
  assert.equal(f.calls.length, 4);
});

test("backgrounding stops queued work and fences late completions across accounts", async () => {
  const preloader = new ExchangeImagePreloader(),
    f = loaderFixture();
  let active = true;
  preloader.request("old-account", ["a", "b", "c"], f.load, () => active);
  await settle();
  active = false;
  preloader.pause();
  assert.equal(f.pending[0].current(), false);
  f.pending[0].resolve(true);
  f.pending[1].resolve(true);
  await settle();
  assert.deepEqual(f.calls, ["a", "b"]);
  active = true;
  preloader.request("new-account", ["a"], f.load, () => active);
  await settle();
  assert.deepEqual(f.calls, ["a", "b", "a"]);
  f.pending[2].resolve(true);
  await settle();
});

test("failed image retries on a new swipe but does not spin while idle", async () => {
  const preloader = new ExchangeImagePreloader(),
    f = loaderFixture();
  preloader.request("me", ["failed"], f.load, () => true);
  await settle();
  f.pending[0].reject(new Error("offline"));
  await settle();
  assert.deepEqual(f.calls, ["failed"]);
  preloader.request("me", ["failed"], f.load, () => true);
  await settle();
  assert.deepEqual(f.calls, ["failed", "failed"]);
  f.pending[1].resolve(true);
  await settle();
});

test("a late tab warmup cannot replace a claimed visible viewport or its pending image", async () => {
  const preloader = new ExchangeImagePreloader(),
    f = loaderFixture();
  const release = preloader.claim("me");
  preloader.request(
    "me",
    ["visible-20", "next-21", "next-22"],
    f.load,
    () => true,
  );
  await settle();
  preloader.request(
    "me",
    ["first-0", "first-1", "first-2"],
    f.load,
    () => false,
    "warm",
  );
  f.pending[0].resolve(true);
  await settle();
  assert.deepEqual(f.calls, ["visible-20", "next-21", "next-22"]);
  f.pending[1].resolve(true);
  f.pending[2].resolve(true);
  await settle();
  release();
  preloader.request("me", ["first-0"], f.load, () => true, "warm");
  await settle();
  assert.equal(f.calls.at(-1), "first-0");
  f.pending[3].resolve(true);
  await settle();
});

test("releasing an older visible consumer never releases a newer consumer claim", async () => {
  const preloader = new ExchangeImagePreloader(),
    calls = [];
  const load = async (source) => {
    calls.push(source);
    return true;
  };
  const releaseOld = preloader.claim("me"),
    releaseNew = preloader.claim("me");
  releaseOld();
  preloader.request("me", ["first"], load, () => true, "warm");
  await settle();
  assert.deepEqual(calls, []);
  releaseNew();
  preloader.request("me", ["first"], load, () => true, "warm");
  await settle();
  assert.deepEqual(calls, ["first"]);
});

test("completed-image bookkeeping is bounded and expires before signed URLs do", async () => {
  let now = 0;
  const preloader = new ExchangeImagePreloader(2, 2, () => now),
    calls = [];
  const load = async (source) => {
    calls.push(source);
    return true;
  };
  for (const source of ["a", "b", "c"]) {
    preloader.request("me", [source], load, () => true);
    await settle();
  }
  preloader.request("me", ["a"], load, () => true);
  await settle();
  assert.deepEqual(calls, ["a", "b", "c", "a"]);
  preloader.request("me", ["a"], load, () => true);
  await settle();
  assert.equal(calls.length, 4);
  now += 3 * 60_000;
  preloader.request("me", ["a"], load, () => true);
  await settle();
  assert.equal(calls.length, 5);
});
