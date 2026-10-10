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

Version 10 was subsequently published to the internal test track. Installation
was confirmed by the user; this does not establish successful call or push delivery. Firebase credential setup is awaiting owner approval. Real
server-to-device receipt, audio and tap routing must be verified before describing
the incident as resolved. The connected development phone was asleep during the
last registration attempt; unlocking and opening the app is still required.

## Android call setup investigation (version 11)

A queued owner read captured its validation clock before a preceding queued write
ran. The newly written lease could then appear to be from the future and be
deleted, preventing Android Telecom registration despite an authenticated API
session. The clock is now read inside the storage queue. Explicit timestamps,
expiry validation and account isolation remain enforced.

Regression tests reproduce the failed owner read and incoming-push match, then
exercise actual JavaScript Telecom registration with a delayed login write.
Android test suite: 30 passed; owner-policy tests: 4 passed; mobile typecheck passed.
Outgoing setup errors now distinguish API creation from system registration and
show a user-visible error with a sanitized diagnostic code.

Version 11 build and real two-party voice/video verification are pending.
The reproduced code defect is a candidate for the reported immediate cancellation;
end-to-end resolution is not yet confirmed.
