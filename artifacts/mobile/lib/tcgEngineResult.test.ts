import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanNeedsRefresh,scanPriceLabel,type EngineScan} from './tcgEngineResult.ts';
const scan=(state:any,extra:any={}):EngineScan=>({id:'private',object_path:'/objects/owned',status:'review',result:{cardVerified:true,matchLevel:'printing',engine:{stage:'pricing'},price:{state,price:null,currency:'KRW',priceType:'LISTED',...extra}}});
test('private review photo continues pricing then stops on complete',()=>{assert.equal(scanNeedsRefresh(scan('checking')),true);assert.equal(scanNeedsRefresh(scan('priced',{price:2000})),false);});
test('revoked prices are never formatted as confirmed',()=>{for(const state of ['held','privacy_blocked','unsupported','review','catalog_missing'])assert.equal(scanPriceLabel(scan(state,{price:9999})).includes('9,999'),false);});
test('other printing uses reference amount rather than previous exact price',()=>{const label=scanPriceLabel(scan('priced',{price:9999,estimate:{amount:3000,currency:'KRW',referenceKind:'other_printing'}}));assert.match(label,/다른 판본 참고가 3,000/);assert.doesNotMatch(label,/9,999/);});
test('null price is unavailable, never zero',()=>assert.equal(scanPriceLabel(scan('priced')),'가격 자료 없음'));

test('an AI estimate is labelled as an estimate even when printing is verified',()=>assert.match(scanPriceLabel(scan('priced',{estimate:{amount:3000,currency:'KRW',method:'ai'}})),/동일 판본 AI 추정가/));
