import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/app/api.ts';
test('public price errors preserve HTTP status for withdrawal versus transport failure',async()=>{
 const original=globalThis.fetch;
 try{for(const status of [404,503]){globalThis.fetch=async()=>new Response(null,{status});await assert.rejects(api('scanner/price?id=public'),(e:any)=>e.status===status);}}
 finally{globalThis.fetch=original;}
});
