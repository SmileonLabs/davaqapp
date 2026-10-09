# Android message notifications

Android device registration must remain stable across ordinary React rerenders.
The registrar captures the latest Clerk token getter in a ref and only cleans up
ownership when the actual account changes or the component unmounts.

Foreground FCM notifications need explicit display on Android. Notifee shows
regular messages with sound, a private lock-screen preview and an in-app tap route.
The room currently being read is suppressed, as are duplicate message IDs and
notifications addressed to another signed-in owner. The server selects the matching
`general-notifications` channel with default sound and vibration.

Android versionCode: 10. iOS source is unchanged.

Validation: mobile and API typechecks pass, 25 Android tests pass (including actual
registrar rerender/account-switch behavior), and 7 focused API tests pass. API build
passes. Production credentials and end-to-end device delivery are separate checks;
a successful build alone does not establish push delivery.

## Build and deployment checkpoint

API notification-channel change is deployed and the API health check passes.
Android signed AAB/APK build succeeded (14m55s); versionCode 10, signature and
standalone release checks pass. All 29 ARM64 libraries and APK ZIP alignment pass
16 KB compatibility checks. AAB SHA-256:
`4FB3977B4FFD0DA249CE2C41E4CBECBB47B02AFEF2EB2CAC48A5087D52EAE682`.

The AAB is uploaded to internal release draft 2; Play processing is still pending
at this checkpoint. Firebase credential setup is awaiting owner approval. Real
server-to-device receipt, audio and tap routing must be verified before describing
the incident as resolved. The connected development phone was asleep during the
last registration attempt; unlocking and opening the app is still required.
