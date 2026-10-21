import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('./inviteLinks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};vm.runInNewContext(source,{exports,URL,require:()=>({default:{}})});
test('new invitations use davaq.app and previously shared invitations remain readable',()=>{
 const code='invite_123456';assert.equal(exports.inviteLink(code),'https://davaq.app/app/invite/'+code);
 for(const host of ['davaq.app','davaq.anothermeai.app'])assert.equal(exports.parseInviteCode(`https://${host}/app/invite/${code}`),code);
});
test('untrusted hosts, insecure URLs and other paths are rejected',()=>{
 for(const link of ['https://davaq.app.attacker.example/app/invite/invite_123456','http://davaq.app/app/invite/invite_123456','https://davaq.app/other/invite_123456'])assert.equal(exports.parseInviteCode(link),null);
});
