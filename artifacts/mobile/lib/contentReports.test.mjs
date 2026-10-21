import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(response = { id, status: "pending" }) {
  const calls = [],
    output = {};
  const source = ts.transpileModule(
    readFileSync(new URL("./contentReports.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports: output,
    Set,
    require: (name) => {
      assert.equal(name, "@workspace/api-client-react");
      return {
        customFetch: async (...args) => {
          calls.push(args);
          return response;
        },
      };
    },
  });
  return { ...output, calls };
}
test("reports send only validated target and trimmed reason using authenticated customFetch", async () => {
  const f = fixture();
  const result = await f.submitContentReport(
    { targetType: "message", targetId: id },
    "  반복적인 괴롭힘 메시지  ",
  );
  assert.equal(result.status, "pending");
  const [path, init] = f.calls[0];
  assert.equal(path, "/api/tcg/content-reports");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), {
    targetType: "message",
    targetId: id,
    reason: "반복적인 괴롭힘 메시지",
  });
  assert.equal(init.headers.Authorization, undefined);
});
test("invalid target and short or long reasons never issue a request", async () => {
  const f = fixture();
  for (const reason of ["  ", "1234", "x".repeat(2001)])
    await assert.rejects(
      f.submitContentReport({ targetType: "user", targetId: id }, reason),
    );
  await assert.rejects(
    f.submitContentReport(
      { targetType: "user", targetId: "path/other-user" },
      "문제 있는 내용",
    ),
  );
  await assert.rejects(
    f.submitContentReport(
      { targetType: "unsupported", targetId: id },
      "문제 있는 내용",
    ),
  );
  assert.equal(f.calls.length, 0);
});
test("invalid or absent receipt is never treated as accepted", async () => {
  await assert.rejects(
    fixture({ status: "pending" }).submitContentReport(
      { targetType: "user", targetId: id },
      "문제 있는 내용",
    ),
    /접수 여부/,
  );
  await assert.rejects(
    fixture({ id, status: "resolved" }).submitContentReport(
      { targetType: "user", targetId: id },
      "문제 있는 내용",
    ),
    /접수 여부/,
  );
});
test("server visibility, authentication, and rate-limit failures show actionable messages", () => {
  const f = fixture();
  assert.match(f.contentReportError({ status: 401 }), /다시 로그인/);
  assert.match(f.contentReportError({ status: 404 }), /새로고침/);
  assert.match(
    f.contentReportError({ data: { error: "rate_limited" } }),
    /사유는 유지/,
  );
  assert.match(
    f.contentReportError({ data: { error: "self_report" } }),
    /내가 작성/,
  );
  assert.doesNotMatch(
    f.contentReportError(new Error("secret server details")),
    /secret/,
  );
});
test("blocking purges public visibility and room caches while preserving private and other-owner data", async () => {
  const f = fixture(),
    client = new QueryClient();
  const clear = [
    ["davaq", "me", "public-profile", id],
    ["davaq", "me", "exchange-card-feed", "", ""],
    ["davaq", "me", "/tcg/listings/one/comments"],
    ["davaq", "me", "/tcg/cards/a/comments"],
    ["/api/rooms"],
    ["/api/rooms/one/messages"],
    ["/api/friends"],
    ["/api/blocked"],
  ];
  const keep = [
    ["davaq", "me", "/tcg/collection"],
    ["davaq", "me", "/tcg/trades"],
    ["davaq", "another", "exchange-card-feed"],
    ["media-url", "public-photo"],
    ["/api/users/me"],
  ];
  [...clear, ...keep].forEach((queryKey) =>
    client.setQueryData(queryKey, { preserved: true }),
  );
  await f.clearBlockedUserCaches(client, "me");
  clear.forEach((queryKey) =>
    assert.equal(client.getQueryData(queryKey), undefined),
  );
  keep.forEach((queryKey) =>
    assert.equal(client.getQueryData(queryKey)?.preserved, true),
  );
  client.clear();
});
test("mounted feed observers refetch in place after block rather than retaining detached data", async () => {
  const f = fixture(),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["davaq", "me", "exchange-card-feed"];
  client.setQueryData(queryKey, { items: ["blocked-content"] });
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: async () => ({ items: ["visible-content"] }),
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  const before = client.getQueryCache().find({ queryKey });
  await f.clearBlockedUserCaches(client, "me");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getQueryCache().find({ queryKey }), before);
  assert.deepEqual(observer.getCurrentResult().data, {
    items: ["visible-content"],
  });
  unsubscribe();
  client.clear();
});
