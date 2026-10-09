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
