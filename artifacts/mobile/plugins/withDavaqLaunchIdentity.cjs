const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { withFinalizedMod, IOSConfig } = require('expo/config-plugins');
const pluginRequire = createRequire(require.resolve('expo/config-plugins'));
const plist = pluginRequire('@expo/plist').default;
const xcode = pluginRequire('xcode');

// Give the renewed launch screen its own identity instead of reusing the old
// character screen's storyboard and asset names across installed app updates.
module.exports = function withDavaqLaunchIdentity(config) {
  return withFinalizedMod(config, ['ios', async config => {
    if (config.modRequest.introspect) return config;
    const root = config.modRequest.platformProjectRoot;
    const name = config.modRequest.projectName;
    const app = path.join(root, name);
    const launch = 'DavaqMonoLaunchV2';
    const catalog = path.join(app, 'Images.xcassets');
    for (const [oldName, newName, extension] of [
      ['SplashScreenLogo', 'DavaqMonoLaunchLogoV2', 'imageset'],
      ['SplashScreenBackground', 'DavaqMonoLaunchBackgroundV2', 'colorset'],
    ]) {
      fs.cpSync(path.join(catalog, `${oldName}.${extension}`),
        path.join(catalog, `${newName}.${extension}`), { recursive: true });
    }
    const storyboard = fs.readFileSync(path.join(app, 'SplashScreen.storyboard'), 'utf8')
      .replaceAll('SplashScreenLogo', 'DavaqMonoLaunchLogoV2')
      .replaceAll('SplashScreenBackground', 'DavaqMonoLaunchBackgroundV2');
    fs.writeFileSync(path.join(app, `${launch}.storyboard`), storyboard);
    const infoPath = path.join(app, 'Info.plist');
    const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
    info.UILaunchStoryboardName = launch;
    delete info.UILaunchImages;
    delete info.UILaunchImageFile;
    fs.writeFileSync(infoPath, plist.build(info));
    const projectPath = IOSConfig.Paths.getPBXProjectPath(config.modRequest.projectRoot);
    const project = xcode.project(projectPath);
    project.parseSync();
    // Expo links its default storyboard on every prebuild. Keep only one linked
    // launch storyboard, including when this plugin runs more than once.
    const sections = project.hash.project.objects;
    if (project.hasFile(`${name}/${launch}.storyboard`)) {
      const removed = new Set();
      for (const [id, ref] of Object.entries(sections.PBXFileReference)) {
        if (ref?.path?.replaceAll('"', '') === `${name}/SplashScreen.storyboard`) removed.add(id);
      }
      for (const [id, ref] of Object.entries(sections.PBXBuildFile)) {
        if (removed.has(ref?.fileRef)) removed.add(id);
      }
      for (const section of Object.values(sections)) {
        for (const id of removed) { delete section[id]; delete section[`${id}_comment`]; }
        for (const ref of Object.values(section)) {
          for (const key of ['children', 'files']) {
            if (Array.isArray(ref?.[key])) ref[key] = ref[key].filter(item => !removed.has(item.value));
          }
        }
      }
    }
    fs.writeFileSync(projectPath, project.writeSync().replaceAll('SplashScreen.storyboard', `${launch}.storyboard`));
    return config;
  }]);
};
