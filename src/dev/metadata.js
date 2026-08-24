import { DEV_LIMITS, clampLimit } from "./limits.js";
import { redactSecretText } from "./redaction.js";

const ROUTE_TYPES = new Set([
  "adapter",
  "hashchange",
  "navigation",
  "popstate",
  "pushState",
  "replaceState",
]);

function parseHttpUrl(value, baseUrl) {
  try {
    const raw = String(value || "");
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    if (!isAbsolute && !baseUrl) return null;
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function safePathname(url) {
  const decoded = (() => {
    try {
      return decodeURIComponent(url.pathname);
    } catch {
      return url.pathname;
    }
  })();
  return redactSecretText(decoded || "/", 500);
}

export function sanitizeUrl(value, options = {}) {
  let url;
  if (
    value &&
    typeof value === "object" &&
    typeof value.origin === "string" &&
    typeof value.pathname === "string"
  ) {
    url = parseHttpUrl(value.origin);
    if (url) url.pathname = value.pathname;
  } else {
    url = parseHttpUrl(value, options.baseUrl);
  }
  if (!url) return null;
  return {
    origin: url.origin,
    pathname: safePathname(url),
  };
}

export function sanitizeRouteMetadata(input = {}, options = {}) {
  const from = sanitizeUrl(input.from, options);
  const to = sanitizeUrl(input.to, options);
  if (!from && !to) return null;
  const rawType = String(input.type || "navigation");
  return {
    timestamp: Number.isFinite(Number(input.timestamp))
      ? Math.max(0, Math.floor(Number(input.timestamp)))
      : null,
    type: ROUTE_TYPES.has(rawType) ? rawType : "navigation",
    from,
    to,
    source: redactSecretText(input.source || "webapp", 80),
  };
}

function normalizeAllowedOrigins(values) {
  const origins = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const parsed = parseHttpUrl(value);
    if (parsed) origins.add(parsed.origin);
  }
  return origins;
}

function finiteInteger(value, minimum, maximum, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(numeric)));
}

/**
 * Returns a strict metadata projection. Headers, query strings, fragments,
 * bodies and response payloads are intentionally never copied.
 */
export function sanitizeNetworkMetadata(input = {}, options = {}) {
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  if (allowedOrigins.size === 0) return null;
  let url;
  if (typeof input.origin === "string" && typeof input.pathname === "string") {
    url = parseHttpUrl(input.origin);
    if (url) url.pathname = input.pathname;
  } else {
    url = parseHttpUrl(input.url || input.endpoint, options.baseUrl);
  }
  if (!url || !allowedOrigins.has(url.origin)) return null;

  const rawMethod = String(input.method || "GET").toUpperCase();
  const method = /^[A-Z]{1,12}$/.test(rawMethod) ? rawMethod : "OTHER";
  const status = finiteInteger(input.status, 0, 599, 0);
  const durationMs = Number(input.durationMs);
  const sizeBytes = Number(input.sizeBytes ?? input.size);

  return {
    timestamp: finiteInteger(input.timestamp ?? input.ts, 0, Number.MAX_SAFE_INTEGER),
    requestId: redactSecretText(input.requestId ?? input.id ?? "", 100),
    origin: url.origin,
    pathname: safePathname(url),
    method,
    status,
    ok: typeof input.ok === "boolean" ? input.ok : status >= 200 && status < 400,
    durationMs: Number.isFinite(durationMs)
      ? Math.min(600_000, Math.max(0, Math.round(durationMs * 100) / 100))
      : null,
    sizeBytes: Number.isFinite(sizeBytes)
      ? Math.min(100_000_000, Math.max(0, Math.floor(sizeBytes)))
      : null,
    transport: ["adapter", "fetch", "xhr"].includes(input.transport)
      ? input.transport
      : "adapter",
    errorCode: input.errorCode
      ? redactSecretText(input.errorCode, 100)
      : null,
  };
}

export function sanitizeRouteBatch(records, options = {}) {
  const limit = clampLimit(options.maxItems, DEV_LIMITS.maxRoutes);
  return (Array.isArray(records) ? records : [])
    .slice(-limit)
    .map((record) => sanitizeRouteMetadata(record, options))
    .filter(Boolean);
}

export function sanitizeNetworkBatch(records, options = {}) {
  const limit = clampLimit(options.maxItems, DEV_LIMITS.maxNetworkRecords);
  return (Array.isArray(records) ? records : [])
    .slice(-limit)
    .map((record) => sanitizeNetworkMetadata(record, options))
    .filter(Boolean);
}
