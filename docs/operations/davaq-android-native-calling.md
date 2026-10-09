# DavaQ Android native calling — implementation checkpoint

Android package: `app.davaq.mobile`. Firebase project: `davaq-43e77`.
Android app was registered alongside the existing DavaQ iOS app on 2026-10-10.
The Android client uses the existing DavaQ API and LiveKit room contract.

## Implemented in this branch

- Android-only Metro implementations for the call provider, LiveKit audio integration,
  push registrar and foreground/headless FCM handlers. Existing iOS implementations
  and backend call endpoints are unchanged.
- Kotlin Core-Telecom integration: self-managed calls, system audio endpoints,
  CallStyle notification, incoming call activity and phone-call foreground service.
- Incoming notification body opens the call screen; only the explicit accept action
  accepts. Lock-screen UI exposes the call, not the rest of the application.
- Native accept/decline/end actions survive JavaScript startup, expire, and are scoped
  to the authenticated backend account. Acknowledgement waits for the application
  handler; accepting cannot accidentally consume a concurrent end action.
- Native ended-call tombstones reject reordered ringing events. FCM uses the remaining
  portion of its original 45-second ring window, not 45 seconds from delayed receipt.
- LiveKit's Android AudioSwitch is not started while Telecom owns audio focus/routing.
  The app exposes the endpoints reported by Telecom, including connected accessories.
- Call view can be minimized to return to chat; the banner restores the call view.
- Camera permission denial retains audio calling. Camera foreground-service type is
  requested only when camera use is permitted.
- Expo prebuild plugin creates native sources and manifest registrations reproducibly.
  Android minimum SDK is 26 and versionCode is 8. Device-owned call state is excluded
  from Android backup.
- APK inspection checks package identity, native Telecom classes/registration,
  permissions, ARM64 libraries and signing. Windows Java tools run without a shell.

## Build configuration

The downloaded Firebase client file belongs at `artifacts/mobile/google-services.json`
(ignored by Git), or set `DAVAQ_GOOGLE_SERVICES_JSON` to its absolute path.
Configuration rejects a different Firebase project or Android package.
Never substitute an AnotherMe client file.

From `artifacts/mobile`:

