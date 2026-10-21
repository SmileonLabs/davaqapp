import {it,expect,vi} from 'vitest';
vi.mock('@workspace/db',()=>({pool:{query:vi.fn()}}));
vi.mock('../objectStorage',()=>({ObjectStorageService:class{}}));
import {selectImageMessages,imageConversation} from './images';
const photo=(id:string,albumId?:string)=>({id,sender_id:'owner',author_kind:'user',type:'image',content:'/objects/'+id,room_seq:1,created_at:new Date(),metadata:{caption:'이 사진의 쵸파는 어때?',albumId}});
it('keeps the photo caption and selects only the latest album',()=>{
 const a=photo('a','old'),b=photo('b','new'),c=photo('c','new');
 expect(selectImageMessages([a,b,c]).map(m=>m.id)).toEqual(['b','c']);
 expect(imageConversation([b])[0].text).toContain('쵸파');
});
it('does not reuse images after an explicit new card link or new autonomous topic',()=>{
 const a=photo('a');
 expect(selectImageMessages([a],true)).toEqual([]);
 expect(selectImageMessages([a,{...a,id:'t',type:'text',content:'https://davaq.app/app/tcg/card/detail?id=kream%3A1'}])).toEqual([]);
 expect(selectImageMessages([{...a,created_at:new Date(Date.now()-31*60000)}])).toEqual([]);
});
it('limits image count and redacts contacts in captions',()=>{
 const h=[1,2,3,4].map(i=>photo(String(i),'same'));
 expect(selectImageMessages(h)).toHaveLength(3);
 const m={...h[0],metadata:{caption:'test@example.com 010-1234-5678'}};
 expect(imageConversation([m])[0].text).not.toMatch(/example|1234/);
});
