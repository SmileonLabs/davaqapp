import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { prepareProfileStateTransition } from "./profileQueryIsolation.ts";
import {
  customFetch,
  setAuthTokenGetter,
  setCharacterProfileIdGetter,
} from "../../../lib/api-client-react/src/custom-fetch.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settle = () => new Promise(setImmediate);
async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await settle();
  }
  assert.fail("The observed query did not settle");
}
function fixture(t, { retry = false } = {}) {
  const originalFetch = globalThis.fetch,
    requests = [],
    observers = [];
  setAuthTokenGetter(null);
  setCharacterProfileIdGetter(null);
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry,
        retryDelay: 0,
        networkMode: "always",
      },
    },
  });
  globalThis.fetch = async (url, init) => {
    const gate = deferred();
    requests.push({
      url: String(url),
      profile: init.headers.get("x-character-profile-id"),
      gate,
    });
    return gate.promise;
  };
  const observe = (key, initialData) => {
    const snapshots = [];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: ({ signal }) =>
        customFetch("https://davaq.app/api/tcg/" + key.at(-1), {
          signal,
          responseType: "json",
        }),
      ...(initialData === undefined ? {} : { initialData }),
    });
    const unsubscribe = observer.subscribe((result) =>
      snapshots.push({ data: result.data, status: result.status }),
    );
    observers.push(unsubscribe);
    return { observer, snapshots };
  };
  t.after(() => {
    observers.forEach((unsubscribe) => unsubscribe());
    client.clear();
    globalThis.fetch = originalFetch;
    setCharacterProfileIdGetter(null);
    setAuthTokenGetter(null);
  });
  const commit = (previous, next) =>
    prepareProfileStateTransition(client, previous, next, (id) =>
      setCharacterProfileIdGetter(() => id),
    );
  const respond = (request, data, status = 200) =>
    request.gate.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  return { client, requests, observe, commit, respond };
}

test("first profile hydration keeps active catalog/feed observers and their retry after the request fence", async (t) => {
  for (const previous of [undefined, null]) {
    const f = fixture(t, { retry: 1 });
    const catalog = f.observe(["davaq", "catalog"]),
      feed = f.observe(["davaq", "card-feed"]);
    await until(() => f.requests.length === 2);
    const originalCatalog = catalog.observer.getCurrentQuery(),
      originalFeed = feed.observer.getCurrentQuery();
    assert.equal(f.commit(previous, "profile-a"), false);
    f.requests
      .slice()
      .forEach((request) =>
        f.respond(request, { items: ["before-hydration"] }),
      );
    await until(() => f.requests.length === 4);
    f.requests
      .slice(2)
      .forEach((request) => f.respond(request, { items: ["current"] }));
    await until(
      () =>
        catalog.observer.getCurrentResult().isSuccess &&
        feed.observer.getCurrentResult().isSuccess,
    );
    assert.equal(catalog.observer.getCurrentQuery(), originalCatalog);
    assert.equal(feed.observer.getCurrentQuery(), originalFeed);
    assert.deepEqual(catalog.observer.getCurrentResult().data, {
      items: ["current"],
    });
    assert.deepEqual(feed.observer.getCurrentResult().data, {
      items: ["current"],
    });
    assert.equal(
      f.requests.slice(2).every((request) => request.profile === "profile-a"),
      true,
    );
    f.client.clear();
  }
});

test("a real profile switch clears initialData and rebinds the same observer before late old data arrives", async (t) => {
  const f = fixture(t);
  f.commit(undefined, "profile-a");
  const observed = f.observe(["davaq", "catalog"], { items: ["private-a"] });
  f.client.setQueryData(["inactive-private"], { secret: "private-a" });
  f.client.setQueryData(["character-profiles"], {
    activeProfile: { id: "profile-a" },
  });
  await until(() => f.requests.length === 1);
  const oldQuery = observed.observer.getCurrentQuery(),
    oldRequest = f.requests[0];
  observed.snapshots.length = 0;
  assert.equal(f.commit("profile-a", "profile-b"), true);
  assert.notEqual(observed.observer.getCurrentQuery(), oldQuery);
  assert.equal(observed.observer.getCurrentResult().data, undefined);
  assert.equal(f.client.getQueryData(["inactive-private"]), undefined);
  assert.deepEqual(f.client.getQueryData(["character-profiles"]), {
    activeProfile: { id: "profile-a" },
  });
  await until(() => f.requests.length === 2);
  assert.equal(f.requests[1].profile, "profile-b");
  f.respond(oldRequest, { items: ["late-private-a"] });
  f.respond(f.requests[1], { items: ["public-b"] });
  await until(() => observed.observer.getCurrentResult().isSuccess);
  assert.deepEqual(observed.observer.getCurrentResult().data, {
    items: ["public-b"],
  });
  assert.equal(
    observed.snapshots.some((snapshot) =>
      JSON.stringify(snapshot.data)?.includes("private-a"),
    ),
    false,
  );
});

test("a failed next-profile fetch and a repeated switch never restore the previous initialData", async (t) => {
  const f = fixture(t);
  f.commit(undefined, "profile-a");
  const observed = f.observe(["davaq", "card-feed"], { items: ["private-a"] });
  await until(() => f.requests.length === 1);
  observed.snapshots.length = 0;
  f.commit("profile-a", "profile-b");
  await until(() => f.requests.length === 2);
  f.respond(f.requests[1], { error: "unavailable" }, 503);
  await until(() => observed.observer.getCurrentResult().isError);
  assert.equal(observed.observer.getCurrentResult().data, undefined);
  f.commit("profile-b", "profile-c");
  assert.equal(observed.observer.getCurrentResult().data, undefined);
  await until(() => f.requests.length === 3);
  f.respond(f.requests[0], { items: ["late-private-a"] });
  f.respond(f.requests[2], { items: ["public-c"] });
  await until(() => observed.observer.getCurrentResult().isSuccess);
  assert.deepEqual(observed.observer.getCurrentResult().data, {
    items: ["public-c"],
  });
  assert.equal(
    observed.snapshots.some((snapshot) =>
      JSON.stringify(snapshot.data)?.includes("private-a"),
    ),
    false,
  );
});
