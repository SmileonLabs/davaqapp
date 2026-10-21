const test = require("node:test");
const assert = require("node:assert/strict");
const { patchApplication, patchGradle } = require("./withAndroidTelecom");
const nativeSource = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "android-telecom/DavaqTelecom.kt"), "utf8",
);
test("prebuild registers exactly one Telecom package across repeated generation", () => {
  const source =
    "package app.davaq.mobile\nclass MainApplication { fun packages() = PackageList(this).packages.apply { } }";
  const once = patchApplication(source, "app.davaq.mobile");
  assert.match(once, /import app\.davaq\.mobile\.telecom\.DavaqTelecomPackage/);
  assert.match(once, /add\(DavaqTelecomPackage\(\)\)/);
  assert.equal(patchApplication(once, "app.davaq.mobile"), once);
});
test("prebuild fails instead of silently omitting a required native module", () => {
  assert.throws(
    () => patchApplication("class MainApplication {}", "app.davaq.mobile"),
    /Unsupported/,
  );
  assert.throws(() => patchGradle("plugins {}"), /Missing dependencies/);
});
test("Telecom dependency is reproducible and idempotent", () => {
  const once = patchGradle("dependencies { implementation('other') }");
  assert.match(once, /androidx.core:core-telecom:1.0.0/);
  assert.equal(patchGradle(once), once);
});
test("full-screen settings bridge is Android 14+, package scoped and requires a visible activity", () => {
  const bridge = nativeSource.match(/@ReactMethod fun openFullScreenIntentSettings[\s\S]*?(?=\n    @ReactMethod)/)?.[0];
  assert.ok(bridge);
  assert.match(bridge, /if \(Build\.VERSION\.SDK_INT < 34\) return@task false/);
  assert.match(bridge, /val activity = context\.currentActivity \?: return@task false/);
  assert.match(bridge, /activity\.isFinishing \|\| activity\.isDestroyed/);
  assert.match(bridge, /Settings\.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT/);
  assert.match(bridge, /Uri\.parse\("package:" \+ context\.packageName\)/);
  assert.match(bridge, /resolveActivity\(context\.packageManager\) == null/);
  assert.match(bridge, /activity\.startActivity\(intent\)/);
  assert.equal(nativeSource.match(/ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT/g)?.length, 1);
});
test("activity lookup uses the installed ReactApplicationContext Java getter instead of an implicit Kotlin module property", () => {
  const fs = require("node:fs"), path = require("node:path");
  const bridgeRoot = path.join(path.dirname(require.resolve("react-native/package.json")),
    "ReactAndroid/src/main/java/com/facebook/react/bridge");
  const reactContext = fs.readFileSync(path.join(bridgeRoot, "ReactContext.java"), "utf8");
  const applicationContext = fs.readFileSync(path.join(bridgeRoot, "ReactApplicationContext.kt"), "utf8");
  const declaration = applicationContext.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ");
  assert.match(declaration, /class ReactApplicationContext\(context: Context\) : ReactContext\(context\.applicationContext\)/);
  assert.match(reactContext, /public @Nullable Activity getCurrentActivity\(\)/);
  const settingsBridge = nativeSource.match(/@ReactMethod fun openFullScreenIntentSettings[\s\S]*?(?=\n    @ReactMethod)/)?.[0];
  assert.match(settingsBridge, /val activity = context\.currentActivity \?: return@task false/);
  assert.doesNotMatch(settingsBridge, /val activity = currentActivity\b/);
});
test("ordinary CallStyle remains while full-screen intent still respects Android special access", () => {
  assert.match(nativeSource, /NotificationCompat\.CallStyle\.forIncomingCall/);
  assert.match(nativeSource, /Build\.VERSION\.SDK_INT < 34 \|\| getSystemService\(NotificationManager::class\.java\)\.canUseFullScreenIntent\(\)/);
  assert.match(nativeSource, /@ReactMethod fun fullScreenIntentAccess/);
  assert.match(nativeSource, /putBoolean\("granted", if \(Build\.VERSION\.SDK_INT >= 34\)/);
});
