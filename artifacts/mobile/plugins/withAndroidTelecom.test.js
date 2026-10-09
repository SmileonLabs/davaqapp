const test = require("node:test");
const assert = require("node:assert/strict");
const { patchApplication, patchGradle } = require("./withAndroidTelecom");
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
