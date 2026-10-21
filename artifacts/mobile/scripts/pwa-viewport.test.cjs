const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('hidden and zero-height viewport events preserve usable layout and resume restores it',()=>{
 const source=fs.readFileSync(__dirname+'/build.js','utf8');const start=source.indexOf('var viewport = window.visualViewport;');const end=source.indexOf('})();',start);assert.ok(start>0&&end>start);
 const events={},styles=[];const doc={hidden:false,documentElement:{style:{setProperty:(_,v)=>styles.push(v)}},addEventListener:(k,f)=>events[k]=f};const viewport={height:700,scale:1,addEventListener:(k,f)=>events['viewport:'+k]=f};
 vm.runInNewContext(source.slice(start,end),{document:doc,window:{visualViewport:viewport,innerHeight:700,addEventListener:(k,f)=>events[k]=f},Number,requestAnimationFrame:f=>f()});
 assert.equal(styles.at(-1),'700px');doc.hidden=true;viewport.height=0;events['viewport:resize']();assert.equal(styles.at(-1),'700px');doc.hidden=false;events.visibilitychange();assert.equal(styles.at(-1),'700px');viewport.height=680;events.visibilitychange();assert.equal(styles.at(-1),'680px');
});
