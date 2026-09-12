/**
 * Standalone production server for the browser PWA web build.
 *
 * Serves the output of build.js (./web-build) as a single-page app:
 * - static files (index.html, _expo/static/..., assets/...) are served directly
 * - any unknown route falls back to index.html so client-side routing works
 *
 * The artifact is mounted at BASE_PATH (/app/); that prefix is stripped before
 * resolving files. Zero external dependencies — Node.js built-ins only.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = process.env.PWA_STATIC_ROOT
  ? path.resolve(process.env.PWA_STATIC_ROOT)
  : path.resolve(__dirname, "..", "web-build");
const INDEX_HTML = path.join(STATIC_ROOT, "index.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
const apiProxyTarget = parseApiProxyTarget(process.env.API_PROXY_TARGET);
const apiProxyOrigin =
  process.env.API_PROXY_ORIGIN ||
  process.env.PWA_ORIGIN ||
  "https://davaq.anothermeai.app";

function parseApiProxyTarget(value) {
  if (!value) return null;
  const target = new URL(value);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("API_PROXY_TARGET must use http or https");
  }
  return target;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

function serveIndex(res) {
  if (!fs.existsSync(INDEX_HTML)) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Web build not found. Run the build step first.");
    return;
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(fs.readFileSync(INDEX_HTML));
}

function serveStaticOrFallback(pathname, res) {
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
    };
    // Hashed Expo bundle/asset files are safe to cache long-term.
    if (filePath.includes(`${path.sep}_expo${path.sep}`)) {
      headers["cache-control"] = "public, max-age=31536000, immutable";
    }
    res.writeHead(200, headers);
    res.end(fs.readFileSync(filePath));
    return;
  }

  // A request that looks like a static asset (has a file extension) but does
  // not exist is a genuine 404. Returning index.html for it would surface as a
  // confusing MIME-type error in the browser console.
  if (path.extname(pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  // SPA fallback — unknown (extension-less) routes render the app shell.
  serveIndex(res);
}

function proxyApi(req, res, url) {
  if (!apiProxyTarget) return false;

  const transport = apiProxyTarget.protocol === "https:" ? https : http;
  const upstreamPath = `${apiProxyTarget.pathname.replace(/\/+$/, "")}${url.pathname}${url.search}`;
  const headers = {
    ...req.headers,
    host: apiProxyTarget.host,
    // The production API intentionally rejects unknown browser origins. The
    // preview server is same-origin from the browser's perspective, so present
    // the upstream's own trusted origin instead of weakening production CORS.
    origin: apiProxyOrigin,
  };
  delete headers["content-length"];

  const upstream = transport.request(
    apiProxyTarget,
    {
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );

  upstream.setTimeout(30_000, () => {
    upstream.destroy(new Error("Upstream API request timed out"));
  });
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "Preview API proxy unavailable" }));
  });
  req.pipe(upstream);
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (proxyApi(req, res, url)) return;
    res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "API proxy is not configured" }));
    return;
  }

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "") {
    return serveIndex(res);
  }

  serveStaticOrFallback(pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving browser web build on port ${port} (base path: ${basePath || "/"})`);
  if (apiProxyTarget) {
    console.log(`Preview API proxy enabled for ${apiProxyTarget.origin}`);
  }
});
