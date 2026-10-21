const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const configure = require("../app.config.js");
const base = require("../app.json").expo;

test("APNs entitlement follows local development and release signing", () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(configure({ config: base }).ios.entitlements["aps-environment"], "production");
    process.env.NODE_ENV = "development";
    assert.equal(configure({ config: base }).ios.entitlements["aps-environment"], "development");
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

test("native service files and project are opt-in, and base config is preserved", () => {
  const keys = [
    "GOOGLE_SERVICES_JSON",
    "GOOGLE_SERVICES_PLIST",
    "EAS_PROJECT_ID",
  ];
  const saved = keys.map((k) => process.env[k]);
  try {
    keys.forEach((k) => delete process.env[k]);
    const result = configure({ config: base });
    assert.equal(result.android.package, "app.davaq.mobile");
    const localService = path.resolve(__dirname, "../google-services.json");
    assert.equal(result.android.googleServicesFile, fs.existsSync(localService) ? localService : undefined);
    assert.equal(result.extra.eas, undefined);
    assert.ok(
      result.ios.infoPlist.UIBackgroundModes.includes("remote-notification"),
    );
    const fixture = path.join(os.tmpdir(), `davaq-firebase-config-${process.pid}.json`);
    fs.writeFileSync(fixture, JSON.stringify({ project_info: { project_id: "davaq-43e77" }, client: [{ client_info: { android_client_info: { package_name: "app.davaq.mobile" } } }] }));
    process.env.GOOGLE_SERVICES_JSON = fixture;
    process.env.GOOGLE_SERVICES_PLIST = "/tmp/ios.plist";
    process.env.EAS_PROJECT_ID = "project";
    const configured = configure({ config: base });
    assert.equal(configured.android.googleServicesFile, fixture);
    assert.equal(configured.android.versionCode, Math.max(base.android?.versionCode ?? 0, 13));
    assert.ok(configured.plugins.includes("./plugins/withAndroidTelecom"));
    fs.unlinkSync(fixture);
    assert.equal(configured.ios.googleServicesFile, "/tmp/ios.plist");
    assert.equal(configured.extra.eas.projectId, "project");
    assert.equal(base.android.googleServicesFile, undefined);
  } finally {
    keys.forEach((k, i) =>
      saved[i] === undefined
        ? delete process.env[k]
        : (process.env[k] = saved[i]),
    );
  }
});

test("development EAS profile does not pin production API", () => {
  const eas = require("../eas.json");
  assert.equal(eas.build.development.env?.EXPO_PUBLIC_API_BASE_URL, undefined);
  assert.equal(eas.build.development.pnpm, "10.26.1");
  assert.equal(eas.build["development-simulator"].ios.simulator, true);
});

test("Android selected-media config blocks broad reads and unused playback without blocking calls or old saves", () => {
  const blocked = [
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  ];
  const result = configure({ config: { ...base, android: { ...base.android, blockedPermissions: [blocked[0], "android.permission.READ_CONTACTS"] } } });
  assert.deepEqual(result.android.blockedPermissions, [blocked[0], "android.permission.READ_CONTACTS", ...blocked.slice(1)]);
  for (const permission of ["WRITE_EXTERNAL_STORAGE", "CAMERA", "RECORD_AUDIO", "FOREGROUND_SERVICE_PHONE_CALL", "FOREGROUND_SERVICE_MICROPHONE", "FOREGROUND_SERVICE_CAMERA"])
    assert.equal(result.android.blockedPermissions.includes("android.permission." + permission), false);
  assert.equal(result.ios.infoPlist.NSPhotoLibraryAddUsageDescription, "사진을 기기 앨범에 저장하려면 사진 추가 권한을 허용해 주세요.");
});

test("TestFlight creates a signed store build without the development client", () => {
  const eas = require("../eas.json");
  assert.equal(eas.build.testflight.extends, "production");
  assert.equal(eas.build.testflight.distribution, "store");
  assert.equal(eas.build.testflight.autoIncrement, true);
  assert.equal(eas.build.testflight.ios.simulator, false);
  assert.notEqual(eas.build.production.developmentClient, true);
  assert.ok(eas.submit.testflight);
});
