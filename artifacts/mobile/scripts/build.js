/**
 * Production build for the browser PWA (real web app).
 *
 * Runs `expo export -p web` to produce a static single-page web build in
 * ./web-build (index.html + _expo/static/... + assets). The deployment then
 * serves this with server/serve.js as an SPA at the artifact base path (/app/).
 *
 * This REPLACES the previous "Open in Expo Go" launcher build. It does NOT
 * affect native EAS (APK/iOS) builds, which run off-platform from app.json.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const OUTPUT_DIR = process.env.PWA_OUTPUT_DIR || "web-build";
const outputPath = path.resolve(projectRoot, OUTPUT_DIR);
const relativeOutputPath = path.relative(projectRoot, outputPath);
if (
  !OUTPUT_DIR.trim() ||
  OUTPUT_DIR === "." ||
  OUTPUT_DIR === ".." ||
  path.basename(OUTPUT_DIR) !== OUTPUT_DIR ||
  !relativeOutputPath ||
  relativeOutputPath.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeOutputPath)
) {
  throw new Error(
    "PWA_OUTPUT_DIR must be a non-special directory name inside the mobile project",
  );
}

function toOrigin(value) {
  let urlString = value.trim();
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }
  return new URL(urlString).origin;
}

function getDeploymentOrigin() {
  const origin =
    process.env.PWA_ORIGIN ||
    process.env.REPLIT_INTERNAL_APP_DOMAIN ||
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.EXPO_PUBLIC_DOMAIN;

  if (!origin) {
    console.error(
      "ERROR: No PWA origin found. Set PWA_ORIGIN, REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN",
    );
    process.exit(1);
  }
  return toOrigin(origin);
}

function getBasePath() {
  const raw = (process.env.PWA_BASE_PATH || "/app").trim();
  if (!raw.startsWith("/")) {
    throw new Error("PWA_BASE_PATH must start with '/'");
  }
  return raw === "/" ? "" : raw.replace(/\/+$/, "");
}

function patchExportedHtml(indexHtmlPath, basePath) {
  // Best-effort: a patch failure must never block the deploy — the app still
  // works (just without the standalone layout clamp), like the rest of build.js.
  try {
    let html = fs.readFileSync(indexHtmlPath, "utf8");

    // Keep browser chrome and the standalone iOS PWA on the same dark surface.
    // Expo's generated head varies by SDK version, so normalize the viewport
    // and inject the iOS-specific metadata at build time rather than relying on
    // each screen to compensate independently.
    const viewport =
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';
    html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, viewport);
    if (!html.includes('name="viewport"')) html = html.replace("</head>", `    ${viewport}\n  </head>`);

    const headMeta = [
      '<meta name="theme-color" content="#F7F6FB">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
      '<meta name="mobile-web-app-capable" content="yes">',
    ];
    for (const meta of headMeta) {
      const name = meta.match(/name="([^"]+)"/)?.[1];
      if (name && !new RegExp(`<meta\\s+name=["']${name}["']`, "i").test(html)) {
        html = html.replace("</head>", `    ${meta}\n  </head>`);
      }
    }

    const assetBase = basePath || "";
    const headLinks = [
      `<link rel="manifest" href="${assetBase}/manifest.webmanifest?v=20260912-davaq">`,
      `<link rel="apple-touch-icon" sizes="180x180" href="${assetBase}/davaq-apple-touch-icon.png?v=20260912-davaq">`,
    ];
    for (const link of headLinks) {
      const rel = link.match(/rel="([^"]+)"/)?.[1];
      if (rel && !new RegExp(`<link\\s+rel=["']${rel}["']`, "i").test(html)) {
        html = html.replace("</head>", `    ${link}\n  </head>`);
      }
    }

    // Prevent the document itself from rubber-band scrolling. Individual
    // ScrollView/FlatList screens remain scrollable inside this fixed shell.
    const MARKER = "anotherme-pwa-layout-fix";
    if (!html.includes(MARKER) && html.includes("</head>")) {
      const style = `    <style id="${MARKER}">\n      :root { background: #F7F6FB; color-scheme: light; }\n      html, body { width: 100%; max-width: 100%; height: 100%; min-height: 100dvh; margin: 0; overflow: hidden; }\n      body { background: #F7F6FB; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; overscroll-behavior: none; }\n      #root { width: 100%; height: 100%; min-height: 100dvh; overflow: auto; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); box-sizing: border-box; }\n    </style>\n  </head>`;
      html = html.replace("</head>", style);
    }

    // The native splash is configured in app.json. Mirror it in the exported
    // PWA so launching from a browser home screen never flashes an empty page
    // while the JavaScript bundle and authentication provider initialize.
    const SPLASH_MARKER = "anotherme-boot-splash";
    if (!html.includes(`id="${SPLASH_MARKER}"`) && /<body[^>]*>/i.test(html)) {
      const splash = `<div id="${SPLASH_MARKER}" aria-hidden="true"><img src="${assetBase}/davaq-icon-512.png" alt=""></div>
    <style>
      #${SPLASH_MARKER} { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: #F7F6FB; }
      #${SPLASH_MARKER} img { width: min(44vw, 224px); height: auto; display: block; }
    </style>
    <script>
      (() => {
        const removeSplash = () => document.getElementById("${SPLASH_MARKER}")?.remove();
        const observer = new MutationObserver(() => {
          const root = document.getElementById("root");
          if (root && root.childNodes.length > 0) {
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(removeSplash));
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.setTimeout(removeSplash, 8000);
      })();
    </script>`;
      html = html.replace(/<body([^>]*)>/i, `<body$1>\n    ${splash}`);
    }

    fs.writeFileSync(indexHtmlPath, html);
    console.log("Patched index.html for iOS standalone-PWA layout.");
  } catch (err) {
    console.warn(`WARN: could not patch index.html layout: ${err.message}`);
  }
}

function copyPwaShellAssets(outPath) {
  const publicDir = path.join(projectRoot, "public");
  const files = [
    "sw.js",
    "sw-cache-policy.js",
    "manifest.webmanifest",
    "davaq-icon-192.png",
    "davaq-icon-512.png",
    "davaq-apple-touch-icon.png",
  ];

  for (const file of files) {
    const source = path.join(publicDir, file);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing required PWA shell asset: public/${file}`);
    }
    fs.copyFileSync(source, path.join(outPath, file));
  }
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: projectRoot,
      env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function patchExportedFontUrls(outPath, basePath, version) {
  const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const jsDir = path.join(outPath, "_expo", "static", "js");
  const jsFiles = [];

  function collectJsFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectJsFiles(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".js")) jsFiles.push(fullPath);
    }
  }

  collectJsFiles(jsDir);
  const sourceAssets = path.join(outPath, "assets", "__node_modules");
  const publicFontDir = path.join(outPath, "assets", "fonts");
  fs.mkdirSync(publicFontDir, { recursive: true });
  const publicFonts = new Set();
  function collectFonts(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFonts(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ttf")) {
        const safeName = entry.name.replace(/[^A-Za-z0-9._-]/g, "_");
        if (!publicFonts.has(safeName)) {
          fs.copyFileSync(fullPath, path.join(publicFontDir, safeName));
          publicFonts.add(safeName);
        }
      }
    }
  }
  collectFonts(sourceAssets);
  for (const jsFile of jsFiles) {
    const original = fs.readFileSync(jsFile, "utf8");
    let patched = original.replace(
      new RegExp(`(${escapedBasePath}/assets/[^"'\\s)]+\\.ttf)(?!\\?)`, "g"),
      `$1?v=${version}`,
    );
    patched = patched.replace(new RegExp(`${escapedBasePath}/assets/__node_modules/(?:[^"'\\s)]+/)*([^/"'\\s)]+\\.ttf)(?:\\?[^"'\\s)]*)?`, "g"), `${basePath}/assets/fonts/$1?v=${version}`);
    if (patched !== original) {
      fs.writeFileSync(jsFile, patched);
      console.log(`Patched font asset URLs in ${path.relative(outPath, jsFile)}.`);
    }
  }

  const indexHtmlPath = path.join(outPath, "index.html");
  try {
    let html = fs.readFileSync(indexHtmlPath, "utf8");
    html = html.replace(
      new RegExp(`(${escapedBasePath}/_expo/static/js/web/[^"']+\\.js)(?!\\?)`, "g"),
      `$1?v=${version}`,
    );
    fs.writeFileSync(indexHtmlPath, html);
  } catch (err) {
    console.warn(`WARN: could not patch index.html asset version: ${err.message}`);
  }
}

function patchServiceWorker(outPath, basePath, version) {
  const swPath = path.join(outPath, "sw.js");
  const indexPath = path.join(outPath, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const scopePath = `${basePath || ""}/`;
  const assets = new Set([
    scopePath,
    `${basePath}/sw-cache-policy.js`,
    `${basePath}/manifest.webmanifest`,
    `${basePath}/davaq-icon-192.png`,
    `${basePath}/davaq-icon-512.png`,
    `${basePath}/davaq-apple-touch-icon.png`,
  ]);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.startsWith(`${basePath}/_expo/`) || value.startsWith(`${basePath}/assets/`)) {
      assets.add(value);
    }
  }
  const staticRoot = path.join(outPath, "_expo", "static");
  function addStaticFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        addStaticFiles(fullPath);
      } else if (entry.isFile() && /\.(?:js|css)$/i.test(entry.name)) {
        const relative = path.relative(outPath, fullPath).split(path.sep).join("/");
        const url = `${basePath}/${relative}`;
        const alreadyIncluded = [...assets].some(
          (asset) => asset.split(/[?#]/, 1)[0] === url,
        );
        if (!alreadyIncluded) assets.add(url);
      }
    }
  }
  addStaticFiles(staticRoot);
  const safeVersion = String(version).replace(/[^A-Za-z0-9._-]/g, "-");
  const assetLiteral = [...assets].map((asset) => JSON.stringify(asset)).join(",");
  const source = fs
    .readFileSync(swPath, "utf8")
    .replaceAll("__PWA_CACHE_VERSION__", safeVersion)
    .replace("/*__PWA_APP_SHELL_ASSETS__*/", assetLiteral);
  fs.writeFileSync(swPath, source);
  console.log(`Prepared versioned PWA app-shell cache with ${assets.size} entry points.`);
}

