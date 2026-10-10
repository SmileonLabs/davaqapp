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

Version 11 signed AAB/APK build succeeded (3m54s), and standalone APK validation passed. AAB SHA-256: `5DE85AF4B45D0944BD081EA9CBB81FF3BAE4B2F4761461C6DA0C97D20EF57111`.

Version 11 was published to internal testing on 2026-10-10 at 10:29 KST. The Play-signed universal APK was downloaded and its package, version and signing certificate were verified against the installed Play app. After USB reconnection, the Play-signed version 11 APK was installed successfully with adb install -r and versionCode 11 was confirmed. App data was not cleared. Launch was blocked by the Google Play installer check (LicenseClient: wrong installer), followed by EXIT_SELF. The user must complete the official Play installation prompt; do not spoof the installer or disable protection. Real two-party voice/video verification is pending.
The reproduced code defect is a candidate for the reported immediate cancellation;
end-to-end resolution is not yet confirmed.

## Android ringback and incoming push investigation (version 12)

The connected Play-installed Android app registered its device successfully.
The user reports outgoing calls no longer cancel immediately. Two-way media is
not yet verified. An official Play installation was confirmed after the installer
check blocked the earlier USB update.

Outgoing ringback used an Expo media player, so a phone with media volume at zero
could make ordinary calls audibly while DavaQ's ringback was silent. Core-Telecom
now owns a native ToneGenerator on STREAM_VOICE_CALL. It starts after Telecom
registration and releases the tone on activation, termination and service teardown.
The Android JS layer no longer creates a competing media player/audio focus owner.
Incoming ringing continues to respect the device's ring/silent settings.

Recent production FCM sends failed with messaging/mismatched-credential. Correct
server credentials are required separately; installing version 12 alone does not
fix background delivery. No production credentials belong in the app or repository.
Mobile typecheck and all 30 existing Android regression tests passed. Release build,
Play rollout and audible device verification are pending at this checkpoint.
