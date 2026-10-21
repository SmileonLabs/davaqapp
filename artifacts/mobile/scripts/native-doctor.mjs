import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const platform = process.argv[2];
const cloud = process.argv.includes("--cloud");
if (!["ios", "android"].includes(platform)) {
  console.error("Usage: node scripts/native-doctor.mjs ios|android [--cloud]");
  process.exit(1);
}
// Use Expo's own dotenv loader so doctor and expo run see identical settings.
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
const { load } = expoRequire("@expo/env");
process.env.NODE_ENV ??= "development";
load(root);
let failed = false;
function check(name, ok, detail) {
  console.log(`${ok ? "OK" : "MISSING"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}
function command(name, args) {
  const result = spawnSync(name, args, { encoding: "utf8" });
  check(
    name,
    result.status === 0,
    result.status === 0 ? undefined : "install/configure this tool",
  );
}
check(
  "Clerk publishable key",
  Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY),
);
const api = process.env.EXPO_PUBLIC_API_BASE_URL;
let validApi = false;
try {
  validApi = ["http:", "https:"].includes(new URL(api).protocol);
} catch {}
check(
  "API URL",
  validApi,
  "EXPO_PUBLIC_API_BASE_URL (use a host reachable from the device)",
);
const key =
  platform === "ios" ? "GOOGLE_SERVICES_PLIST" : "GOOGLE_SERVICES_JSON";
const serviceFile = process.env[key];
const servicePath = serviceFile ? resolve(root, serviceFile) : "";
check("Firebase config", Boolean(servicePath && existsSync(servicePath)), key);
if (platform === "android" && servicePath && existsSync(servicePath)) {
  let matches = false;
  try {
    const services = JSON.parse(readFileSync(servicePath, "utf8"));
    const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
    matches = services.client?.some(
      (c) =>
        c.client_info?.android_client_info?.package_name ===
        app.expo.android.package,
    );
  } catch {}
  check("Firebase Android package", matches, "must match app.davaq.mobile");
}
if (platform === "ios" && servicePath && existsSync(servicePath)) {
  const plist = spawnSync(
    "plutil",
    ["-extract", "BUNDLE_ID", "raw", "-o", "-", servicePath],
    { encoding: "utf8" },
  );
  const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
  check(
    "Firebase iOS bundle",
    plist.status === 0 && plist.stdout.trim() === app.expo.ios.bundleIdentifier,
    "must match " + app.expo.ios.bundleIdentifier,
  );
}
if (cloud) {
  check(
    "EAS project",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      process.env.EAS_PROJECT_ID ?? "",
    ),
    "EAS_PROJECT_ID",
  );
} else if (platform === "ios") {
  command("xcodebuild", ["-version"]);
  command("pod", ["--version"]);
} else {
  command("java", ["-version"]);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  check("Android SDK", Boolean(sdk && existsSync(sdk)), "ANDROID_HOME");
}
console.log(
  "CallKit/PushKit and Telecom integration require a separate real-device acceptance test.",
);
process.exitCode = failed ? 1 : 0;