function runPnpm(args, env) {
  return process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...args], env)
    : run("pnpm", args, env);
}

async function main() {
  const origin = getDeploymentOrigin();
  const domain = new URL(origin).host;
  const basePath = getBasePath();
  const assetVersion = process.env.PWA_ASSET_VERSION || Date.now().toString(36);
  console.log(`Building browser web export (PWA) for ${origin}${basePath || "/"} ...`);

  const outPath = outputPath;
  if (fs.existsSync(outPath)) {
    fs.rmSync(outPath, { recursive: true, force: true });
  }

  // EXPO_PUBLIC_* vars are inlined into the web bundle at build time, so they
  // must be present here (unlike the dev server, which reads them at runtime).
  const clerkKey =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    "";
  if (!clerkKey) {
    console.error(
      "ERROR: No Clerk publishable key found (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_PUBLISHABLE_KEY). " +
        "The web app cannot bootstrap auth without it — building would produce a blank error page. " +
        "Set the key in the deployment environment and rebuild.",
    );
    process.exit(1);
  }
  const vapidPublicKey =
    process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ||
    process.env.VAPID_PUBLIC_KEY ||
    "";
  if (!vapidPublicKey) {
    console.warn(
      "WARN: No VAPID public key found (EXPO_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PUBLIC_KEY). " +
        "The PWA will build, but browser push notifications will be unavailable.",
    );
  }

  const env = {
    ...process.env,
    // Reduce Metro worker count to keep the web export within memory limits.
    EXPO_WEB_EXPORT: "1",
    EXPO_PUBLIC_DOMAIN: domain,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || origin,
    EXPO_PUBLIC_REPL_ID:
      process.env.REPL_ID || process.env.EXPO_PUBLIC_REPL_ID || "",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey,
    EXPO_PUBLIC_VAPID_PUBLIC_KEY: vapidPublicKey,
    // Production-only: a pk_live Clerk instance resolves its Frontend API at
    // clerk.<domain>, which has no DNS on *.replit.app. Route Clerk through the
    // api-server proxy (/api/__clerk) instead so the browser can reach it.
    // build.js only runs for the production deploy, so this never leaks to dev.
    EXPO_PUBLIC_CLERK_PROXY_URL:
      process.env.EXPO_PUBLIC_CLERK_PROXY_URL ||
      (clerkKey.startsWith("pk_live_") ? `${origin}/api/__clerk` : ""),
  };

  // experiments.baseUrl is WEB-ONLY here, but expo-router bakes it into the
  // NATIVE bundle too (production builds prefix/strip routes with it), which
  // breaks the APK with a "+not-found" screen. So the committed app.json must
  // NOT contain baseUrl. We inject it only for this web export and restore the
  // file afterward (even on failure), so EAS native builds stay correct.
  const appJsonPath = path.join(projectRoot, "app.json");
  const originalAppJson = fs.readFileSync(appJsonPath, "utf8");
  const appConfig = JSON.parse(originalAppJson);
  appConfig.expo = appConfig.expo || {};
  appConfig.expo.experiments = appConfig.expo.experiments || {};
  appConfig.expo.experiments.baseUrl = basePath || "/";
  fs.writeFileSync(appJsonPath, JSON.stringify(appConfig, null, 2) + "\n");

  try {
    await run(process.execPath, [path.join(path.dirname(require.resolve("expo/package.json")), "bin", "cli"), "export", "--clear", "-p", "web", "--output-dir", OUTPUT_DIR], env);
  } finally {
    // Always restore the committed app.json (no baseUrl) for native builds.
    fs.writeFileSync(appJsonPath, originalAppJson);
  }

  const indexHtml = path.join(outPath, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(
      `Build failed: ${OUTPUT_DIR}/index.html was not produced by expo export.`,
    );
    process.exit(1);
  }

  // Patch the exported HTML <head> for correct iOS standalone-PWA layout.
  // Expo's single-page (non-static) export uses a built-in HTML template, so
  // `app/+html.tsx` is ignored — we inject here instead. Two fixes:
  //  1) viewport-fit=cover so the layout extends correctly under the notch.
  //  2) overflow-x:hidden + max-width:100% on html/body/#root. Once installed
  //     to the iOS home screen (standalone), any element a few px wider than the
  //     viewport leaves the whole app stuck scrolled to the right on EVERY
  //     screen (there's no browser chrome to snap it back). Clamping the root
  //     elements pins the layout to the viewport.
  copyPwaShellAssets(outPath);
  patchExportedHtml(indexHtml, basePath);
  patchExportedFontUrls(outPath, basePath, assetVersion);
  patchServiceWorker(outPath, basePath, assetVersion);

  console.log(`Web build complete: ${outPath}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Build failed:", error.message);
  process.exit(1);
});
