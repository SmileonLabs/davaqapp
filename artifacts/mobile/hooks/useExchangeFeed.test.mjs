import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as policy from "../lib/exchangeFeedPolicy.ts";
import * as cardFeed from "../lib/tcgCardFeed.ts";
import * as publicImages from "../lib/publicCardImagePolicy.ts";

const settle = () => new Promise(setImmediate);
function fixture({
  platform = "web",
  signedIn = true,
  visible = true,
  online = true,
  deferMedia = false,
  deferImage = false,
  feedPage,
  queryData,
} = {}) {
  const effects = [],
    requests = [],
    images = [],
    media = [],
    releases = [],
    cache = new Map();
  const pendingMedia = [];
  const pendingImages = [];
  let captured,
    nextPageRequests = 0;
  const cards = Array.from({ length: 4 }, (_, i) => ({
    id: `kream:${i}`,
    card: {
      id: `kream:${i}`,
      saveId: `kream:${i}`,
      title: `Card ${i}`,
      imageSrc: `/objects/${i}`,
      gameCode: "pokemon",
      amount: null,
    },
    available_listing_count: 0,
    available_listings: [],
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    owned_by_me: false,
  }));
  const key = (value) => JSON.stringify(value);
  const client = {
    getQueryData: (queryKey) => cache.get(key(queryKey)),
    fetchQuery: async (options) => {
      const cacheKey = key(options.queryKey);
      if (!cache.has(cacheKey)) cache.set(cacheKey, options.queryFn());
      return cache.get(cacheKey);
    },
    prefetchInfiniteQuery: async (options) => {
      captured = options;
      const page = await options.queryFn({
        pageParam: undefined,
        signal: new AbortController().signal,
      });
      cache.set(key(options.queryKey), { pages: [page] });
    },
  };
  const output = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("./useExchangeFeed.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: output,
      AbortController,
      URLSearchParams,
      Promise,
      Date,
      document: {
        visibilityState: visible ? "visible" : "hidden",
        addEventListener() {},
        removeEventListener() {},
      },
      navigator: { onLine: online },
      window: { addEventListener() {}, removeEventListener() {} },
      require(name) {
        if (name === "react")
          return {
            useEffect: (fn) => effects.push(fn),
            useMemo: (fn) => fn(),
            useRef: (value) => ({ current: value }),
            useState: (value) => [
              platform !== "web" && value === false
                ? online
                : typeof value === "function"
                  ? value()
                  : value,
              () => {},
            ],
          };
        if (name === "react-native")
          return {
            Platform: { OS: platform },
            AppState: {
              currentState: visible ? "active" : "background",
              addEventListener: () => ({ remove() {} }),
            },
          };
        if (name === "@react-native-community/netinfo")
          return { default: { addEventListener: () => () => {} } };
        if (name === "@tanstack/react-query")
          return {
            useQueryClient: () => client,
            useInfiniteQuery: (options) => {
              captured = options;
              return {
                data: queryData,
                hasNextPage: !!queryData?.pages.at(-1)?.nextCursor,
                isFetching: false,
                fetchNextPage: async () => {
                  nextPageRequests++;
                },
              };
            },
          };
        if (name === "@workspace/api-client-react")
          return {
            customFetch: async (url, options) => {
              requests.push({ url, options });
              return feedPage ?? { items: cards, nextCursor: "next" };
            },
          };
        if (name === "expo-image")
          return {
            Image: {
              prefetch: async (uri, options) => {
                images.push({ uri, options });
                if (deferImage)
                  await new Promise((resolve) => pendingImages.push(resolve));
                return true;
              },
            },
          };
        if (name.includes("davaqAuth"))
          return {
            useAuth: () => ({
              userId: signedIn ? "me" : null,
              isSignedIn: signedIn,
            }),
          };
        if (name.includes("useMediaUri"))
          return {
            resolveMediaUri: async (path) => {
              media.push(path);
              if (deferMedia)
                await new Promise((resolve) => pendingMedia.push(resolve));
              return `https://signed.test${path}`;
            },
          };
        if (name.includes("chatBrowserMediaCache"))
          return {
            setBrowserMediaOwner() {},
            acquireBrowserPhoto: async (owner, path, resolve) => {
              const uri = await resolve();
              images.push({ owner, path, uri });
              return { uri, release: () => releases.push(path) };
            },
          };
        if (name.includes("exchangeFeedPolicy")) return policy;
        if (name.includes("publicCardImagePolicy")) return publicImages;
        if (name.includes("tcgCardFeed")) return cardFeed;
        throw Error(name);
      },
    },
  );
  return {
    output,
    client,
    cache,
    cards,
    requests,
    images,
    media,
    releases,
    pendingMedia,
    pendingImages,
    options: () => captured,
    nextPageRequests: () => nextPageRequests,
    flush: () => effects.splice(0).map((effect) => effect()),
  };
}

