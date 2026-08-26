import { jsonByteLength, resolveDevLimits } from "./limits.js";
import { sanitizeNetworkBatch, sanitizeRouteBatch } from "./metadata.js";
import { sanitizeDiagnosticValue, truncateDiagnosticString } from "./redaction.js";

function sanitizeLogs(logs, limits) {
  return (Array.isArray(logs) ? logs : [])
    .slice(-limits.maxLogs)
    .map((entry) => {
      const safe = sanitizeDiagnosticValue(entry, {
        maxDepth: 5,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 750,
      });
      return {
        timestamp: typeof safe?.timestamp === "string" ? safe.timestamp : null,
        level: ["debug", "info", "warn", "error"].includes(safe?.level) ? safe.level : null,
        action: typeof safe?.action === "string" ? truncateDiagnosticString(safe.action, 100) : null,
        code: typeof safe?.data?.code === "string" ? truncateDiagnosticString(safe.data.code, 100) : null,
      };
    });
}

function sanitizeHealthChecks(checks, limits) {
  return (Array.isArray(checks) ? checks : [])
    .slice(-Math.min(100, limits.maxCollectionItems))
    .map((entry) => {
      const safe = sanitizeDiagnosticValue(entry, {
        maxDepth: 4,
        maxItems: 100,
        maxKeys: 50,
        maxStringLength: 200,
      });
      const capabilities = Array.isArray(safe?.capabilities)
        ? safe.capabilities.slice(0, 100).map((capability) => ({
            id: typeof capability?.id === "string" ? truncateDiagnosticString(capability.id, 100) : null,
            state: typeof capability?.state === "string"
              ? truncateDiagnosticString(capability.state, 50)
              : typeof capability?.status === "string"
                ? truncateDiagnosticString(capability.status, 50)
                : null,
          }))
        : [];
      return {
        status: typeof safe?.status === "string"
          ? truncateDiagnosticString(safe.status, 50)
          : typeof safe?.state === "string"
            ? truncateDiagnosticString(safe.state, 50)
            : null,
        capabilities,
      };
    });
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
    product: truncateDiagnosticString(input.product || "FUT Magic", 100),
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
    healthChecks: sanitizeHealthChecks(input.healthChecks, limits),
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
