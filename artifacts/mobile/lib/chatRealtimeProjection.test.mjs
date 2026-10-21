import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function compile(file) { return ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText; }
const reliability={}; vm.runInNewContext(compile('./chatMessageReliability.ts'),{exports:reliability});
const projection={}; vm.runInNewContext(compile('./chatRealtimeProjection.ts'),{exports:projection,require:()=>reliability});
const {projectCreatedMessage,projectReadCursors}=projection;
const message = {
  id: "m1",
  roomId: "r",
  senderId: "a",
  roomSeq: 1,
  createdAt: "2026-10-10T00:00:00Z",
  readCount: 0,
};
test("duplicate delivery is idempotent and rejects foreign rooms", () => {
  const first = projectCreatedMessage([], message, "r");
  assert.equal(projectCreatedMessage(first, message, "r").length, 1);
  assert.deepEqual(
    projectCreatedMessage(
      first,
      { ...message, id: "m2", roomId: "other" },
      "r",
    ),
    first,
  );
});
test("own read cursor does not mark messages read; delayed responses cannot regress reads", () => {
  assert.equal(
    projectReadCursors(
      [message],
      [{ userId: "a", lastReadSeq: 1, isReadReceiptParticipant: true }],
    )[0].readCount,
    0,
  );
  const read = projectReadCursors(
    [message],
    [{ userId: "b", lastReadSeq: 1, isReadReceiptParticipant: true }],
  );
  assert.equal(read[0].readCount, 1);
  assert.equal(projectCreatedMessage(read, message, "r")[0].readCount, 1);
});

test('duplicate membership cursors cannot inflate read receipts',()=>{
 const reader={userId:'b',lastReadSeq:1,isReadReceiptParticipant:true};
 assert.equal(projectReadCursors([message],[reader,reader])[0].readCount,1);
});