test("feed reads are account-scoped and cursor/search parameters are encoded with cancellation", async () => {
  const f = fixture();
  f.output.useExchangeFeed("a+b", "game:card/1");
  const options = f.options(),
    signal = new AbortController().signal;
  assert.deepEqual(Array.from(options.queryKey), [
    "davaq",
    "me",
    "exchange-card-feed",
    "a+b",
    "game:card/1",
  ]);
  assert.equal(options.staleTime, 30000);
  assert.equal(options.gcTime, 300000);
  assert.equal(
    options.retry(0, { status: 410 }),
    false,
    "expired page needs a new snapshot, not repeated retries",
  );
  assert.equal(options.retry(0, { status: 403 }), false);
  assert.equal(options.retry(0, { status: 503 }), true);
  assert.equal(options.retry(1, { status: 503 }), false);
  await options.queryFn({ pageParam: "cursor+/=", signal });
  const url = new URL(f.requests[0].url, "https://davaq.test");
  assert.equal(url.pathname, "/api/tcg/card-feed");
  assert.equal(url.searchParams.get("q"), "a+b");
  assert.equal(url.searchParams.get("cardId"), "game:card/1");
  assert.equal(url.searchParams.get("cursor"), "cursor+/=");
  assert.equal(f.requests[0].options.signal, signal);
  const signedOut = fixture({ signedIn: false });
  signedOut.output.useExchangeFeed();
  assert.equal(signedOut.options().enabled, false);
});

test("tab warmup and the feed share the first-page key and only prepare three images", async () => {
  const f = fixture();
  f.output.useWarmExchangeFeed();
  f.flush();
  await settle();
  await settle();
  assert.deepEqual(Array.from(f.options().queryKey), [
    "davaq",
    "me",
    "exchange-card-feed",
    "",
    "",
  ]);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(
    f.images.map((image) => image.path),
    ["/objects/0", "/objects/1", "/objects/2"],
  );
  assert.deepEqual(f.releases, ["/objects/0", "/objects/1", "/objects/2"]);
  assert.equal(f.cache.has(JSON.stringify(["media-url", "/objects/0"])), true);
  f.output.useExchangeFeed();
  assert.deepEqual(Array.from(f.options().queryKey), [
    "davaq",
    "me",
    "exchange-card-feed",
    "",
    "",
  ]);
});

test("native private-image warmup uses the same media-url query as rendering and memory-disk caching", async () => {
  const f = fixture({ platform: "android" });
  f.output.useExchangeFeedPreload(f.cards, 0);
  f.flush();
  await settle();
  await settle();
  assert.deepEqual(f.media, [
    "/objects/0",
    "/objects/1",
    "/objects/2",
    "/objects/3",
  ]);
  assert.equal(f.images[0].uri, "https://signed.test/objects/0");
  assert.equal(f.images[0].options.cachePolicy, "memory-disk");
  assert.equal(f.cache.has(JSON.stringify(["media-url", "/objects/0"])), true);
});

test("public browser images warm the same HTTP cache as rendering, without private blob conversion", async () => {
  const f = fixture();
  f.output.useExchangeFeedPreload(
    [
      {
        ...f.cards[0],
        card: { ...f.cards[0].card, imageSrc: "https://cards.test/card.jpg" },
      },
    ],
    0,
  );
  f.flush();
  await settle();
  assert.equal(f.media.length, 0);
  assert.equal(f.images[0].uri, "https://cards.test/card.jpg");
  assert.equal(f.images[0].options.cachePolicy, "memory-disk");
  assert.equal(f.releases.length, 0);
});

test("home image warmup keeps exactly four public originals and never exceeds two in flight", async () => {
  const f = fixture({ deferImage: true });
  const sources = [
    "/objects/private",
    "https://cards.test/0.jpg",
    ...Array.from(
      { length: 9 },
      (_, index) => "https://cards.test/" + index + ".jpg",
    ),
  ];
  f.output.preloadPublicCardImages(sources);
  await settle();
  assert.equal(f.images.length, 2);
  assert.equal(f.pendingImages.length, 2);
  f.pendingImages.splice(0).forEach((resolve) => resolve());
  await settle();
  assert.deepEqual(
    f.images.map((image) => image.uri),
    [
      "https://cards.test/0.jpg",
      "https://cards.test/1.jpg",
      "https://cards.test/2.jpg",
      "https://cards.test/3.jpg",
    ],
  );
  f.pendingImages.splice(0).forEach((resolve) => resolve());
  await settle();
  f.output.preloadPublicCardImages(sources);
  await settle();
  assert.equal(
    f.images.length,
    4,
    "a repeat home render reuses the prepared image identities",
  );
  assert.equal(f.media.length, 0);
});

