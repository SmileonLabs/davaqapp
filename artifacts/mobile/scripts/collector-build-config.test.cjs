const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const configure=require('../app.config.js');
test('web-only prefix never leaks from config or environment into native routes',()=>{
 const saved=process.env.EXPO_WEB_EXPORT,base=process.env.DAVAQ_WEB_BASE_PATH;
 try{delete process.env.EXPO_WEB_EXPORT;const native=configure({config:{experiments:{baseUrl:'/app',typedRoutes:true}}});assert.equal(native.experiments.baseUrl,undefined);assert.equal(native.experiments.typedRoutes,true);process.env.EXPO_WEB_EXPORT='1';process.env.DAVAQ_WEB_BASE_PATH='/app';assert.equal(configure({config:{}}).experiments.baseUrl,'/app');}
 finally{saved===undefined?delete process.env.EXPO_WEB_EXPORT:process.env.EXPO_WEB_EXPORT=saved;base===undefined?delete process.env.DAVAQ_WEB_BASE_PATH:process.env.DAVAQ_WEB_BASE_PATH=base;}
});
test('PWA build script never writes app.json',()=>{const s=fs.readFileSync(__dirname+'/build.js','utf8');assert.ok(!s.includes('fs.writeFileSync(appJsonPath'));assert.ok(s.includes('env.DAVAQ_WEB_BASE_PATH'));});
