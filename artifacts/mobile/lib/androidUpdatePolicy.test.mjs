import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferAndroidUpdate } from './androidUpdatePolicy.ts';
test('only a Play-available higher build prompts, even with the same version name',()=>{
 assert.equal(shouldOfferAndroidUpdate({available:true,versionCode:22},21,null,100),true);
 for(const info of [{available:false,versionCode:22},{available:true,versionCode:21},{available:true,versionCode:20},{available:true,versionCode:NaN}]) assert.equal(shouldOfferAndroidUpdate(info,21,null,100),false);
});
test('deferral suppresses only that build until the deadline; newer builds still prompt',()=>{
 const deferred={versionCode:22,until:200};
 assert.equal(shouldOfferAndroidUpdate({available:true,versionCode:22},21,deferred,100),false);
 assert.equal(shouldOfferAndroidUpdate({available:true,versionCode:22},21,deferred,200),true);
 assert.equal(shouldOfferAndroidUpdate({available:true,versionCode:23},21,deferred,100),true);
});
