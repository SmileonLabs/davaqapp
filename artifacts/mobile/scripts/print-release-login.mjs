import { fileURLToPath } from "node:url";
import { loadReleaseLogin } from "./release-login-config.mjs";
// Public client configuration only, consumed by the Windows build wrapper.
console.log(JSON.stringify(loadReleaseLogin(fileURLToPath(new URL("../", import.meta.url)))));
