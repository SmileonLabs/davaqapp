// Local macOS/Linux Play build; secrets remain in the child process environment.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadReleaseLogin } from "./release-login-config.mjs";
const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = resolve(process.env.DAVAQ_ANDROID_SIGNING_FILE || resolve(mobile, ".local-signing/credentials.json"));
function fail(message) { console.error(message); process.exit(1); }
if (!existsSync(config)) fail(`Existing upload signing credentials required: ${config}`);
const signing = JSON.parse(readFileSync(config, "utf8"));
const keystore = resolve(dirname(config), signing.keystorePath || "");
if (!signing.keystorePath || !existsSync(keystore) || !signing.keystorePassword || !signing.keyAlias || !signing.keyPassword)
  fail("Upload signing configuration is incomplete; do not replace the existing upload key.");
if (!process.env.JAVA_HOME || !existsSync(resolve(process.env.JAVA_HOME, "bin/java"))) fail("Set JAVA_HOME to JDK 17.");
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !existsSync(resolve(sdk, "platforms/android-36/android.jar"))) fail("Android SDK platform 36 is required.");
const firebase = process.env.DAVAQ_GOOGLE_SERVICES_JSON || process.env.GOOGLE_SERVICES_JSON || resolve(mobile, "google-services.json");
if (!existsSync(firebase)) fail("DavaQ Firebase Android configuration is required.");
const versionCode = Math.max(JSON.parse(readFileSync(resolve(mobile, "app.json"), "utf8")).expo.android.versionCode || 0, 13);
const env = { ...process.env, ...loadReleaseLogin(mobile), NODE_ENV: "production", CI: "1", ANDROID_HOME: sdk,
  DAVAQ_GOOGLE_SERVICES_JSON: firebase,
  DAVAQ_ANDROID_KEYSTORE_PATH: keystore,
  DAVAQ_ANDROID_STORE_PASSWORD: signing.keystorePassword,
  DAVAQ_ANDROID_KEY_ALIAS: signing.keyAlias,
  DAVAQ_ANDROID_KEY_PASSWORD: signing.keyPassword,
  EXPO_PUBLIC_API_BASE_URL: "https://davaq.app",
  EXPO_PUBLIC_DOMAIN: "davaq.app",
};
function run(command, args, cwd = mobile) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv.includes("--check")) { console.log("Android signing and build prerequisites ready."); process.exit(0); }
if (!process.argv.includes("--skip-prebuild")) run("pnpm", ["exec", "expo", "prebuild", "--platform", "android", "--no-install"]);
// Gradle does not track EXPO_PUBLIC environment changes as bundle inputs.
rmSync(resolve(mobile, "android/app/build/generated/assets/createBundleReleaseJsAndAssets"), { recursive: true, force: true });
run("./gradlew", ["bundleRelease", "assembleRelease", "-PreactNativeArchitectures=arm64-v8a", "--no-daemon", `--max-workers=${process.env.DAVAQ_ANDROID_BUILD_WORKERS || "2"}`, "--console=plain"], resolve(mobile, "android"));
run("python3", ["-c", `import os, zipfile
for path, entry in [("android/app/build/outputs/apk/release/app-release.apk", "assets/index.android.bundle"), ("android/app/build/outputs/bundle/release/app-release.aab", "base/assets/index.android.bundle")]:
 with zipfile.ZipFile(path) as archive:
  bundle = archive.read(entry)
 assert os.environ["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"].encode() in bundle, "Release login configuration missing from " + path
 assert os.environ["EXPO_PUBLIC_API_BASE_URL"].encode() in bundle, "Production API missing from " + path
print("APK/AAB embedded release login and production API verified.")`]);
run(process.execPath, ["scripts/verify-android-apk.js", "android/app/build/outputs/apk/release/app-release.apk", String(versionCode), "--release"]);
run("python3", ["scripts/verify-android-elf.py", "android/app/build/outputs/apk/release/app-release.apk"]);
console.log("Signed APK/AAB generated. Google Play upload has not been performed.");
