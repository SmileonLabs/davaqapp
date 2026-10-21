const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Exercise real Expo CNG twice, including Xcode source membership and idempotence.
test(
  "system call plugin survives repeated Expo prebuilds",
  { timeout: 30000 },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "davaq-system-calls-"),
    );
    const mobileRoot = path.resolve(__dirname, "..");
    const expoCli = path.join(
      path.dirname(require.resolve("expo/package.json")),
      "bin/cli",
    );
    try {
      fs.symlinkSync(
        path.join(mobileRoot, "node_modules"),
        path.join(directory, "node_modules"),
        "dir",
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "davaq-native-fixture",
          version: "1.0.0",
          dependencies: {
            expo: "~54.0.27",
            "react-native": "0.81.5",
            react: "19.1.0",
          },
        }),
      );
      fs.writeFileSync(
        path.join(directory, "app.json"),
        JSON.stringify({
          expo: {
            name: "DavaQFixture",
            slug: "davaq-native-fixture",
            ios: { bundleIdentifier: "app.davaq.fixture" },
            plugins: [path.join(__dirname, "withSystemCalls.js")],
          },
        }),
      );
      const prebuild = () => {
        const result = spawnSync(
          process.execPath,
          [
            expoCli,
            "prebuild",
            "--platform",
            "ios",
            "--no-install",
            "--skip-dependency-update",
            "react-native,react",
          ],
          {
            cwd: directory,
            encoding: "utf8",
            env: { ...process.env, CI: "1" },
            timeout: 15000,
          },
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);
        return fs.readFileSync(
          path.join(directory, "ios/DavaQFixture.xcodeproj/project.pbxproj"),
          "utf8",
        );
      };
      const first = prebuild();
      const second = prebuild();
      for (const file of [
        "DavaQSystemCallManager.swift",
        "DavaQSystemCalls.m",
        "DavaQPushRegistry.swift",
      ]) {
        assert.ok(
          fs.existsSync(path.join(directory, "ios/DavaQFixture", file)),
        );
        const membership = `${file} in Sources`;
        const count = (value) => value.split(membership).length - 1;
        assert.ok(count(first) > 0, `${file} must be compiled`);
        assert.equal(
          count(second),
          count(first),
          "prebuild must not duplicate source membership",
        );
      }
      const delegate = fs.readFileSync(path.join(directory, "ios/DavaQFixture/AppDelegate.swift"), "utf8");
      assert.equal(delegate.split("DavaQPushRegistry.shared.start()").length - 1, 1);
      const bridge = fs.readFileSync(
        path.join(directory, "ios/DavaQFixture/DavaQSystemCalls.m"),
        "utf8",
      );
      assert.ok(bridge.includes("DavaQFixture-Swift.h"));
      assert.ok(!bridge.includes("__PROJECT_NAME__"));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
