const { withXcodeProject, withPodfile } = require('expo/config-plugins');

// CocoaPods static frameworks publish only a subset of Nitro's C++ headers.
// Publish transitive headers as private, so Swift and C++ share the same framework copies.
module.exports = function withTcgScannerIosHeaders(config) {
  config = withPodfile(config, config => {
    const marker = '# DAVAQ scanner static-framework private headers';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents = config.modResults.contents.replace('  post_install do |installer|', `  post_install do |installer|
    ${marker}
    installer.pods_project.targets.each do |target|
      next unless ['NitroModules', 'NitroImage', 'VisionCamera'].include?(target.name)
      target.headers_build_phase.files.each do |header|
        header.settings ||= {}
        attributes = header.settings['ATTRIBUTES'] || []
        header.settings['ATTRIBUTES'] = ['Private'] unless attributes.include?('Public')
      end
    end`);
    }
    return config;
  });
  return withXcodeProject(config, config => {
    const paths = ['NitroModules', 'NitroImage', 'VisionCamera'].flatMap(name => [
      ...['Headers', 'PrivateHeaders'].map(folder => '"$(PODS_CONFIGURATION_BUILD_DIR)/' + name + '/' + name + '.framework/' + folder + '"'),
      '"$(OBJROOT)/Pods.build/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)/' + name + '.build/DerivedSources"',
    ]);
    for (const configuration of Object.values(config.modResults.pbxXCBuildConfigurationSection())) {
      const settings = configuration.buildSettings;
      if (!settings?.SWIFT_OBJC_BRIDGING_HEADER) continue;
      const existing = settings.HEADER_SEARCH_PATHS ?? ['"$(inherited)"'];
      settings.HEADER_SEARCH_PATHS = [...new Set([...(Array.isArray(existing) ? existing : [existing]), ...paths])];
    }
    return config;
  });
};
