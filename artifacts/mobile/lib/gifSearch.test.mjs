import test from 'node:test';
import assert from 'node:assert/strict';
import { searchGifs } from './gifSearch.ts';
const item=(url,license='CC BY-SA 4.0',mime='image/gif',size=100)=>({title:'File:Cat.gif',pageid:1,imageinfo:[{url,descriptionurl:'https://commons.wikimedia.org/wiki/File:Cat.gif',mime,size,width:100,height:90,extmetadata:{LicenseShortName:{value:license},Artist:{value:'<a>Artist</a>'}}}]});
test('search uses GIF MIME search and retains only bounded licensed Wikimedia GIFs',async()=>{
 const original=globalThis.fetch;let request;globalThis.fetch=async url=>{request=new URL(url);return {ok:true,json:async()=>({query:{pages:{a:item('https://upload.wikimedia.org/a.gif'),b:item('https://evil.example/x.gif'),c:item('https://upload.wikimedia.org/b.gif','unknown'),d:item('https://upload.wikimedia.org/c.gif','CC0','image/png'),e:item('https://upload.wikimedia.org/d.gif','CC0','image/gif',9000000)}}})}};
 try {const result=await searchGifs('cat');assert.equal(result.length,1);assert.equal(result[0].author,'Artist');assert.match(request.searchParams.get('gsrsearch'),/cat filemime:image\/gif/);assert.equal(result[0].width,100);}finally{globalThis.fetch=original;}
});
test('provider failure and abort propagate instead of appearing as empty successful results',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>({ok:false});await assert.rejects(searchGifs('cat'));globalThis.fetch=async(_,options)=>{assert.ok(options.signal);throw new Error('aborted')};await assert.rejects(searchGifs('cat',new AbortController().signal));}finally{globalThis.fetch=original;}});