test("leaving the home cancels queued public warmups without touching private image state", async () => {
  const f = fixture({ deferImage: true });
  let active = true;
  f.output.preloadPublicCardImages(
    Array.from(
      { length: 8 },
      (_, index) => "https://cards.test/" + index + ".jpg",
    ),
    () => active,
  );
  await settle();
  active = false;
  f.pendingImages.splice(0).forEach((resolve) => resolve());
  await settle();
  assert.equal(f.images.length, 2);
  assert.equal(f.media.length, 0);
  assert.equal(f.releases.length, 0);
});

test("leaving a native feed while resolving access URLs never starts late image downloads", async () => {
  const f = fixture({ platform: "android", deferMedia: true });
  f.output.useExchangeFeedPreload(f.cards, 0);
  const cleanups = f.flush();
  await settle();
  assert.equal(f.pendingMedia.length, 2);
  cleanups.forEach((cleanup) => cleanup?.());
  f.pendingMedia.forEach((resolve) => resolve());
  await settle();
  assert.equal(f.images.length, 0);
  assert.equal(
    f.pendingMedia.length,
    2,
    "the remaining queued images were discarded",
  );
});

test("disposing the tab warmup cannot pause the active feed image queue", async () => {
  const f = fixture({ platform: "android", deferMedia: true });
  f.output.useWarmExchangeFeed();
  const warmCleanups = f.flush();
  await settle();
  f.output.useExchangeFeedPreload(f.cards, 1);
  const screenCleanups = f.flush();
  warmCleanups.forEach((cleanup) => cleanup?.());
  f.pendingMedia.slice(0, 2).forEach((resolve) => resolve());
  await settle();
  assert.deepEqual(f.media, [
    "/objects/0",
    "/objects/1",
    "/objects/2",
    "/objects/3",
  ]);
  f.pendingMedia.slice(2).forEach((resolve) => resolve());
  await settle();
  assert.equal(f.images.length, 4);
  screenCleanups.forEach((cleanup) => cleanup?.());
});

test("a cold tab request resolving after the user swipes cannot replace the visible image window", async () => {
  const f = fixture({ platform: "android", deferMedia: true });
  let finishColdFetch;
  f.client.prefetchInfiniteQuery = async (options) => {
    await new Promise((resolve) => {
      finishColdFetch = resolve;
    });
    f.cache.set(JSON.stringify(options.queryKey), {
      pages: [{ items: f.cards, nextCursor: null }],
    });
  };
  f.output.useWarmExchangeFeed();
  const warmCleanups = f.flush();
  f.output.useExchangeFeedPreload(f.cards, 2);
  const screenCleanups = f.flush();
  await settle();
  assert.deepEqual(f.media, ["/objects/2", "/objects/3"]);
  finishColdFetch();
  await settle();
  f.pendingMedia.slice(0, 2).forEach((resolve) => resolve());
  await settle();
  assert.deepEqual(f.media, ["/objects/2", "/objects/3", "/objects/1"]);
  f.pendingMedia.slice(2).forEach((resolve) => resolve());
  await settle();
  assert.equal(
    f.images.some((image) => image.uri.endsWith("/objects/0")),
    false,
  );
  [...warmCleanups, ...screenCleanups].forEach((cleanup) => cleanup?.());
});

test("offline or hidden tabs do not perform speculative reads or image downloads", async () => {
  for (const config of [{ online: false }, { visible: false }]) {
    const f = fixture(config);
    f.output.useWarmExchangeFeed();
    f.output.useExchangeFeedPreload(f.cards, 0);
    f.flush();
    await settle();
    assert.equal(f.requests.length, 0);
    assert.equal(f.images.length, 0);
    f.output.useExchangeFeed();
    assert.equal(
      f.options().enabled,
      true,
      "opening the screen remains available",
    );
  }
});

test("a tab warmup disposed during its first fetch never starts media preparation", async () => {
  const f = fixture();
  let release;
  f.client.prefetchInfiniteQuery = async (options) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    f.cache.set(JSON.stringify(options.queryKey), {
      pages: [{ items: f.cards, nextCursor: null }],
    });
  };
  f.output.useWarmExchangeFeed();
  const cleanups = f.flush();
  cleanups.forEach((cleanup) => cleanup?.());
  release();
  await settle();
  assert.equal(f.images.length, 0);
});

