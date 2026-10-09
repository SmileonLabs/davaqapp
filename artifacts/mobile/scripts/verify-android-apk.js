const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(`APK verification failed: ${message}`);
  process.exit(1);
}

function run(command, args) {
  // Invoke Java tools directly on Windows; avoid shell quoting and .bat spawning.
  if (process.platform === "win32" && command.endsWith(".jar")) {
    const java = process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, "bin", "java.exe")
      : "java";
    args =
      path.basename(command) === "apksigner.jar"
        ? ["-jar", command, ...args]
        : [
            `-Dcom.android.sdklib.toolsdir=${path.dirname(path.dirname(command))}`,
            "-classpath",
            command,
            "com.android.tools.apk.analyzer.ApkAnalyzerCli",
            ...args,
          ];
    command = java;
  }
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `${path.basename(command)} exited with ${result.status}: ${result.error?.message || result.stderr?.trim().slice(-2000) || "no diagnostics"}`,
    );
  }
  return result.stdout;
}

function latestTool(buildToolsRoot, name) {
  if (!fs.existsSync(buildToolsRoot)) return null;
  const versions = fs
    .readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(
      buildToolsRoot,
      version,
      process.platform === "win32"
        ? name === "apksigner"
          ? "lib/apksigner.jar"
          : `${name}.exe`
        : name,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const apkPath = path.resolve(process.argv[2] || "");
const minimumVersionCode = Number(process.argv[3] || 0);
if (!apkPath || !fs.existsSync(apkPath)) fail("APK path does not exist");
if (path.extname(apkPath).toLowerCase() !== ".apk") fail("input is not an APK");

const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!androidHome) fail("ANDROID_HOME or ANDROID_SDK_ROOT is required");

const buildToolsRoot = path.join(androidHome, "build-tools");
const aapt = latestTool(buildToolsRoot, "aapt");
const apksigner = latestTool(buildToolsRoot, "apksigner");
const apkanalyzerCandidates = [
  path.join(
    androidHome,
    "cmdline-tools",
    "latest",
    "bin",
    process.platform === "win32" ? "apkanalyzer.bat" : "apkanalyzer",
  ),
  path.join(
    androidHome,
    "tools",
    "bin",
    process.platform === "win32" ? "apkanalyzer.bat" : "apkanalyzer",
  ),
];
if (process.platform === "win32") {
  const cmdline = path.join(androidHome, "cmdline-tools");
  for (const version of fs.existsSync(cmdline)
    ? fs.readdirSync(cmdline).sort().reverse()
    : []) {
    apkanalyzerCandidates.unshift(
      path.join(cmdline, version, "lib", "apkanalyzer-classpath.jar"),
    );
  }
}
const apkanalyzer = apkanalyzerCandidates.find(fs.existsSync);
if (!aapt || !apksigner || !apkanalyzer)
  fail("Android APK analysis tools are unavailable");

const badging = run(aapt, ["dump", "badging", apkPath]);
const packageMatch = badging.match(
  /package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/,
);
if (!packageMatch) fail("package metadata is unreadable");
const [, androidPackage, versionCodeRaw, versionName] = packageMatch;
const versionCode = Number(versionCodeRaw);
if (androidPackage !== "app.davaq.mobile")
  fail(`unexpected package ${androidPackage}`);
if (minimumVersionCode > 0 && versionCode < minimumVersionCode) {
  fail(
    `versionCode ${versionCode} is lower than required ${minimumVersionCode}`,
  );
}

const manifest = run(aapt, ["dump", "xmltree", apkPath, "AndroidManifest.xml"]);
const requiredManifestEntries = [
  "android.permission.MANAGE_OWN_CALLS",
  "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
  ".telecom.DavaqCallService",
  ".telecom.DavaqCallReceiver",
  ".telecom.DavaqCallActionActivity",
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.FOREGROUND_SERVICE_CAMERA",
  `${androidPackage}.call.CallForegroundService`,
];
for (const entry of requiredManifestEntries) {
  if (!manifest.includes(entry)) fail(`manifest entry missing: ${entry}`);
}

for (const className of [
  `${androidPackage}.telecom.DavaqCallService`,
  `${androidPackage}.telecom.DavaqTelecomModule`,
  `${androidPackage}.telecom.DavaqTelecomPackage`,
  `${androidPackage}.call.CallForegroundService`,
  `${androidPackage}.call.CallForegroundModule`,
  `${androidPackage}.call.CallForegroundPackage`,
]) {
  const code = run(apkanalyzer, ["dex", "code", "--class", className, apkPath]);
  if (!code.includes(`L${className.replaceAll(".", "/")};`))
    fail(`DEX class missing: ${className}`);
}

const packageHostClass = `${androidPackage}.MainApplication$reactNativeHost$1`;
const packageHostCode = run(apkanalyzer, [
  "dex",
  "code",
  "--class",
  packageHostClass,
  apkPath,
]);
if (!packageHostCode.includes("DavaqTelecomPackage"))
  fail("MainApplication does not register DavaqTelecomPackage");
if (!packageHostCode.includes("CallForegroundPackage")) {
  fail("MainApplication.getPackages does not register CallForegroundPackage");
}

const files = run(apkanalyzer, ["files", "list", apkPath]);
if (!files.includes("/lib/arm64-v8a/"))
  fail("arm64-v8a native libraries are missing");

const signature = run(apksigner, ["verify", "--verbose", "--print-certs", apkPath]);
if (process.argv.includes("--release")) {
  if (/application-debuggable/.test(badging)) fail("release APK is debuggable");
  const targetSdk = Number(badging.match(/targetSdkVersion:'(\d+)'/)?.[1] || 0);
  if (targetSdk < 36) fail("release targetSdk must be at least 36");
  if (!files.includes("/assets/index.android.bundle")) fail("standalone JavaScript bundle is missing");
  if (/CN=Android Debug/i.test(signature)) fail("release uses the Android debug certificate");
  const zipalign = latestTool(buildToolsRoot, "zipalign");
  if (!zipalign) fail("zipalign is required for release verification");
  run(zipalign, ["-c", "-P", "16", "4", apkPath]);
  console.log("Release checks passed: standaloneBundle=present debuggable=false targetSdk=" + targetSdk + " debugCertificate=false zipAlignment=16KB");
}

console.log(
  `APK verification passed: package=${androidPackage} versionName=${versionName} ` +
    `versionCode=${versionCode} telecomModule=registered foregroundModule=registered signature=valid arm64=present`,
);
