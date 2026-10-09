const fs = require("node:fs");
const path = require("node:path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require("expo/config-plugins");
function patchApplication(source, pkg) {
  const statement = "import " + pkg + ".telecom.DavaqTelecomPackage";
  if (!source.includes(statement))
    source = source.replace(/^(package .*\n)/m, "$1\n" + statement + "\n");
  if (!source.includes("add(DavaqTelecomPackage())")) {
    const anchor = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    if (!anchor.test(source))
      throw new Error("Unsupported MainApplication Kotlin template");
    source = source.replace(anchor, "$1\n          add(DavaqTelecomPackage())");
  }
  return source;
}
function patchGradle(source) {
  if (!source.includes("androidx.core:core-telecom:1.0.0")) {
    if (!source.includes("dependencies {"))
      throw new Error("Missing dependencies block");
    source = source.replace(
      "dependencies {",
      'dependencies {\n    implementation("androidx.core:core-telecom:1.0.0")',
    );
  }
  return source;
}
module.exports = function withAndroidTelecom(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest["uses-permission"] ??= [];
    for (const name of [
      "android.permission.MANAGE_OWN_CALLS",
      "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
    ]) {
      if (
        !manifest["uses-permission"].some((p) => p.$["android:name"] === name)
      )
        manifest["uses-permission"].push({ $: { "android:name": name } });
    }
    const app = manifest.application[0];
    // Never back up device-owned call actions, account leases or message caches.
    app.$["android:allowBackup"] = "false";
    app.service ??= [];
    if (
      !app.service.some(
        (s) => s.$["android:name"] === ".telecom.DavaqCallService",
      )
    ) {
      app.service.push({
        $: {
          "android:name": ".telecom.DavaqCallService",
          "android:exported": "false",
          "android:foregroundServiceType": "phoneCall|microphone|camera",
          "android:stopWithTask": "false",
        },
      });
    }
    app.receiver ??= [];
    if (
      !app.receiver.some(
        (s) => s.$["android:name"] === ".telecom.DavaqCallReceiver",
      )
    )
      app.receiver.push({
        $: {
          "android:name": ".telecom.DavaqCallReceiver",
          "android:exported": "false",
        },
      });
    app.activity ??= [];
    if (
      !app.activity.some(
        (s) => s.$["android:name"] === ".telecom.DavaqCallActionActivity",
      )
    )
      app.activity.push({
        $: {
          "android:name": ".telecom.DavaqCallActionActivity",
          "android:exported": "false",
          "android:excludeFromRecents": "true",
          "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
          "android:showWhenLocked": "true",
        },
      });
    const main = app.activity.find(
      (a) => a.$["android:name"] === ".MainActivity",
    );
    if (main) {
      delete main.$["android:showWhenLocked"];
      delete main.$["android:turnScreenOn"];
    }
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = patchGradle(mod.modResults.contents);
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    mod.modResults.contents = patchApplication(
      mod.modResults.contents,
      mod.android.package,
    );
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const pkg = mod.android.package;
      const dest = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/java",
        ...pkg.split("."),
        "telecom",
      );
      fs.mkdirSync(dest, { recursive: true });
      const source = fs
        .readFileSync(
          path.join(__dirname, "android-telecom/DavaqTelecom.kt"),
          "utf8",
        )
        .replaceAll("__PACKAGE__", pkg);
      fs.writeFileSync(path.join(dest, "DavaqTelecom.kt"), source);
      return mod;
    },
  ]);
};
module.exports.patchApplication = patchApplication;
module.exports.patchGradle = patchGradle;
