const fs = require("node:fs");
const path = require("node:path");
const { withXcodeProject, withAppDelegate, IOSConfig } = require("expo/config-plugins");

module.exports = function withSystemCalls(config) {
  config = withAppDelegate(config, (mod) => {
    const marker = "// DavaQ starts PushKit before React";
    if (!mod.modResults.contents.includes(marker)) {
      const needle = "    let delegate = ReactNativeDelegate()";
      if (!mod.modResults.contents.includes(needle)) throw new Error("Unsupported AppDelegate: PushKit initialization point missing");
      mod.modResults.contents = mod.modResults.contents.replace(needle, `    ${marker}\n    DavaQPushRegistry.shared.start()\n${needle}`);
    }
    const remoteMarker = "// DavaQ native terminal push handler";
    if (!mod.modResults.contents.includes(remoteMarker)) {
      const needle = "  // Linking API";
      if (!mod.modResults.contents.includes(needle)) throw new Error("Unsupported AppDelegate: remote notification insertion point missing");
      mod.modResults.contents = mod.modResults.contents.replace(needle, `  ${remoteMarker}
  public override func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if DavaQPushRegistry.shared.handleRemoteNotification(userInfo) {
      completionHandler(.newData)
      return
    }
    super.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler)
  }

${needle}`);
    }
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const name = IOSConfig.XcodeUtils.getProjectName(
      mod.modRequest.projectRoot,
    );
    const directory = path.join(mod.modRequest.platformProjectRoot, name);
    for (const file of ["DavaQSystemCallManager.swift", "DavaQSystemCalls.m", "DavaQPushRegistry.swift"]) {
      const source = fs.readFileSync(
        path.join(__dirname, "native", file),
        "utf8",
      );
      fs.writeFileSync(
        path.join(directory, file),
        source.replaceAll("__PROJECT_NAME__", name),
      );
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${name}/${file}`,
        groupName: name,
        project: mod.modResults,
      });
    }
    return mod;
  });
};
