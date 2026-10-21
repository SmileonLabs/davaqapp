import test from 'node:test';
import assert from 'node:assert/strict';
import {historySeries,historyRange,historyAverage} from './price-history-series.ts';
const point=(date:string,amount:number,currency='KRW',observedAt=date+'T00:00:00Z')=>({shopCode:'kream',shopName:'KREAM',sourceProductId:'649512',displayName:'Pikachu',conditionLabel:null,gradingLabel:null,priceType:'LISTED' as const,priceDate:date,amountMinor:amount,currencyCode:currency,observedAt});
test('keep currencies separate and latest observation for each recorded date',()=>{const groups=historySeries([point('2026-10-01',100),point('2026-10-01',110,'KRW','2026-10-01T12:00:00Z'),point('2026-10-01',1,'USD')]);assert.equal(groups.length,2);assert.equal(groups.find(g=>g.sample.currencyCode==='KRW')!.values[0].value,110);});
test('range ends at latest record and does not fabricate missing dates',()=>{const values=[{time:'2026-09-01',value:1},{time:'2026-10-01',value:2},{time:'2026-10-06',value:3}];assert.deepEqual(historyRange(values,7),values.slice(1));});
test('moving average uses actual observations',()=>{assert.deepEqual(historyAverage([{time:'2026-10-01',value:10},{time:'2026-10-05',value:20},{time:'2026-10-06',value:30}],2),[{time:'2026-10-05',value:15},{time:'2026-10-06',value:25}]);});
