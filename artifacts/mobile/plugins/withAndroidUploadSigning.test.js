const test = require("node:test");
const assert = require("node:assert/strict");
const { patchUploadSigning } = require("./withAndroidUploadSigning");
const template = `android {
 signingConfigs { debug {} }
 buildTypes {
 debug { signingConfig signingConfigs.debug }
 release { signingConfig signingConfigs.debug }
 }
}`;
test("upload signing preserves debug and rewires only the release build", () => {
  const result = patchUploadSigning(template);
  assert.match(result, /debug \{ signingConfig signingConfigs.debug \}/);
  assert.match(result, /release \{ signingConfig hasUploadSigning \? signingConfigs.davaqUpload/);
  for (const name of ["KEYSTORE_PATH", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"])
    assert.ok(result.includes("System.getenv('DAVAQ_ANDROID_" + name + "')"));
  assert.match(result, /releaseRequested && !hasUploadSigning/);
  assert.match(result, /throw new GradleException/);
  assert.match(result, /gradle.taskGraph.whenReady/);
  assert.match(result, /graph.allTasks.any/);
});
test("prebuild reapplication never duplicates signing configuration", () => {
  const once = patchUploadSigning(template);
  assert.equal(patchUploadSigning(once), once);
});
test("unsupported signing template fails rather than publishing debug signing", () => {
  assert.throws(() => patchUploadSigning("android { buildTypes { release {} } }"), /Unsupported/);
});

const { patchBundleEntry } = require("./withAndroidUploadSigning");
test("release bundling passes an absolute app entry in a monorepo", () => {
  const result = patchBundleEntry("react {\n autolinkLibrariesWithApp()\n}");
  assert.match(result, /new File\(projectRoot, "index.js"\).absolutePath/);
  assert.ok(result.includes('"--max-workers", "1"'));
  assert.equal(patchBundleEntry(result), result);
  assert.throws(() => patchBundleEntry("android {}"), /Missing React/);
});
