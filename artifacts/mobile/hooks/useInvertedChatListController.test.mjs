import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(os = "ios", options = {}) {
  const slots = [],
    effects = [],
    frames = new Map(),
    timers = new Map(),
    calls = [];
  let cursor = 0,
    id = 0;
  const react = {
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === "function" ? next(slots[i]) : next;
        },
      ];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j]))
        slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps?.some((d, j) => d !== previous.deps[j])) {
        const next = { deps, cleanup: undefined };
        slots[i] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
      }
    },
  };
  class Value {
    setValue() {}
    stopAnimation() {}
  }
  const out = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("./useInvertedChatListController.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports: out,
      require(name) {
        if (name === "react") return react;
        if (name === "react-native")
          return { Platform: { OS: os }, Keyboard: { addListener: () => ({ remove() {} }) }, Animated: { Value, timing: () => ({ start() {} }) } };
        if (name.includes("useChatReadTracking"))
          return {
            useChatReadTracking: () => ({
              captured: true,
              markLatestRead() {},
              clearEntryUnread() {},
            }),
          };
        throw Error(name);
      },
      requestAnimationFrame(fn) {
        frames.set(++id, fn);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
      setTimeout(fn, ms) {
        timers.set(++id, { fn, ms });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );
  let messages = options.messages ?? [
    { id: "old", senderId: "other" },
    { id: "new", senderId: "other" },
  ];
  let roomId = "room";
  let messagesReady = true;
  let readingPosition = options.readingPosition ?? null;
  let hasOlder = options.hasOlder ?? false;
  const savedPositions = [];
  const ready = () => {};
  function render() {
    cursor = 0;
    const list = out.useInvertedChatListController({
      roomId,
      messagesReady,
      readingPosition,
      positionReady: options.positionReady ?? true,
      savePosition: value => savedPositions.push(value),
      hasOlder,
      loadOlder: options.loadOlder,
      viewerId: "me",
      messages,
      visibleMessages: messages,
      listMessages: messages,
      isDungeon: false,
      onInitialScrollReady: ready,
    });
    list.listRef.current = {
      scrollToEnd: (v) => calls.push({ kind: "end", ...v }),
      scrollToOffset: (v) => calls.push({ kind: "offset", ...v }),
      scrollToIndex: (v) => calls.push({ kind: "index", ...v }),
    };
    effects.splice(0).forEach((fn) => fn());
    return list;
  }
  function flushFrames() {
    while (frames.size) {
      const work = [...frames.values()];
      frames.clear();
      work.forEach((fn) => fn());
    }
  }
  render();
  flushFrames();
  const scroll = (list, y, user = true) => {
    if (user) list.onScrollBeginDrag();
    list.onScroll({ nativeEvent: { contentOffset: { y }, contentSize: { height: 2000 }, layoutMeasurement: { height: 500 } } });
    if (user) list.onScrollEndDrag();
  };
  return {
    render,
    scroll,
    calls,
    savedPositions,
    setMessages(value) { messages = value; render(); },
    setHasOlder(value) { hasOlder = value; render(); },
    flushFrames,
    setMessagesReady(value) { messagesReady = value; render(); },
    incoming(senderId = "other") {
      messages = [...messages, { id: `new-${messages.length}`, senderId }];
      render();
    },
    temporary() {
      messages = [...messages, { id: "temp-pending", senderId: "me" }];
      render();
    },
    acknowledge() {
      messages = messages.map(message => message.id === "temp-pending" ? { ...message, id: "acknowledged" } : message);
      render();
    },
    history() {
      messages = [{ id: "history", senderId: "other" }, ...messages];
      render();
    },
    switchRoom() {
      roomId = "other-room";
      render();
      flushFrames();
    },
    flushRetries() {
      for (const [id, t] of timers)
        if (t.ms === 60) {
          timers.delete(id);
          t.fn();
        }
    },
  };
}

test("latest jump survives intermediate animated offsets and hides only after arrival", () => {
  const f = fixture();
  let list = f.render();
  f.scroll(list, 500);
  list = f.render();
  assert.equal(list.showScrollDown, false);
  f.incoming();
  list = f.render();
  assert.equal(list.showScrollDown, true);
  const before = f.calls.length;
  list.jumpToBottom();
  assert.equal(f.calls.length, before + 1);
  assert.equal(f.calls.at(-1).offset, 0);
  f.scroll(list, 300, false);
  list.onContentSizeChange();
  f.flushFrames();
  assert.equal(f.calls.at(-1).offset, 0);
  f.scroll(list, 0);
  assert.equal(f.render().showScrollDown, false);
});

test("a delayed reply-scroll failure cannot undo a newer latest-message jump", () => {
  const f = fixture();
  const list = f.render();
  list.scrollToMessage("old");
  list.onScrollToIndexFailed({
    index: 1,
    highestMeasuredFrameIndex: 0,
    averageItemLength: 80,
  });
  list.jumpToBottom();
  const before = f.calls.length;
  f.flushRetries();
  assert.equal(f.calls.length, before);
  list.onScrollBeginDrag();
  f.scroll(list, 300);
  assert.equal(f.render().showScrollDown, false);
});

test("history, own messages and optimistic acknowledgements do not expose the incoming-message overlay", () => {
  const f = fixture();
  f.scroll(f.render(), 500);
  f.history();
  assert.equal(f.render().showScrollDown, false);
  f.incoming("me");
  assert.equal(f.render().showScrollDown, false);
  f.temporary();
  assert.equal(f.render().showScrollDown, false);
  f.acknowledge();
  assert.equal(f.render().showScrollDown, false);
  f.incoming();
  assert.equal(f.render().showScrollDown, true);
  f.scroll(f.render(), 0);
  assert.equal(f.render().showScrollDown, false);
  f.scroll(f.render(), 500);
  assert.equal(f.render().showScrollDown, false);
});

test("delivery at the latest row and switching rooms clear the overlay", () => {
  const f = fixture();
  f.incoming();
  assert.equal(f.render().showScrollDown, false);
  f.scroll(f.render(), 500);
  f.incoming();
  assert.equal(f.render().showScrollDown, true);
  f.switchRoom();
  assert.equal(f.render().showScrollDown, false);
});

test("keyboard layout offsets keep the latest row visible without fighting a history drag", () => {
 const f=fixture(); let list=f.render(); const before=f.calls.length;
 f.scroll(list,180,false); list.onLayout({nativeEvent:{layout:{y:0,height:250}}}); f.flushFrames();
 assert.equal(f.calls.length,before+1); assert.equal(f.calls.at(-1).offset,0);
 f.scroll(f.render(),400); const history=f.calls.length;
 f.render().onLayout({nativeEvent:{layout:{y:0,height:500}}}); f.flushFrames();
 assert.equal(f.calls.length,history);
 f.render().forceStickToBottom(); f.flushFrames(); assert.equal(f.calls.at(-1).offset,0);
});
test("room entry waits for actual data and reveals it without a fixed delay", () => {
 const f=fixture(); f.setMessagesReady(false); f.switchRoom(); assert.equal(f.render().listReady,false);
 f.setMessagesReady(true); f.flushFrames(); assert.equal(f.render().listReady,true);
});

test('desktop wheel intent lets history scroll instead of snapping to latest',()=>{
 const f=fixture(),list=f.render();const before=f.calls.length;
 list.onWebWheel();f.scroll(list,400,false);f.flushFrames();
 assert.equal(f.calls.length,before);
});

test("web uses ordinary bottom distance and never snaps history after wheel intent expires", () => {
 const f=fixture("web"); let list=f.render();
 assert.equal(f.calls.at(-1).kind,"end");
 f.scroll(list,1500,false); const before=f.calls.length;
 list.onWebWheel(); f.scroll(list,1200,false); list.onScrollEndDrag(); list.onContentSizeChange(); f.flushFrames();
 assert.equal(f.calls.length,before);
 list.jumpToBottom(); assert.equal(f.calls.at(-1).kind,"end");
});

test('saved reading anchor restores by identity; measured positioning also supports viewport-tall rows',()=>{
 const f=fixture('ios',{readingPosition:{messageId:'old',roomSeq:1,atLatest:false,savedAt:Date.now()}});
 const list=f.render();assert.equal(f.calls.at(-1).kind,'index');assert.equal(f.calls.at(-1).index,0);assert.equal(list.listReady,true);
 list.onViewableItemsChanged({viewableItems:[{item:{id:'old',roomSeq:1},index:0,isViewable:true}],changed:[]});
 assert.equal(f.render().listReady,true);assert.equal(f.savedPositions.at(-1).messageId,'old');assert.equal(f.savedPositions.at(-1).atLatest,false);
});
test('a saved latest position retains the normal latest-follow behavior',()=>{
 const f=fixture('ios',{readingPosition:{messageId:'old',roomSeq:1,atLatest:true,savedAt:Date.now()}});
 assert.equal(f.calls.at(-1).kind,'offset');assert.equal(f.calls.at(-1).offset,0);assert.equal(f.render().listReady,true);
});
test('failed anchor history fetch exposes retry instead of silently losing the reading position',async()=>{
 const f=fixture('ios',{messages:[{id:'latest',roomSeq:100,senderId:'other'}],readingPosition:{messageId:'missing',roomSeq:1,atLatest:false,savedAt:Date.now()},hasOlder:true,loadOlder:async()=>{throw Error('offline')}});
 f.setMessages([{id:'latest',roomSeq:100,senderId:'other'}]);await new Promise(setImmediate);
 assert.match(f.render().restoreError,/읽던 위치/);assert.equal(f.render().listReady,false);
 f.render().skipRestore();f.flushFrames();assert.equal(f.render().listReady,true);assert.equal(f.calls.at(-1).offset,0);
});
test('web prepend compensates only after older data lands, not for the loading indicator',async()=>{
 const f=fixture('web',{loadOlder:async()=>50});let list=f.render();f.scroll(list,300);await list.loadPrevious();
 const before=f.calls.length;list.onContentSizeChange(300,2020);assert.equal(f.calls.length,before);
 f.setMessages([{id:'earlier',roomSeq:1,senderId:'other'},{id:'old',roomSeq:2,senderId:'other'},{id:'new',roomSeq:3,senderId:'other'}]);
 f.render().onContentSizeChange(300,2400);assert.equal(f.calls.at(-1).offset,700);
});
test('restoration continues after older-page cache updates while the request is still settling',async()=>{
 let release;const gate=new Promise(r=>release=r);let calls=0;
 const f=fixture('ios',{messages:[{id:'latest',roomSeq:100,senderId:'other'}],readingPosition:{messageId:'saved',roomSeq:1,atLatest:false,savedAt:Date.now()},hasOlder:true,loadOlder:async()=>{calls++;await gate;return 50}});
 assert.equal(calls,1);assert.equal(f.render().listReady,false);
 f.setMessages([{id:'saved',roomSeq:1,senderId:'other'},{id:'latest',roomSeq:100,senderId:'other'}]);release();await new Promise(setImmediate);let list=f.render();f.flushFrames();
 assert.equal(f.calls.at(-1).kind,'index');
 list.onViewableItemsChanged({viewableItems:[{item:{id:'saved',roomSeq:1},index:0,isViewable:true}],changed:[]});assert.equal(f.render().listReady,true);
});
test('an authoritative reset reloads the active reading anchor instead of jumping to the latest window',async()=>{
 let calls=0;const gate=new Promise(()=>{});
 const f=fixture('ios',{messages:[{id:'old',roomSeq:1,senderId:'other'},{id:'new',roomSeq:2,senderId:'other'}],hasOlder:true,loadOlder:()=>{calls++;return gate}});
 let list=f.render();f.scroll(list,400);list.onViewableItemsChanged({viewableItems:[{item:{id:'old',roomSeq:1},index:0,isViewable:true}],changed:[]});
 f.setMessages([{id:'latest',roomSeq:100,senderId:'other'}]);assert.equal(calls,1);assert.equal(f.render().listReady,false);
});
test('sending while history restoration is pending wins over a late restore failure',async()=>{
 let reject;const gate=new Promise((_r,j)=>reject=j);
 const f=fixture('ios',{messages:[{id:'latest',roomSeq:100,senderId:'other'}],readingPosition:{messageId:'old',roomSeq:1,atLatest:false,savedAt:Date.now()},hasOlder:true,loadOlder:()=>gate});
 f.render().forceStickToBottom();f.flushFrames();reject(Error('offline'));await new Promise(setImmediate);
 const list=f.render();assert.equal(list.listReady,true);assert.equal(list.restoreError,'');assert.equal(f.calls.at(-1).offset,0);
});
