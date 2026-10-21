const { withGradleProperties, withMainApplication, withAppBuildGradle, withSettingsGradle, withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
module.exports = function withScannerAndroid(config) {
  config = withSettingsGradle(config, config => {
    if (!config.modResults.contents.includes("include ':tcgindex-scanner-native'")) config.modResults.contents += "\ninclude ':tcgindex-scanner-native'\nproject(':tcgindex-scanner-native').projectDir = new File(rootProject.projectDir, '../tcgindex-scanner/mobile/native-scanner/android')\n";
    return config;
  });
  config = withMainApplication(config, (config) => {
    if (!config.modResults.contents.includes('add(CardTextPackage())')) config.modResults.contents = config.modResults.contents.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(CardTextPackage())');
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('project(":tcgindex-scanner-native")')) config.modResults.contents = config.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation project(":tcgindex-scanner-native")');
    if (!config.modResults.contents.includes('com.google.mlkit:text-recognition:')) config.modResults.contents = config.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation("com.google.mlkit:text-recognition:16.0.1")');
    if (!config.modResults.contents.includes('com.google.mlkit:text-recognition-japanese:')) config.modResults.contents = config.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation("com.google.mlkit:text-recognition-japanese:16.0.1")');
    if (!config.modResults.contents.includes('org.opencv:opencv:')) config.modResults.contents = config.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation("org.opencv:opencv:4.13.0")');
    if (!config.modResults.contents.includes('androidx.camera:camera-view:')) config.modResults.contents = config.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation("androidx.camera:camera-view:1.7.0-alpha03")');
    return config;
  });
  config = withDangerousMod(config, ['android', async (config) => {
    const folder = join(config.modRequest.platformProjectRoot, 'app/src/main/java/'+config.android.package.replace(/\./g,'/'));
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(__dirname, 'android/CardTextModule.kt'), join(folder, 'CardTextModule.kt'));
    copyFileSync(join(__dirname, 'android/CardQuadDetector.kt'), join(folder, 'CardQuadDetector.kt'));
    copyFileSync(join(__dirname, 'android/CardOutlineView.kt'), join(folder, 'CardOutlineView.kt'));
    copyFileSync(join(__dirname, 'android/CardVisionModule.kt'), join(folder, 'CardVisionModule.kt'));
    for(const f of ['CardTextModule.kt','CardQuadDetector.kt','CardOutlineView.kt','CardVisionModule.kt']){const p=join(folder,f);writeFileSync(p,readFileSync(p,'utf8').replace('package org.tcgindex.scanner','package '+config.android.package));}
    return config;
  }]);
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter((entry) => entry.type !== 'property' || entry.key !== 'android.minSdkVersion');
    // VisionCamera's Vulkan resizer requires AHardwareBuffer (Android 8+).
    config.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    return config;
  });
};