```powershell
$env:DAVAQ_GOOGLE_SERVICES_JSON = "C:/path/to/google-services.json"
$env:EXPO_PUBLIC_API_BASE_URL = "https://davaq.anothermeai.app"
$env:EXPO_PUBLIC_DOMAIN = "davaq.anothermeai.app"
$env:EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "<existing public Clerk key>"
pnpm exec expo prebuild --platform android --no-install
# Review generated package.json changes before committing.
# Configure a JDK 17 and Android SDK 36 with the required NDK.
cd android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

A local release APK uses Expo's generated debug signing configuration unless a real
release signing configuration is supplied. Such an APK is for internal validation;
it is not a Play Store production release.

The current workstation has Unity JDK 17, SDK 36 and NDK 27.2.12479018. Its local,
ignored Gradle init script and local.properties select those existing installations,
force build-tools 36 across dependencies, limit C++ parallelism, and move CMake
staging out of pnpm's deeply nested dependency directories. Long Windows paths
otherwise caused Ninja to regenerate build.ninja repeatedly. The local CMake
arguments also set `CMAKE_CXX_FLAGS=--driver-mode=g++`: Windows 8.3 conversion
of Unity's clang++ path otherwise lost C++ driver mode and standard-library linking.
Ninja 1.13.2 is downloaded from the official ninja-build release and checksum-verified
for app compilation. Windows long-path support is disabled on this PC, so native
autolinking uses short local junctions for dependency directories as well. These
workstation-only paths are ignored; no machine-wide path policy was changed.
CI should use the standard Expo SDK 54 NDK instead of workstation paths.

## Development-device verification

A debug APK needs a running Metro server; successful installation alone does not
verify the JavaScript application or call delivery. With an authorized USB device:

```powershell
# From artifacts/mobile; build the debug APK first with the configured SDK.
pnpm exec expo start --dev-client --localhost --port 8081 --max-workers 1
# In a second terminal:
adb reverse tcp:8081 tcp:8081
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -a android.intent.action.VIEW -d "exp+davaq://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081" app.davaq.mobile
```

Use app-scoped logcat to check startup errors without collecting unrelated phone
logs. Login, account consent and peer-call verification are performed by the user.

## Validation

- Mobile TypeScript check passed.
- Android call policy, runtime environment, API host and prebuild tests: 14 passed.
- Existing foreground-service plugin tests: 4 passed.
- Existing message/call/ownership/reconnect tests: 60 passed.
- Existing PWA cache/push tests: 7 passed.
- Android prebuild succeeded with the registered Firebase file.
- Native Gradle `:app:compileDebugKotlin` succeeded, including DavaqTelecom.
- Galaxy S20 5G (SM-G981N, Android 13 / API 33) is connected through authorized ADB.
- Debug APK assembled successfully; native Telecom/foreground classes, registration,
  package identity, versionCode 8, signature and ARM64 libraries passed inspection.
- APK installed successfully on the Galaxy S20. MainActivity cold-start intent
  completed in 1,332 ms; this measures activity launch, not JavaScript/UI readiness.
- Metro Android bundle succeeded (3,341 modules); the application JavaScript and
  Firebase background handler initialized on the S20 without an observed JS error.
  After the login runtime correction below, the authenticated home screen was
  directly verified on the S20. The system notification permission prompt is
  awaiting the user's choice. Two-party call checks remain pending.
- The local public Clerk key matches the currently deployed DavaQ web bundle. Both
  use a development instance; a production Clerk deployment is still required for
  release. No secret key or Firebase client configuration is committed.

## Login runtime correction

The first signed-in S20 session exposed a shared call-outbox startup bug: React
Native defines `window` but does not provide DOM event listeners. The flush trigger
now checks the event APIs before subscribing; its initial flush and native AppState
resume behavior remain intact. A regression test runs the actual call module with
a native-style window, no window and a browser event target.

Android authentication now redirects from the authenticated auth layout after the
root navigator remounts, rather than dispatching a replace action from the stale
login navigator. This applies to password login, email verification and signup.
Existing web and iOS navigation callbacks are preserved.

The same window-is-browser assumption also affected API host resolution. Native
clients now use the configured remote API even when a Metro window/location is
present; web remains same-origin. DavaQ requests explicitly expect JSON so an HTML
fallback response becomes a query error instead of successful domain data.
The corrected bundle loaded on the S20 with the existing login session; the home
screen rendered behind the Android notification permission dialog, and no new
ReactNativeJS/AndroidRuntime errors were observed for that app process.

## Remaining acceptance work

This branch is the native calling foundation, not a claim of Telegram-level parity.
Real two-party audio/video tests are required before enabling a release broadly:

1. Galaxy S20 (Android 13): foreground/background/locked-screen/cold-start incoming
   calls, notification body vs accept vs decline, local and remote end.
2. Bluetooth, wired headset, earpiece, speaker, mute and camera denial; no audio
   route competition or lingering microphone/camera after end.
3. Rapid accept/end, late push, account switch, logout and network loss/reconnect.
4. Screen-off call duration/battery and frame/scroll performance measurements.
5. A second Android 14+ device: full-screen-intent policy and foreground-service
   permission restrictions.

Firebase app registration alone does not configure server delivery. The DavaQ API's
`FIREBASE_SERVICE_ACCOUNT` must belong to `davaq-43e77`; verify this before testing
FCM token registration and server-to-device delivery. On 2026-10-10 the public
domain resolves to 3.36.44.173, while the initial deployment document and SSH alias
still point to 43.203.184.26. The stale SSH address also fails trusted host-key
verification; it must not be used by bypassing verification.

The user identified the operating account as Sellink. The AWS console labels
746491202681 as Sellink, and the existing default CLI session is valid for that
account. Read-only checks found no Seoul EC2/Lightsail instances or identifiable
DavaQ load balancer/cluster in that account. The older davaq-deploy profile belongs
to 723146859992 and is expired; it was not overwritten with a different account.
Resource Explorer did confirm that the DavaQ bucket
`davaq-prod-723146859992-ap-northeast-2` is owned by Sellink (746491202681),
despite the different account number in its name. This identifies storage, not the
application server. Locate and verify the current deployment before changing
server credentials.

Group calls, real OS picture-in-picture, media hold/resume for competing cellular
calls, SQLite message cache/outbox migration, resumable uploads, native share targets,
notification replies and measured performance budgets remain separate Android
milestones. Hold capability is intentionally not advertised by this implementation.
