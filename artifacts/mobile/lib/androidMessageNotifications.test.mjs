import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(readFileSync(new URL("./androidMessageNotifications.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load() {
  const shown = [], channels = [];
  const state = { currentState: "active", owner: "owner", fail: false, onChannel: null };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react-native") return { AppState: state };
    if (name === "./nativePushOwner") return { nativePushMatchesCurrentOwner: async id => id === state.owner };
    if (name === "@notifee/react-native") return {
      default: { createChannel: async c => { channels.push(c); state.onChannel?.(); },
        displayNotification: async n => { if(state.fail) throw Error("denied"); shown.push(n); } },
      AndroidImportance: { HIGH: 4 }, AndroidVisibility: { PRIVATE: 0 },
    };
    throw Error(name);
  }});
  return { ...exports, state, shown, channels };
}
const message = (id="m1", extra={}) => ({messageId: id, notification: {title:"Alice",body:"hello"},
  data: {recipientUserId:"owner",url:"/chat/room",tag:"room-room"}, ...extra});
const context = (pathname="/chats", enabled=true) => () => ({pathname,enabled});
test("foreground message displays once with sound, private lock screen and tap route", async () => {
  const x=load(); await x.displayForegroundMessage(message(),context()); await x.displayForegroundMessage(message(),context());
  assert.equal(x.shown.length,1); assert.equal(x.channels[0].sound,"default");
  assert.equal(x.channels[0].importance,4); assert.equal(x.shown[0].android.channelId,"general-notifications");
  assert.equal(x.shown[0].android.pressAction.launchActivity,"default"); assert.equal(x.shown[0].data.url,"/chat/room");
});
test("room being read, disabled notifications, wrong owner and calls do not alert", async () => {
  const x=load(); await x.displayForegroundMessage(message(),context("/chat/room"));
  await x.displayForegroundMessage(message(),context("/chats",false));
  await x.displayForegroundMessage(message("call",{data:{recipientUserId:"owner",type:"incoming_call"}}),context());
  x.state.owner="someone-else"; await x.displayForegroundMessage(message(),context()); assert.equal(x.shown.length,0);
});
test("account change while creating channel does not expose prior account content", async () => {
  const x=load(); x.state.onChannel=()=>{x.state.owner="other"};
  await x.displayForegroundMessage(message(),context()); assert.equal(x.shown.length,0);
});
test("failed display can retry and distinct messages in same room still alert", async () => {
  const x=load(); x.state.fail=true; await assert.rejects(x.displayForegroundMessage(message(),context()));
  x.state.fail=false; await x.displayForegroundMessage(message(),context());
  await x.displayForegroundMessage(message("m2"),context()); assert.equal(x.shown.length,2);
});
test("notification routes reject external and protocol-relative paths",()=>{
  const x=load(); assert.equal(x.notificationUrlFromData({url:"/chat/room"}),"/chat/room");
  for(const url of ["https://evil.example","//evil.example","/\\evil.example","/chat/room\n"]) {
    assert.equal(x.notificationUrlFromData({url}),null);
  }
});
