import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { defaultCardAvatar, DEFAULT_CARD_AVATARS } from './defaultCardAvatar.ts';
const policyExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('./davaqAvatarPolicy.ts',import.meta.url),'utf8'),{compilerOptions:{target:99,module:ts.ModuleKind.CommonJS}}).outputText,{exports:policyExports,require:()=>({isDefaultCardAvatar:value=>DEFAULT_CARD_AVATARS.includes(value)})});
const {davaqAvatarUri}=policyExports;
const jsx=(type,props)=>({type,props});
function component(name){
 const source=fs.readFileSync(new URL('../components/tcg/Cards.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('screens.tsx',source,99,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
 return ts.transpileModule(fn,{compilerOptions:{target:99,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
}
test('fixed default avatars preserve chosen images and reject arbitrary external photos',()=>{
 const fixed=defaultCardAvatar('stable-profile');
 assert.equal(defaultCardAvatar('stable-profile'),fixed);
 assert.equal(davaqAvatarUri(fixed),fixed);
 assert.equal(davaqAvatarUri('/objects/my-selected-photo'),'/objects/my-selected-photo');
 assert.equal(davaqAvatarUri('https://untrusted.example/photo'),null);
 assert.equal(new Set(DEFAULT_CARD_AVATARS).size,12);
 assert.equal(fs.readFileSync(new URL('./defaultCardAvatar.ts',import.meta.url),'utf8'),fs.readFileSync(new URL('../../api-server/src/lib/defaultCardAvatar.ts',import.meta.url),'utf8'));
});
test('collection keeps an uploaded photo, otherwise cached catalog, otherwise detail image',()=>{
 let enabled,uri;
 const render=vm.runInNewContext(component('CollectionCardArt')+';CollectionCardArt',{exports:{},require:()=>({jsx}),CardArt:'CardArt',useDavaq:(path,on)=>{uri=path;enabled=on;return {data:{target:{imageSrc:'https://catalog.test/fallback.webp'}}}}});
 let result=render({card:{photos:['/objects/my'],image_src:'https://catalog.test/cached',card_id:'kream:123',card_name:'a & b'}});
 assert.equal(result.props.src,'/objects/my');assert.equal(enabled,false);
 result=render({card:{photos:[],image_src:'https://catalog.test/cached',card_id:'kream:123',card_name:'a & b'}});
 assert.equal(result.props.src,'https://catalog.test/cached');assert.equal(enabled,false);
 result=render({card:{photos:[],card_id:'kream:123',card_name:'a & b'}});
 assert.equal(result.props.src,'https://catalog.test/fallback.webp');assert.equal(enabled,true);assert.match(uri,/a%20%26%20b/);
});
function chatCallback(attribute) {
 const source=fs.readFileSync(new URL('../app/chat/[id].tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('chat.tsx',source,99,true,ts.ScriptKind.TSX);let callback;
 function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(ast)===attribute&&n.initializer?.expression?.getText(ast).includes('backgroundTouch.current'))callback=n.initializer.expression.getText(ast);ts.forEachChild(n,visit)}visit(ast);
 return ts.transpileModule('('+callback+')',{compilerOptions:{target:99}}).outputText;
}
test('background taps dismiss composer, message touches and scrolls leave it alone',()=>{
 let dismissed=0;
 const gestureOnMessage={current:false},backgroundTouch={current:{x:10,y:10}};
 const end=vm.runInNewContext(chatCallback('onTouchEnd'),{gestureOnMessage,backgroundTouch,setComposerDismissRequest:fn=>dismissed=fn(dismissed)});
 end({nativeEvent:{pageX:12,pageY:13}});assert.equal(dismissed,1);
 gestureOnMessage.current=true;end({nativeEvent:{pageX:12,pageY:13}});assert.equal(dismissed,1);
 gestureOnMessage.current=false;end({nativeEvent:{pageX:12,pageY:45}});assert.equal(dismissed,1);
});
test('closing input panels keeps draft untouched',()=>{
 const source=fs.readFileSync(new URL('../components/MessageComposer.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('composer.tsx',source,99,true,ts.ScriptKind.TSX);let callback;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[1]?.getText(ast)==='[dismissRequest]')callback=n.arguments[0].getText(ast);ts.forEachChild(n,visit)}visit(ast);
 let stickers=true,attachments=true,keyboard=0;
 const close=vm.runInNewContext(ts.transpileModule('('+callback+')',{compilerOptions:{target:99}}).outputText,{setShowStickers:v=>stickers=v,setShowAttachments:v=>attachments=v,Keyboard:{dismiss:()=>keyboard++}});
 close();assert.equal(stickers,false);assert.equal(attachments,false);assert.equal(keyboard,1);
});
test('collection settings footer is outside scrolling content and reserves tab bar space',()=>{
 const source=fs.readFileSync(new URL('../components/davaq/UI.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('ui.tsx',source,99,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Frame').getText(ast);
 const run=vm.runInNewContext(ts.transpileModule(fn+';Frame',{compilerOptions:{target:99,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:{},require:()=>({jsx,jsxs:jsx}),View:'View',ScrollView:'ScrollView',Stack:{Screen:'Screen'},Pressable:'Pressable',Txt:'Txt',Icon:'Icon',StyleSheet:{hairlineWidth:1},S:{},C:{},useSafeAreaInsets:()=>({top:0,bottom:10}),useRouter:()=>({}),useSegments:()=>['(tabs)','exchanges']});
 const tree=run({title:'collection',children:'cards',footer:'settings'});
 const [screen,scroll,footer]=tree.props.children;
 assert.equal(scroll.type,'ScrollView');assert.equal(footer.props.children,'settings');
 assert(!JSON.stringify(scroll).includes('settings'));assert.equal(footer.props.style.paddingBottom,92);
});
test('native iOS edge navigation is disabled while selecting messages or showing focus actions',()=>{
 const source=fs.readFileSync(new URL('../app/chat/[id].tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('chat.tsx',source,99,true,ts.ScriptKind.TSX);let options;
 function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='Stack.Screen')options=n.attributes.properties.find(p=>p.name?.getText(ast)==='options').initializer.expression.getText(ast);ts.forEachChild(n,visit)}visit(ast);
 const configure=vm.runInNewContext(ts.transpileModule('(Platform,selectionIds,actionMessage)=>('+options+')',{compilerOptions:{target:99}}).outputText);
 assert.equal(configure({OS:'ios'},[],null).gestureEnabled,true);
 assert.equal(configure({OS:'ios'},['selected'],null).gestureEnabled,false);
 assert.equal(configure({OS:'ios'},[],{id:'focused'}).gestureEnabled,false);
 assert.equal(configure({OS:'android'},[],null).gestureEnabled,false);
});
