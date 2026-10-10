const fs = require("node:fs");
const path = require("node:path");
module.exports = ({ config }) => {
  const local = path.join(__dirname, "google-services.json");
  const file =
    process.env.DAVAQ_GOOGLE_SERVICES_JSON ||
    (fs.existsSync(local) ? local : undefined);
  if (file) {
    const resolved = path.resolve(file);
    const service = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (service.project_info?.project_id !== "davaq-43e77")
      throw new Error("Firebase project must be davaq-43e77");
    if (
      !service.client?.some(
        (c) =>
          c.client_info?.android_client_info?.package_name ===
          "app.davaq.mobile",
      )
    ) {
      throw new Error("Firebase Android package must be app.davaq.mobile");
    }
    config.android = { ...config.android, googleServicesFile: resolved };
  }
  config.android = {
    ...config.android,
    versionCode: Math.max(config.android?.versionCode ?? 0, 11),
  };
  config.plugins = config.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-build-properties"
      ? [
          plugin[0],
          {
            ...plugin[1],
            android: {
              ...plugin[1].android,
              minSdkVersion: 26,
              compileSdkVersion: 36,
              targetSdkVersion: 36,
            },
          },
        ]
      : plugin,
  );
  config.plugins = [
    ...config.plugins,
    "./plugins/withAndroidTelecom",
    "./plugins/withAndroidUploadSigning",
  ];
  return config;
};
