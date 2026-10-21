const fs = require("node:fs");
const path = require("node:path");
// Keep native service files outside version control; EAS file variables are supported.
module.exports = ({ config }) => {
  const localAndroidFile = path.join(__dirname, "google-services.json");
  const androidFile = process.env.DAVAQ_GOOGLE_SERVICES_JSON || process.env.GOOGLE_SERVICES_JSON ||
    (fs.existsSync(localAndroidFile) ? localAndroidFile : undefined);
  if (androidFile) {
    const service = JSON.parse(fs.readFileSync(androidFile, "utf8"));
    if (service.project_info?.project_id !== "davaq-43e77" ||
        !service.client?.some(c => c.client_info?.android_client_info?.package_name === "app.davaq.mobile")) {
      throw new Error("DavaQ Android Firebase project/package mismatch");
    }
  }
  const iosFile = process.env.GOOGLE_SERVICES_PLIST;
  const projectId = process.env.EAS_PROJECT_ID;
  const experiments = { ...(config.experiments ?? {}) };
  delete experiments.baseUrl;
  if (process.env.EXPO_WEB_EXPORT === "1") experiments.baseUrl = process.env.DAVAQ_WEB_BASE_PATH || "/app";
  return {
    ...config,
    experiments,
    android: {
      ...config.android,
      versionCode: Math.max(config.android?.versionCode ?? 0, 13),
      blockedPermissions: [...new Set([
        ...(config.android?.blockedPermissions ?? []),
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      ])],
      ...(androidFile ? { googleServicesFile: androidFile } : {}),
    },
    ios: {
      ...config.ios,
      ...(process.env.DAVAQ_IOS_BUILD_NUMBER ? { buildNumber: process.env.DAVAQ_IOS_BUILD_NUMBER } : {}),
      ...(iosFile ? { googleServicesFile: iosFile } : {}),
      entitlements: {
        ...config.ios?.entitlements,
        "aps-environment":
          process.env.NODE_ENV === "production" ? "production" : "development",
      },
      infoPlist: {
        ...config.ios?.infoPlist,
        NSPhotoLibraryAddUsageDescription: "사진을 기기 앨범에 저장하려면 사진 추가 권한을 허용해 주세요.",
        UIBackgroundModes: [
          ...new Set([
            ...(config.ios?.infoPlist?.UIBackgroundModes ?? []),
            "remote-notification",
            "voip",
          ]),
        ],
      },
    },
    plugins: [
      ...(config.plugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === "expo-build-properties"
        ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, minSdkVersion: 26, compileSdkVersion: 36, targetSdkVersion: 36 } }] : plugin),
      "expo-video",
      ["expo-media-library", { photosPermission: "저장한 사진과 영상을 확인하려면 사진 접근을 허용해 주세요.", savePhotosPermission: "사진과 영상을 기기 갤러리에 저장하려면 권한을 허용해 주세요.", granularPermissions: ["photo", "video"], isAccessMediaLocationEnabled: false }],
      "react-native-compressor",
      "./plugins/withChatMedia",
      ["expo-image-picker", { photosPermission: "대화에 사진과 영상을 첨부할 수 있도록 사진 접근을 허용해 주세요.", cameraPermission: "사진과 영상을 직접 촬영하려면 카메라 접근을 허용해 주세요.", microphonePermission: "영상 촬영에 소리를 포함하려면 마이크 접근을 허용해 주세요." }],
      "./plugins/withTcgScannerIosHeaders.cjs",
      "./tcgindex-scanner/mobile/plugins/with-scanner-android.cjs", "./tcgindex-scanner/mobile/plugins/with-scanner-ios.cjs",
      "./plugins/withAndroidPlayUpdate", "./plugins/withAndroidTelecom", "./plugins/withAndroidUploadSigning",
      "./plugins/withDavaqLaunchIdentity.cjs",
    ],
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
  };
};
