export const DEV_LIMITS = Object.freeze({
  maxClasses: 500,
  maxMethodsPerClass: 192,
  maxCapabilities: 128,
  maxSnapshots: 5,
  maxSnapshotBytes: 256 * 1024,
  maxSnapshotHistoryBytes: 768 * 1024,
  maxDiffItems: 750,
  maxRoutes: 100,
  maxNetworkRecords: 200,
  maxLogs: 250,
  maxCollectionItems: 250,
  maxObjectKeys: 100,
  maxDepth: 6,
  maxStringLength: 1_000,
  maxExportBytes: 512 * 1024,
});

const MIN_LIMIT = 1;
const MAX_LIMIT = 10_000_000;
const BYTE_LIMIT_KEYS = new Set([
  "maxSnapshotBytes",
  "maxSnapshotHistoryBytes",
  "maxExportBytes",
]);

export function clampLimit(value, fallback, minimum = MIN_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(minimum, Math.floor(numeric)));
}

export function resolveDevLimits(overrides = {}) {
  const resolved = {};
  for (const [key, fallback] of Object.entries(DEV_LIMITS)) {
    resolved[key] = clampLimit(
      overrides?.[key],
      fallback,
      BYTE_LIMIT_KEYS.has(key) ? 1_024 : MIN_LIMIT,
    );
  }
  return Object.freeze(resolved);
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

export function jsonByteLength(value) {
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
