const { withAppBuildGradle } = require("expo/config-plugins");
const marker = "// DavaQ upload signing (local secrets only)";
function patchUploadSigning(source) {
  if (source.includes(marker)) return source;
  if (!source.includes("android {") || !/release\s*\{[\s\S]*?signingConfig signingConfigs.debug/.test(source)) {
    throw new Error("Unsupported Android release signing template");
  }
  const setup = `
${marker}
  def uploadPath = System.getenv('DAVAQ_ANDROID_KEYSTORE_PATH')
  def uploadStorePassword = System.getenv('DAVAQ_ANDROID_STORE_PASSWORD')
  def uploadAlias = System.getenv('DAVAQ_ANDROID_KEY_ALIAS')
  def uploadKeyPassword = System.getenv('DAVAQ_ANDROID_KEY_PASSWORD')
  def hasUploadSigning = uploadPath && uploadStorePassword && uploadAlias && uploadKeyPassword
  def releaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
  if (releaseRequested && !hasUploadSigning) {
      throw new GradleException('DavaQ release requires DAVAQ_ANDROID_* upload signing variables; debug signing is forbidden.')
  }
  gradle.taskGraph.whenReady { graph ->
      if (!hasUploadSigning && graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }) {
          throw new GradleException('DavaQ release task graph requires upload signing; debug signing is forbidden.')
      }
  }
  if (hasUploadSigning) {
      android.signingConfigs.create('davaqUpload') {
          storeFile file(uploadPath)
          storePassword uploadStorePassword
          keyAlias uploadAlias
          keyPassword uploadKeyPassword
      }
  }
`;
  source = source.replace("android {", setup + "\nandroid {");
  return source.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/,
    "$1signingConfig hasUploadSigning ? signingConfigs.davaqUpload : signingConfigs.debug");
}

function patchBundleEntry(source) {
  const marker = "// Resolve the monorepo entry before Expo changes its server root.";
  if (source.includes(marker)) return source;
  if (!source.includes('react {')) throw new Error('Missing React Gradle block');
  return source.replace('react {', 'react {\n    ' + marker + '\n    extraPackagerArgs = ["--entry-file", new File(projectRoot, "index.js").absolutePath, "--max-workers", "1"]');
}

module.exports = config => withAppBuildGradle(config, mod => {
  mod.modResults.contents = patchBundleEntry(patchUploadSigning(mod.modResults.contents));
  return mod;
});
module.exports.patchUploadSigning = patchUploadSigning;

module.exports.patchBundleEntry = patchBundleEntry;
