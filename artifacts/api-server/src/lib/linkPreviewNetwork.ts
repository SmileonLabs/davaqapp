import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import net from "node:net";
import type { IncomingHttpHeaders } from "node:http";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 2_500;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface LinkPreviewResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface LinkPreviewPinnedTarget extends LinkPreviewResolvedAddress {
  url: URL;
}

export interface LinkPreviewPinnedResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface LinkPreviewNetworkDependencies {
  resolve?: (hostname: string) => Promise<readonly LinkPreviewResolvedAddress[]>;
  request?: (
    target: LinkPreviewPinnedTarget,
    signal: AbortSignal,
  ) => Promise<LinkPreviewPinnedResponse>;
}

export interface PinnedPublicHtml {
  finalUrl: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Fetches a preview without ever handing an unvalidated hostname to the HTTP
 * client. DNS is resolved once per redirect hop and the request is made to the
 * exact validated address, while Host/SNI retain the original public hostname.
 */
export async function fetchPinnedPublicHtml(
  rawUrl: string,
  dependencies: LinkPreviewNetworkDependencies = {},
): Promise<PinnedPublicHtml> {
  const resolve = dependencies.resolve ?? resolveHostname;
  const request = dependencies.request ?? requestPinnedUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let currentUrl = parseAndAssertSafeUrl(rawUrl);
    const visited = new Set<string>();

    for (let redirectCount = 0; ; redirectCount += 1) {
      if (controller.signal.aborted) throw abortError();
      currentUrl.hash = "";
      const normalizedUrl = currentUrl.toString();
      if (visited.has(normalizedUrl)) throw new Error("link preview redirect loop");
      visited.add(normalizedUrl);

      const target = await resolvePublicTarget(currentUrl, resolve, controller.signal);
      const response = await request(target, controller.signal);

      if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
        const location = firstHeader(response.headers.location);
        if (!location) throw new Error("link preview redirect missing location");
        if (redirectCount >= MAX_REDIRECTS) throw new Error("too many link preview redirects");
        currentUrl = parseAndAssertSafeUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`link preview HTTP ${response.statusCode}`);
      }

      const contentType = firstHeader(response.headers["content-type"])?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("link preview response is not HTML");
      }

      return {
        finalUrl: normalizedUrl,
        headers: response.headers,
        body: response.body,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function isSafePublicUrl(url: URL): boolean {
  try {
    assertSafeUrlShape(url);
    return true;
  } catch {
    return false;
  }
}

export function pinnedRequestOptions(
  target: LinkPreviewPinnedTarget,
): https.RequestOptions {
  const originalHostname = normalizedHostname(target.url.hostname);
  return {
    protocol: target.url.protocol,
    hostname: target.address,
    family: target.family,
    port: target.url.port ? Number(target.url.port) : undefined,
    method: "GET",
    path: `${target.url.pathname}${target.url.search}`,
    agent: false,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Encoding": "identity",
      "User-Agent": "AnotherMeBot/1.0 (+https://davaq.anothermeai.app)",
      Host: target.url.host,
    },
    ...(target.url.protocol === "https:" ? { servername: originalHostname } : {}),
  };
}

async function resolveHostname(hostname: string): Promise<readonly LinkPreviewResolvedAddress[]> {
  const entries = await dnsLookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
}

async function resolvePublicTarget(
  url: URL,
  resolve: NonNullable<LinkPreviewNetworkDependencies["resolve"]>,
  signal: AbortSignal,
): Promise<LinkPreviewPinnedTarget> {
  assertSafeUrlShape(url);
  const hostname = normalizedHostname(url.hostname);
  const literalFamily = net.isIP(hostname);
  const resolved = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await abortable(resolve(hostname), signal);

  if (resolved.length === 0) throw new Error("link preview hostname has no address");

  const unique = new Map<string, LinkPreviewResolvedAddress>();
  for (const entry of resolved) {
    const actualFamily = net.isIP(entry.address);
    if (actualFamily === 0 || actualFamily !== entry.family || !isPublicIp(entry.address)) {
      // A mixed public/private answer is rejected instead of selecting only the
      // public record; this prevents a later resolver choice from reaching LAN.
      throw new Error("link preview hostname resolved to a non-public address");
    }
    unique.set(`${entry.family}:${entry.address}`, {
      address: entry.address,
      family: entry.family,
    });
  }

  const selected = unique.values().next().value as LinkPreviewResolvedAddress | undefined;
  if (!selected) throw new Error("link preview hostname has no usable address");
  return { url, ...selected };
}

