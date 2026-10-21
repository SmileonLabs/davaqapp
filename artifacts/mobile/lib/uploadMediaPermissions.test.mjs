import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture({ platform = "android", libraryGranted = false, cameraGranted = true, microphoneGranted = true, canceled = false } = {}) {
  const calls = [], uploads = [], selected = [0, 1].map(index => ({
    uri: `content://system-picker/${index}`, width: 100, height: 120,
    fileName: `${index}.jpg`, mimeType: "image/jpeg",
  }));
  const imagePicker = {
    requestMediaLibraryPermissionsAsync: async () => { calls.push("library-permission"); return { granted: libraryGranted }; },
    requestCameraPermissionsAsync: async () => { calls.push("camera-permission"); return { granted: cameraGranted }; },
    launchImageLibraryAsync: async options => { calls.push({ picker: "library", options }); return { canceled, assets: options.mediaTypes[0] === "images" ? selected : [selected[0]] }; },
    launchCameraAsync: async options => { calls.push({ picker: "camera", options }); return { canceled, assets: [selected[0]] }; },
    UIImagePickerControllerQualityType: { Medium: "medium" },
  };
  class Request {
    upload = {};
    status = 200;
    open() {}
    setRequestHeader() {}
    send() { queueMicrotask(() => this.onload()); }
    abort() { this.onabort?.(); }
  }
  const modules = {
    "react-native": { Platform: { OS: platform } },
    "expo-image-picker": imagePicker,
    "expo-document-picker": {},
    "expo-audio": { requestRecordingPermissionsAsync: async () => { calls.push("microphone-permission"); return { granted: microphoneGranted }; } },
    "@workspace/api-client-react": { requestUploadUrl: async request => {
      uploads.push(request);
      return { uploadURL: "https://upload.invalid/selected-item", objectPath: `/objects/${uploads.length}` };
    } },
    "./chatImagePreparation": { prepareChatImage: async asset => ({ ...asset, thumbnail: "preview" }) },
    "./convertHeic": { convertHeicIfNeeded: async (blob, name, contentType) => ({ blob, name, contentType }) },
    "./chatUploadTemp": { removeGeneratedMedia: async () => {} },
    "./chatVideoPreparation": { prepareChatVideo: async asset => ({ uri: asset.uri, compressed: false, durationSec: 2 }) },
  };
  function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, require: name => { assert.ok(modules[name], "Unexpected upload dependency: " + name); return modules[name]; },
      fetch: async () => ({ blob: async () => new Blob(["selected-content"], { type: "image/jpeg" }) }),
      XMLHttpRequest: Request, AbortController, URLSearchParams, setTimeout, clearTimeout,
      Date, Math, Promise,
    });
    return exports;
  }
  const image = load("./uploadImage.ts");
  modules["./uploadImage"] = image;
  const video = load("./uploadFile.ts");
  return { image, video, calls, uploads };
}

test("Android uploads selected photos when broad library access is denied without requesting it", async () => {
  const f = fixture();
  const result = await f.image.pickAndUploadImages();
  assert.equal(result.length, 2);
  assert.equal(f.uploads.length, 2);
  assert.equal(f.calls.includes("library-permission"), false);
  assert.equal(f.calls[0].picker, "library");
  assert.equal(f.calls[0].options.allowsMultipleSelection, true);
  assert.equal(f.calls[0].options.selectionLimit, 10);
  assert.equal(result[1].objectPath, "/objects/2");
});

test("Android uploads a selected video without library, camera or microphone permission", async () => {
  const f = fixture();
  const result = await f.video.pickAndUploadVideo(false);
  assert.equal(result.objectPath, "/objects/1");
  assert.equal(f.uploads.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].picker, "library");
  assert.deepEqual(Array.from(f.calls[0].options.mediaTypes), ["videos"]);
});

test("canceling the Android picker never uploads a photo or video", async () => {
  const f = fixture({ canceled: true });
  assert.equal(await f.image.pickAndUploadImages(), null);
  assert.equal(await f.video.pickAndUploadVideo(false), null);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.calls.some(call => typeof call === "string"), false);
});

test("iOS library permission denial still prevents selecting and uploading photos or videos", async () => {
  const f = fixture({ platform: "ios" });
  await assert.rejects(f.image.pickAndUploadImages(), error => error.name === "PermissionDeniedError");
  await assert.rejects(f.video.pickAndUploadVideo(false), /video-permission-denied/);
  assert.deepEqual(f.calls, ["library-permission", "library-permission"]);
  assert.equal(f.uploads.length, 0);
  const allowed = fixture({ platform: "ios", libraryGranted: true });
  assert.equal((await allowed.image.pickAndUploadImages()).length, 2);
  assert.equal((await allowed.video.pickAndUploadVideo(false)).objectPath, "/objects/3");
  assert.equal(allowed.calls.filter(call => call === "library-permission").length, 2);
});

test("native camera denial and video microphone denial remain enforced before picker launch", async () => {
  for (const platform of ["android", "ios"]) {
    const denied = fixture({ platform, cameraGranted: false });
    await assert.rejects(denied.image.pickAndUploadImages({ camera: true }), error => error.name === "PermissionDeniedError");
    await assert.rejects(denied.video.pickAndUploadVideo(true), /video-permission-denied/);
    assert.equal(denied.calls.some(call => typeof call === "object"), false);
    assert.equal(denied.uploads.length, 0);
    const microphone = fixture({ platform, microphoneGranted: false });
    await assert.rejects(microphone.video.pickAndUploadVideo(true), /video-permission-denied/);
    assert.deepEqual(microphone.calls, ["camera-permission", "microphone-permission"]);
    assert.equal(microphone.uploads.length, 0);
  }
});

test("Android camera photo and video preserve camera and recording permission requests", async () => {
  const f = fixture();
  await f.image.pickAndUploadImages({ camera: true });
  await f.video.pickAndUploadVideo(true);
  assert.deepEqual(f.calls.filter(call => typeof call === "string"), ["camera-permission", "camera-permission", "microphone-permission"]);
  assert.equal(f.calls.filter(call => call.picker === "camera").length, 2);
  assert.equal(f.uploads.length, 2);
});
