import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [];
  const timers = [];
  const cleanups = [];
  const key = ["test-call-status"];
  client.setQueryData(key, { id: "test-call", status: "ringing" });
  const observer = new QueryObserver(client, {
    queryKey: key,
    enabled: false,
    queryFn: ({ signal }) => new Promise((resolve, reject) => {
      requests.push({ signal, resolve });
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }),
  });
  const unsubscribe = observer.subscribe(() => {});
  const module = { exports: {} };
  const source = readFileSync(process.env.CALL_POLLING_SOURCE || new URL("./useCallPolling.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      if (name === "react") return {
        useCallback: fn => fn,
        useEffect: fn => { cleanups.push(fn()); },
      };
      if (name === "@workspace/api-client-react") return {
        getListIncomingCallsQueryKey: () => ["/api/calls/incoming"],
        getGetCallQueryKey: id => [`/api/calls/${id}`],
        useListIncomingCalls: () => ({ data: [], refetch: async () => ({ data: [] }) }),
        useGetCall: () => observer.getCurrentResult(),
      };
      if (name === "@/lib/callLifecycle") return {
        watchedCallId: args => args.activeCallId,
        callPollingInterval: () => 2_500,
      };
      throw new Error(name);
    },
    setInterval: (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; },
    clearInterval: () => {},
  });
  return {
    api: module.exports.useCallPolling({ mode: "outgoing", activeCallId: "test-call" }),
    observer, requests, timers,
    cleanup() {
      for (const request of requests) request.resolve({ id: "test-call", status: "active" });
      cleanups.forEach(fn => fn?.());
      unsubscribe();
      client.clear();
    },
  };
}

test("slow call status responses survive later polling ticks and deliver acceptance", async () => {
  const h = harness();
  try {
    const response = h.api.refetchWatched();
    const poll = h.timers.find(timer => timer.milliseconds === 2_500);
    poll.callback();
    poll.callback();
    assert.equal(h.requests.length, 1, "ticks must join the in-flight status request");
    assert.equal(h.requests[0].signal.aborted, false);
    h.requests[0].resolve({ id: "test-call", status: "active" });
    await response;
    assert.equal(h.observer.getCurrentResult().data.status, "active");
  } finally {
    h.cleanup();
  }
});