function requestPinnedUrl(
  target: LinkPreviewPinnedTarget,
  signal: AbortSignal,
): Promise<LinkPreviewPinnedResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const client = target.url.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const fail = (error: Error) => finish(() => reject(error));
    const request = client.request(pinnedRequestOptions(target), (response) => {
      const statusCode = response.statusCode ?? 0;
      if (REDIRECT_STATUS_CODES.has(statusCode)) {
        finish(() => resolve({ statusCode, headers: response.headers, body: "" }));
        response.destroy();
        return;
      }

      const declaredLength = Number(firstHeader(response.headers["content-length"]) ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
        response.destroy(new Error("link preview HTML is too large"));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.length;
        if (receivedBytes > MAX_HTML_BYTES) {
          response.destroy(new Error("link preview HTML is too large"));
          return;
        }
        chunks.push(bytes);
      });
      response.once("error", fail);
      response.once("end", () => {
        finish(() =>
          resolve({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks, receivedBytes).toString("utf8"),
          }),
        );
      });
    });

    const onAbort = () => request.destroy(abortError());
    request.once("error", fail);
    signal.addEventListener("abort", onAbort, { once: true });
    request.end();
  });
}

function parseAndAssertSafeUrl(rawUrl: string): URL {
  if (rawUrl.length > 4_096) throw new Error("link preview URL is too long");
  const url = new URL(rawUrl);
  assertSafeUrlShape(url);
  url.hash = "";
  return url;
}

function assertSafeUrlShape(url: URL): void {
  if (url.href.length > 4_096) throw new Error("link preview URL is too long");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported link preview protocol");
  }
  if (url.username || url.password) throw new Error("link preview URL cannot contain credentials");

  const hostname = normalizedHostname(url.hostname);
  const lowerHostname = hostname.toLowerCase();
  if (!hostname) throw new Error("link preview URL has no hostname");
  if (
    lowerHostname === "localhost" ||
    lowerHostname.endsWith(".localhost") ||
    lowerHostname.endsWith(".local") ||
    lowerHostname.endsWith(".internal") ||
    lowerHostname.endsWith(".lan")
  ) {
    throw new Error("link preview hostname is not public");
  }

  if (net.isIP(hostname) !== 0 && !isPublicIp(hostname)) {
    throw new Error("link preview address is not public");
  }
}

function isPublicIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return false;
  if (a === 192 && b === 88 && octets[2] === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && octets[2] === 100) return false;
  if (a === 203 && b === 0 && octets[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6Groups(address);
  if (!groups) return false;

  // Only global-unicast 2000::/3 is eligible. Transition, documentation and
  // special-purpose subnets inside that range are excluded below.
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2001 && groups[1] < 0x0200) return false; // IETF special-purpose /23
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (groups[0] === 0x2002) return false; // 6to4 can embed a private IPv4 address
  if (groups[0] === 0x3ffe) return false; // deprecated 6bone
  if (groups[0] === 0x3fff && groups[1] < 0x1000) return false; // documentation /20
  return true;
}

function parseIpv6Groups(address: string): number[] | null {
  let source = normalizedHostname(address).toLowerCase();
  if (source.includes("%")) return null;

  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = source.slice(lastColon + 1);
    const octets = ipv4.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return null;
    }
    source = `${source.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) |
      octets[3]
    ).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const rawGroups = halves.length === 2
    ? [...left, ...Array<string>(missing).fill("0"), ...right]
    : left;
  if (rawGroups.length !== 8 || rawGroups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  return rawGroups.map((group) => Number.parseInt(group, 16));
}

function normalizedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function abortError(): Error {
  const error = new Error("link preview request aborted");
  error.name = "AbortError";
  return error;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
