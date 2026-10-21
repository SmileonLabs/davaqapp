import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({query:vi.fn(),download:vi.fn(),validate:vi.fn()}));
vi.mock('@workspace/db',()=>({pool:{query:fake.query,connect:async()=>({query:fake.query,release:vi.fn()})}}));
vi.mock('./tcgService',()=>({validatePhotos:fake.validate}));
vi.mock('./objectStorage',()=>({ObjectStorageService:class {getObjectEntityFile=async(p:string)=>p;downloadObject=fake.download;}}));
import {submitScan,readScan} from './tcgScans';
beforeEach(()=>{vi.stubEnv('TCG_DAVAQ_SHARED_KEY','test-only-shared-key-000000000000000000');fake.query.mockReset();fake.download.mockReset();fake.validate.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('preserves DAVAQ-owned photo path and forwards market and hints only server-side',async()=>{
 fake.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('INSERT')?[{id:'scan'}]:sql.startsWith('UPDATE')?[{id:'scan',upstream_id:'photo'}]:[]}));
 fake.download.mockResolvedValue(new Response(new Uint8Array([255,216,255,0])));
 const fetch=vi.fn().mockResolvedValue(Response.json({id:'photo',status:'queued',engineVersion:'engine'}));vi.stubGlobal('fetch',fetch);
 await submitScan('owner',{photo:'/objects/owned',requestKey:'request',market:'US',game:'pokemon',name:'Pikachu',number:'25'});
 const [url,options]=fetch.mock.calls[0];expect(url.pathname).toBe('/api/mobile/v1/davaq/photos');expect(url.searchParams.get('market')).toBe('US');expect(url.searchParams.get('number')).toBe('25');expect(options.headers.authorization).toContain('Bearer test-only-');expect(fake.validate).toHaveBeenCalledWith(expect.anything(),'owner',['/objects/owned']);
});
it('returns private review results with all engine, identity and price fields intact',async()=>{
 fake.query.mockResolvedValue({rows:[{id:'scan',owner_id:'owner',upstream_id:'photo'}]});
 const result={id:'photo',status:'review',cardVerified:true,matchLevel:'printing',targetId:'printing',engineVersion:'engine',identityVersion:'identity',price:{state:'priced',price:2000,currency:'KRW',dataVersion:'daily'}};
 const fetch=vi.fn().mockResolvedValue(Response.json(result));vi.stubGlobal('fetch',fetch);
 const scan=await readScan('owner','scan');expect(scan.result).toEqual(result);expect(fake.query.mock.calls[0][1]).toEqual(['scan','owner']);expect(fetch.mock.calls[0][0].pathname).toBe('/api/mobile/v1/davaq/photos/photo');
});
it('a repeated completed request key never submits a second upstream photo',async()=>{
 fake.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT *')?[{id:'scan',upstream_id:'photo'}]:[]}));const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await submitScan('owner',{photo:'/objects/owned',requestKey:'same'});expect(fetch).not.toHaveBeenCalled();expect(fake.download).not.toHaveBeenCalled();
});
