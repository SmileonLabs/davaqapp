const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function apply(application, services = []) {
  const manifest = { $: {}, application: [{ $: application, service: services }] };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'withChatMedia.js'), 'utf8'), {
    module, Set, require: () => ({ withAndroidManifest: (_, callback) => callback({ modResults: { manifest } }) }),
  });
  module.exports({});
  return manifest;
}
test('media dependencies cannot enable Android backup', () => {
  const manifest = apply({ 'android:allowBackup': 'true' });
  assert.equal(manifest.application[0].$['android:allowBackup'], 'false');
  assert.equal(manifest.application[0].$['tools:replace'], 'android:allowBackup');
});
test('manifest overrides are merged without dropping existing policies', () => {
  const manifest = apply({ 'android:allowBackup': 'false', 'tools:replace': 'android:label,android:allowBackup' });
  assert.equal(manifest.application[0].$['tools:replace'], 'android:label,android:allowBackup');
  assert.equal(manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
});

test('only unused expo lock-screen playback is removed while active calls and recording survive', () => {
  const names = [
    '.telecom.DavaqCallService', '.call.CallForegroundService',
    'expo.modules.audio.service.AudioRecordingService',
    'expo.modules.audio.service.AudioControlsService',
  ];
  const manifest = apply({}, names.map(name => ({ $: { 'android:name': name, 'android:foregroundServiceType': name.includes('Telecom') ? 'phoneCall|microphone|camera' : 'microphone' } })));
  const services = manifest.application[0].service;
  for (const name of names.slice(0, 3)) assert.equal(services.find(service => service.$['android:name'] === name).$['tools:node'], undefined);
  assert.equal(services.filter(service => service.$['android:name'] === names[3]).length, 1);
  assert.equal(services.find(service => service.$['android:name'] === names[3]).$['tools:node'], 'remove');
  const twice = apply(manifest.application[0].$, services);
  assert.equal(JSON.stringify(twice), JSON.stringify(manifest));
});

test('resolved Expo plugin order retains the removal markers without writing the release native project', { timeout: 15000 }, async () => {
  const { createRequire } = require('node:module');
  const expo = createRequire(require.resolve('expo/package.json'));
  const mobile = path.resolve(__dirname, '..');
  const nativeManifest = path.join(mobile, 'android/app/src/main/AndroidManifest.xml');
  const before = fs.existsSync(nativeManifest) ? fs.readFileSync(nativeManifest, 'utf8') : undefined;
  const { exp } = await expo('@expo/prebuild-config').getPrebuildConfigAsync(mobile, { platforms: ['android'] });
  const compiled = await expo('@expo/config-plugins').compileModsAsync(exp, { projectRoot: mobile, platforms: ['android'], introspect: true });
  const manifest = compiled._internal.modResults.android.manifest.manifest;
  for (const permission of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']) {
    const nodes = manifest['uses-permission'].filter(node => node.$['android:name'] === 'android.permission.' + permission);
    assert.equal(nodes.length, 1, permission);
    assert.equal(nodes[0].$['tools:node'], 'remove', permission);
  }
  for (const permission of ['WRITE_EXTERNAL_STORAGE', 'CAMERA', 'RECORD_AUDIO', 'FOREGROUND_SERVICE_PHONE_CALL', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_CAMERA'])
    assert.equal(manifest['uses-permission'].some(node => node.$['android:name'] === 'android.permission.' + permission && node.$['tools:node'] !== 'remove'), true, permission);
  const application = manifest.application[0];
  assert.equal(application.$['android:allowBackup'], 'false');
  assert.equal(application.service.find(node => node.$['android:name'] === 'expo.modules.audio.service.AudioControlsService').$['tools:node'], 'remove');
  assert.equal(application.service.find(node => node.$['android:name'] === '.telecom.DavaqCallService').$['android:foregroundServiceType'], 'phoneCall|microphone|camera');
  assert.equal(fs.existsSync(nativeManifest) ? fs.readFileSync(nativeManifest, 'utf8') : undefined, before);
});
