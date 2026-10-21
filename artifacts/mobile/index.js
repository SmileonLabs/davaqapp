// WalletConnect compatibility globals must be installed before any application
// module (including expo-router) imports a wallet SDK.
import "@walletconnect/react-native-compat";

// Runtime globals must be installed before expo-router evaluates route modules.
import "./lib/runtimePolyfills";

// Custom app entry. Registers the FCM background message handler (native only;
// web resolves to a no-op stub) BEFORE expo-router boots, so a killed or
// backgrounded Android device can render the full-screen incoming call. This
// file is the "main" in package.json — do not point "main" back at
// "expo-router/entry" or the killed-state handler will never register.
import "./lib/fcmBackground";
import "./lib/callActionBackground";
import "expo-router/entry";
