import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
process.env.NODE_ENV ??= "production";
expoRequire("@expo/env").load(root);
const settings = resolve(root, ".env.testflight.local");
if (existsSync(settings)) {
  const overrides = parseEnv(readFileSync(settings, "utf8"));
  for (const name of [
    "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_API_BASE_URL",
    "GOOGLE_SERVICES_PLIST",
    "EAS_PROJECT_ID",
  ]) {
    if (overrides[name]) process.env[name] = overrides[name];
  }
}
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["scripts/native-doctor.mjs", "ios", "--cloud"]);
run("eas", ["whoami"]);
// Apple signing and submission authentication are handled by EAS interactively.
// The store build is uploaded to TestFlight; no App Store release is requested.
run("eas", [
  "build",
  "--platform",
  "ios",
  "--profile",
  "testflight",
  "--auto-submit",
  "--auto-submit-with-profile",
  "testflight",
]);
