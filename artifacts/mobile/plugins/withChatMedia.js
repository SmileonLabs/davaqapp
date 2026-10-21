const { withAndroidManifest } = require('expo/config-plugins');
/** A compressor audio dependency declares allowBackup=true. Keep DavaQ's policy. */
module.exports = config => withAndroidManifest(config, mod => {
  const manifest = mod.modResults.manifest;
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const application = manifest.application?.[0];
  if (application) {
    application.$['android:allowBackup'] = 'false';
    const attributes = new Set((application.$['tools:replace'] ?? '').split(',').map(value => value.trim()).filter(Boolean));
    attributes.add('android:allowBackup');
    application.$['tools:replace'] = [...attributes].join(',');
    // Android calls use Core-Telecom, not expo-audio's lock-screen player.
    // A merger removal marker also excludes the service added by the SDK AAR.
    const playbackService = 'expo.modules.audio.service.AudioControlsService';
    application.service = (application.service ?? []).filter(service => service.$['android:name'] !== playbackService);
    application.service.push({ $: { 'android:name': playbackService, 'tools:node': 'remove' } });
  }
  return mod;
});
