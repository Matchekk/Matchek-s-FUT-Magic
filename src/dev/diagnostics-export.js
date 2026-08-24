import { jsonByteLength, resolveDevLimits } from "./limits.js";
import { sanitizeNetworkBatch, sanitizeRouteBatch } from "./metadata.js";
import { sanitizeDiagnosticValue, truncateDiagnosticString } from "./redaction.js";

function sanitizeLogs(logs, limits) {
  return (Array.isArray(logs) ? logs : [])
    .slice(-limits.maxLogs)
    .map((entry) =>
      sanitizeDiagnosticValue(entry, {
        maxDepth: 5,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 750,
      }),
    );
}

function trimExportToLimit(bundle, maxBytes) {
  const trimOrder = [
    bundle.network,
    bundle.navigation,
    bundle.logs,
    bundle.healthChecks,
  ];
  let changed = false;
  for (const collection of trimOrder) {
    while (jsonByteLength(bundle) > maxBytes && collection.length > 0) {
      collection.shift();
      changed = true;
    }
  }
  while (
    jsonByteLength(bundle) > maxBytes &&
    Array.isArray(bundle.latestSnapshot?.classes) &&
    bundle.latestSnapshot.classes.length > 0
  ) {
    bundle.latestSnapshot.classes.pop();
    changed = true;
  }
  while (
    jsonByteLength(bundle) > maxBytes &&
    Array.isArray(bundle.latestSnapshot?.capabilities) &&
    bundle.latestSnapshot.capabilities.length > 0
  ) {
    bundle.latestSnapshot.capabilities.pop();
    changed = true;
  }
  if (jsonByteLength(bundle) > maxBytes) {
    bundle.latestSnapshot = null;
    bundle.snapshotDiff = null;
    changed = true;
  }
  if (jsonByteLength(bundle) > maxBytes) {
    bundle.developerMode = { enabled: !!bundle.developerMode?.enabled };
    changed = true;
  }
  bundle.truncated = bundle.truncated || changed;
  return bundle;
}

/**
 * Produces a self-contained JSON-safe diagnostic bundle. Network records are
 * excluded unless the caller supplies an explicit origin allowlist.
 */
export function createDiagnosticsExport(input = {}, options = {}) {
  const limits = resolveDevLimits(options);
  const bundle = {
    schemaVersion: 1,
    product: truncateDiagnosticString(input.product || "GrindPilot FC26", 100),
    extensionVersion: truncateDiagnosticString(input.extensionVersion || "unknown", 80),
    generatedAt: Number.isFinite(Number(input.generatedAt))
      ? Math.max(0, Math.floor(Number(input.generatedAt)))
      : 0,
    developerMode: sanitizeDiagnosticValue(input.developerMode ?? { enabled: false }, {
      maxDepth: 3,
      maxItems: 20,
      maxKeys: 20,
      maxStringLength: 200,
    }),
    latestSnapshot: sanitizeDiagnosticValue(input.latestSnapshot ?? null, {
      maxDepth: limits.maxDepth,
      maxItems: Math.max(limits.maxClasses, limits.maxMethodsPerClass),
      maxKeys: limits.maxObjectKeys,
      maxStringLength: limits.maxStringLength,
    }),
    snapshotDiff: sanitizeDiagnosticValue(input.snapshotDiff ?? null, {
      maxDepth: limits.maxDepth,
      maxItems: limits.maxDiffItems,
      maxKeys: limits.maxObjectKeys,
      maxStringLength: limits.maxStringLength,
    }),
    navigation: sanitizeRouteBatch(input.navigation, {
      ...options,
      maxItems: limits.maxRoutes,
    }),
    network: sanitizeNetworkBatch(input.network, {
      ...options,
      maxItems: limits.maxNetworkRecords,
    }),
    logs: sanitizeLogs(input.logs, limits),
    healthChecks: sanitizeDiagnosticValue(input.healthChecks ?? [], {
      maxDepth: 5,
      maxItems: 100,
      maxKeys: 50,
      maxStringLength: 500,
    }),
    truncated: false,
  };
  return trimExportToLimit(bundle, limits.maxExportBytes);
}

export function serializeDiagnosticsExport(input = {}, options = {}) {
  const limits = resolveDevLimits(options);
  const bundle = createDiagnosticsExport(input, options);
  const serialized = JSON.stringify(bundle, null, 2);
  if (jsonByteLength(bundle) > limits.maxExportBytes) {
    throw new Error("Diagnostic export exceeds configured byte limit");
  }
  return serialized;
}
