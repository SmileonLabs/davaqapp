import { createRoot } from "react-dom/client";
import App from "./App";

const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as any).standalone;

// Chrome's address-bar "Open in app" can launch the installed PWA with the
// current landing URL. In standalone mode, always enter the actual app shell.
if (isStandalone && !window.location.pathname.startsWith("/app")) {
  window.location.replace("/app/");
}

// The PWA owns /app/. Retire only an old root landing worker; preserve app caches.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        if (registration?.scope === new URL("/", location.origin).href)
          await registration.update();
      })
      .catch(() => {
        /* The landing stays usable when service workers are unavailable. */
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
