const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withMainApplication, withDangerousMod } = require('expo/config-plugins');
function patchApplication(source, pkg) {
  const statement = `import ${pkg}.updates.DavaqPlayUpdatePackage`;
  if (!source.includes(statement)) source = source.replace(/^(package .*\n)/m, '$1\n'+statement+'\n');
  if (!source.includes('add(DavaqPlayUpdatePackage())')) {
    const anchor = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    if (!anchor.test(source)) throw Error('Unsupported MainApplication Kotlin template');
    source = source.replace(anchor, '$1\n          add(DavaqPlayUpdatePackage())');
  }
  return source;
}
function patchGradle(source) {
  if (source.includes('com.google.android.play:app-update:2.1.0')) return source;
  if (!source.includes('dependencies {')) throw Error('Missing dependencies block');
  return source.replace('dependencies {','dependencies {\n    implementation("com.google.android.play:app-update:2.1.0")');
}
module.exports = config => {
  config = withAppBuildGradle(config, mod => { mod.modResults.contents=patchGradle(mod.modResults.contents); return mod; });
  config = withMainApplication(config, mod => { mod.modResults.contents=patchApplication(mod.modResults.contents, mod.android.package); return mod; });
  return withDangerousMod(config,['android',mod=>{
    const pkg=mod.android.package;
    const dest=path.join(mod.modRequest.platformProjectRoot,'app/src/main/java',...pkg.split('.'),'updates');
    fs.mkdirSync(dest,{recursive:true});
    fs.writeFileSync(path.join(dest,'DavaqPlayUpdate.kt'),fs.readFileSync(path.join(__dirname,'android-play-update/DavaqPlayUpdate.kt'),'utf8').replaceAll('__PACKAGE__',pkg));
    return mod;
  }]);
};
module.exports.patchApplication=patchApplication;
module.exports.patchGradle=patchGradle;
