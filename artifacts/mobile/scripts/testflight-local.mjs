import { spawnSync } from "node:child_process";
import { loadReleaseLogin } from "./release-login-config.mjs";
import { createRequire } from "node:module";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
process.env.NODE_ENV = "production";
expoRequire("@expo/env").load(root);
const local = resolve(root, ".env.testflight.local");
if (existsSync(local)) {
  const settings = parseEnv(readFileSync(local, "utf8"));
  for (const key of ["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "EXPO_PUBLIC_API_BASE_URL", "GOOGLE_SERVICES_PLIST", "DAVAQ_IOS_BUILD_NUMBER", "DAVAQ_IOS_PROVISIONING_PROFILE"]) {
    if (settings[key] && !(key === "DAVAQ_IOS_BUILD_NUMBER" && process.env[key])) process.env[key] = settings[key];
  }
}
Object.assign(process.env, loadReleaseLogin(root));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["scripts/native-doctor.mjs", "ios"]);
if (process.argv.includes("--check")) process.exit(0);
if (!process.argv.includes("--skip-prebuild")) {
  run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--no-install"]);
  run("pod", ["install"], resolve(root, "ios"));
}
const profile = process.env.DAVAQ_IOS_PROVISIONING_PROFILE;
if (profile) {
  run("ruby", ["-rxcodeproj", "-e", `
    project = Xcodeproj::Project.open('ios/DavaQ.xcodeproj')
    target = project.targets.find { |item| item.name == 'DavaQ' }
    target.build_configurations.each do |config|
      next unless config.name == 'Release'
      config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
      config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
      config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ENV.fetch('DAVAQ_IOS_PROVISIONING_PROFILE')
      config.build_settings['DEVELOPMENT_TEAM'] = 'B763M3724N'
    end
    project.save
  `]);
}
// Keep the archived build number consistent even when prebuild is skipped.
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleVersion $(CURRENT_PROJECT_VERSION)", resolve(root, "ios/DavaQ/Info.plist")]);
const archive = resolve(root, process.env.DAVAQ_IOS_ARCHIVE_PATH || "../../.local/ios/DavaQ.xcarchive");
mkdirSync(resolve(root, "../../.local/ios"), { recursive: true });
run("xcodebuild", [
  "-workspace", "ios/DavaQ.xcworkspace", "-scheme", "DavaQ",
  "-configuration", "Release", "-destination", "generic/platform=iOS",
  "-jobs", process.env.DAVAQ_IOS_BUILD_JOBS || "2",
  "-archivePath", archive, "-allowProvisioningUpdates",
  "DEVELOPMENT_TEAM=B763M3724N",
  ...(!profile ? ["CODE_SIGN_STYLE=Automatic"] : []),
  `CURRENT_PROJECT_VERSION=${process.env.DAVAQ_IOS_BUILD_NUMBER || "1"}`, "archive",
]);
console.log(`Archive ready: ${archive}`);
if (!process.argv.includes("--archive-only")) {
  const options = resolve(root, "../../.local/ios/ExportOptions.plist");
  writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>signingStyle</key><string>${profile ? "manual" : "automatic"}</string>
${profile ? `<key>provisioningProfiles</key><dict><key>app.davaq.mobile</key><string>${profile.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</string></dict><key>signingCertificate</key><string>Apple Distribution</string>` : ""}
<key>teamID</key><string>B763M3724N</string>
<key>manageAppVersionAndBuildNumber</key><true/>
<key>uploadSymbols</key><true/>
</dict></plist>\n`);
  run("xcodebuild", ["-exportArchive", "-archivePath", archive,
    "-exportOptionsPlist", options, "-exportPath", resolve(root, "../../.local/ios/export"),
    "-allowProvisioningUpdates"]);
  console.log("Upload completed. Check App Store Connect TestFlight for Apple's processing result.");
}
