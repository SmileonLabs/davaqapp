const test=require('node:test'),assert=require('node:assert/strict');
const {patchApplication,patchGradle}=require('./withAndroidPlayUpdate');
test('prebuild registers bridge and Play dependency once',()=>{
 const app='package app.davaq.mobile\nclass MainApplication { fun packages() = PackageList(this).packages.apply { } }';
 const once=patchApplication(app,'app.davaq.mobile');
 assert.match(once,/add\(DavaqPlayUpdatePackage\(\)\)/);assert.equal(patchApplication(once,'app.davaq.mobile'),once);
 const gradle=patchGradle('dependencies {\n}');assert.match(gradle,/app-update:2.1.0/);assert.equal(patchGradle(gradle),gradle);
});
test('changed native templates fail instead of silently omitting the bridge',()=>assert.throws(()=>patchApplication('package app.davaq.mobile\nclass MainApplication {}','app.davaq.mobile')));