test("cards without published offers remain in the feed and preserve the server shuffle order", () => {
  const cards = fixture().cards;
  const f = fixture({
    queryData: {
      pages: [
        { items: [cards[2], cards[0]], nextCursor: "seeded" },
        { items: [cards[0], cards[3]], nextCursor: null },
      ],
    },
  });
  const result = f.output.useExchangeFeed();
  assert.deepEqual(
    Array.from(result.items, (item) => item.id),
    ["kream:2", "kream:0", "kream:3"],
  );
  assert.equal(
    result.items.every((item) => item.available_listing_count === 0),
    true,
  );
});

test("partial catalog failures retain visible cards, stop automatic paging and preserve the retry cursor", async () => {
  const cards = fixture().cards;
  const f = fixture({
    feedPage: {
      items: [],
      nextCursor: "retry-snapshot",
      catalogUnavailable: true,
    },
    queryData: {
      pages: [
        {
          items: cards,
          nextCursor: "retry-snapshot",
          catalogUnavailable: true,
        },
      ],
    },
  });
  const result = f.output.useExchangeFeed("", "", true, 3);
  f.flush();
  await settle();
  assert.equal(result.items.length, 4);
  assert.equal(result.catalogUnavailable, true);
  assert.equal(f.nextPageRequests(), 0);
  const page = await f.options().queryFn({
    pageParam: "retry-snapshot",
    signal: new AbortController().signal,
  });
  assert.equal(page.nextCursor, "retry-snapshot");
  assert.equal(page.catalogUnavailable, true);
});

test("recovering catalog pages resumes background loading near the end", async () => {
  const cards = fixture().cards;
  const f = fixture({
    queryData: {
      pages: [
        { items: cards, nextCursor: "next-page", catalogUnavailable: false },
      ],
    },
  });
  const result = f.output.useExchangeFeed("", "", true, 3);
  f.flush();
  await settle();
  assert.equal(result.catalogUnavailable, false);
  assert.equal(f.nextPageRequests(), 1);
});

test("empty market pages advance a bounded distance without stopping at an unfinished catalog", async () => {
  const page = {
    items: [],
    nextCursor: "other-market",
    catalogUnavailable: false,
  };
  const first = fixture({ queryData: { pages: [page] } });
  first.output.useExchangeFeed();
  first.flush();
  await settle();
  assert.equal(first.nextPageRequests(), 1);
  const bounded = fixture({ queryData: { pages: [page, page, page] } });
  bounded.output.useExchangeFeed();
  bounded.flush();
  await settle();
  assert.equal(
    bounded.nextPageRequests(),
    0,
    "a sparse search never downloads the entire catalog automatically",
  );
});

test("a slow next-page response preserves confirmed likes and comments written to its captured prefix", () => {
  const f = fixture();
  f.output.useExchangeFeed();
  const first = {
    items: [{ ...f.cards[0], like_count: 3, comment_count: 1 }],
    nextCursor: "snapshot-a-page-2",
  };
  const captured = { pages: [first], pageParams: [undefined] };
  const confirmed = {
    pages: [
      {
        ...first,
        items: [
          {
            ...first.items[0],
            liked_by_me: true,
            like_count: 4,
            comment_count: 2,
          },
        ],
      },
    ],
    pageParams: [undefined],
  };
  const next = { items: [f.cards[1]], nextCursor: "snapshot-a-page-3" };
  const response = {
    ...captured,
    pages: [...captured.pages, next],
    pageParams: [undefined, "snapshot-a-page-2"],
  };
  const merged = f.options().structuralSharing(confirmed, response);
  assert.equal(merged.pages[0], confirmed.pages[0]);
  assert.equal(merged.pages[0].items[0].like_count, 4);
  assert.equal(merged.pages[0].items[0].liked_by_me, true);
  assert.equal(merged.pages[0].items[0].comment_count, 2);
  assert.equal(merged.pages[1], next);
  assert.equal(
    response.pages[0].items[0].like_count,
    3,
    "the captured network result was not mutated",
  );
});

test("new shuffled snapshots and authoritative refetches are never overwritten by old social values", () => {
  const f = fixture();
  f.output.useExchangeFeed();
  const previous = {
    pages: [{ items: [f.cards[0]], nextCursor: "old-snapshot" }],
    pageParams: [undefined],
  };
  const fresh = {
    pages: [
      {
        items: [{ ...f.cards[0], like_count: 12 }],
        nextCursor: "fresh-snapshot",
      },
      { items: [f.cards[1]], nextCursor: null },
    ],
    pageParams: [undefined, "fresh-snapshot"],
  };
  assert.equal(f.options().structuralSharing(previous, fresh), fresh);
  const refetch = {
    pages: [
      { items: [{ ...f.cards[0], like_count: 9 }], nextCursor: "old-snapshot" },
    ],
    pageParams: [undefined],
  };
  assert.equal(f.options().structuralSharing(previous, refetch), refetch);
});
