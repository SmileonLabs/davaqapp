const {withDangerousMod,withXcodeProject,withPodfile,IOSConfig} = require('expo/config-plugins');
const {mkdirSync,copyFileSync,readFileSync,writeFileSync} = require('node:fs');
const {join} = require('node:path');
module.exports = function withScannerIOS(config) {
  config = withDangerousMod(config,['ios',async config=>{
    const name=config.modRequest.projectName||IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const dir=join(config.modRequest.platformProjectRoot,name);
    mkdirSync(dir,{recursive:true});
    for(const file of ['TCGCardText.m','TCGScannerPipeline.h','TCGCompactQuery.hpp','TCGScannerPipeline.m','TCGNativeCameraOutput.swift','TCGNativeOutputRegistration.mm','TCGCompactVision.mm'])copyFileSync(join(__dirname,'ios',file),join(dir,file));
    mkdirSync(join(dir,'TCGUSearch','usearch'),{recursive:true});
    for(const file of ['index.hpp','index_dense.hpp','index_plugins.hpp'])copyFileSync(join(config.modRequest.projectRoot,'tcgindex-scanner/mobile/native-scanner/android/src/main/cpp/third-party/usearch',file),join(dir,'TCGUSearch','usearch',file));
    const header=join(dir,name+'-Bridging-Header.h');
    let contents=readFileSync(header,'utf8');if(!contents.includes('TCGScannerPipeline.h'))writeFileSync(header,contents+'\n#import "TCGScannerPipeline.h"\n');
    return config;
  }]);
  config=withPodfile(config,config=>{const source="ENV['EXPO_USE_PRECOMPILED_MODULES'] = '0'\n";if(!config.modResults.contents.includes(source))config.modResults.contents=source+config.modResults.contents;const line="  pod 'TCGOpenCV', :podspec => '../tcgindex-scanner/mobile/plugins/ios/TCGOpenCV.podspec'";if(!config.modResults.contents.includes(line))config.modResults.contents=config.modResults.contents.replace(/(target .+ do\n)/,'$1'+line+'\n');return config;});
  return withXcodeProject(config,config=>{
    const project=config.modResults,name=config.modRequest.projectName||IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    for(const file of ['TCGCardText.m','TCGScannerPipeline.m','TCGNativeCameraOutput.swift','TCGNativeOutputRegistration.mm','TCGCompactVision.mm']){const path=name+'/'+file;if(!project.hasFile(path))project.addSourceFile(path,{target:project.getFirstTarget().uuid},project.findPBXGroupKey({name}));}
    for(const setting of Object.values(project.pbxXCBuildConfigurationSection()))if(setting.buildSettings?.SWIFT_OBJC_BRIDGING_HEADER){setting.buildSettings.SWIFT_OBJC_INTEROP_MODE='objcxx';setting.buildSettings.HEADER_SEARCH_PATHS=['"$(inherited)"','"$(SRCROOT)/'+name+'/TCGUSearch"',...['NitroModules','NitroImage','VisionCamera'].flatMap(name=>['"$(PODS_ROOT)/Headers/Private/'+name+'"',JSON.stringify('"$(PODS_CONFIGURATION_BUILD_DIR)/'+name+'/Swift Compatibility Header"')])];}
    if(!project.hasFile('System/Library/Frameworks/Vision.framework'))project.addFramework('Vision.framework',{target:project.getFirstTarget().uuid});
    if(!project.hasFile('System/Library/Frameworks/CoreImage.framework'))project.addFramework('CoreImage.framework',{target:project.getFirstTarget().uuid});
    for(const setting of Object.values(project.pbxXCBuildConfigurationSection()))if(setting.buildSettings?.SWIFT_OBJC_BRIDGING_HEADER){const flags=setting.buildSettings.OTHER_LDFLAGS??['"$(inherited)"'];setting.buildSettings.OTHER_LDFLAGS=Array.isArray(flags)?[...flags,'"-lsqlite3"']:flags+' -lsqlite3';}
    return config;
  });
};
