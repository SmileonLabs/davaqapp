import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./MessageComposer.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('composer.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='submit')callback=n.initializer.arguments[0].getText(ast);ts.forEachChild(n,visit)}visit(ast);
function fixture(platform='web'){
 let focus=0,value='first message',resolve;const refs={submittingRef:{current:false},edited:{current:false},textRef:{current:value},lastTypingSentRef:{current:100},alive:{current:true}};
 const fn=ts.transpileModule('('+callback+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const submit=vm.runInNewContext(fn,{...refs,text:value,sending:false,Platform:{OS:platform},inputRef:{current:{focus(){focus++}}},Haptics:{ImpactFeedbackStyle:{Light:0},impactAsync:async()=>{}},setText:next=>value=typeof next==='function'?next(value):next,draftKey:undefined,setInputHeight(){},INPUT_MIN_HEIGHT:44,onSend:()=>new Promise(r=>resolve=r)});
 return {submit,focus:()=>focus,text:()=>value,type:s=>value=s,resolve:r=>resolve(r)};
}
test('web send retains focus synchronously before a slow network response and does not steal focus later',async()=>{const f=fixture(),p=f.submit();assert.equal(f.focus(),1);assert.equal(f.text(),'');f.type('next message');f.resolve(true);await p;assert.equal(f.text(),'next message');assert.equal(f.focus(),1)});
test('failed send restores content while preserving the next typed message',async()=>{const f=fixture(),p=f.submit();f.type('next message');f.resolve(false);await p;assert.equal(f.text(),'first message\nnext message');assert.equal(f.focus(),1)});
test('native send does not force focus',async()=>{const f=fixture('ios'),p=f.submit();assert.equal(f.focus(),0);f.resolve(true);await p});
