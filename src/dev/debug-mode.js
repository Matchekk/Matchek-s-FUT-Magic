import { discoverCapabilities, discoverUTClasses } from "./class-discovery.js";
import { createDiagnosticsExport } from "./diagnostics-export.js";
import { resolveDevLimits } from "./limits.js";
import { sanitizeNetworkMetadata, sanitizeRouteMetadata } from "./metadata.js";
import {
  appendBoundedSnapshot,
  createWebAppSnapshot,
  diffWebAppSnapshots,
} from "./snapshot.js";
import { sanitizeDiagnosticValue } from "./redaction.js";

export class DeveloperModeDisabledError extends Error {
  constructor() {
    super("Developer Mode is disabled");
    this.name = "DeveloperModeDisabledError";
    this.code = "DEVELOPER_MODE_DISABLED";
  }
}

function assertEnabled(enabled) {
  if (!enabled) throw new DeveloperModeDisabledError();
}

/**
 * Creates an opt-in diagnostics coordinator. This MVP installs no global
 * browser hooks; callers explicitly feed navigation/network metadata from the
 * existing EA adapter.
 */
export function createDeveloperMode(options = {}) {
  const root = options.root ?? globalThis;
  const limits = resolveDevLimits(options.limits);
  const capabilityDefinitions = Array.isArray(options.capabilityDefinitions)
    ? options.capabilityDefinitions
    : [];
  const allowedNetworkOrigins = Array.isArray(options.allowedNetworkOrigins)
    ? [...options.allowedNetworkOrigins]
    : [];
  const now = typeof options.now === "function" ? options.now : Date.now;
  let enabled = false;
  let snapshots = [];
  let navigation = [];
  let network = [];
  let logs = [];

  function enable() {
    enabled = true;
    return getStatus();
  }

  function disable({ clearEphemeral = true } = {}) {
    enabled = false;
    if (clearEphemeral) {
      navigation = [];
      network = [];
      logs = [];
    }
    return getStatus();
  }

  function getStatus() {
    return {
      enabled,
      instrumentation: "read-only-on-demand",
      hooksInstalled: false,
      snapshotCount: snapshots.length,
      routeCount: navigation.length,
      networkCount: network.length,
      logCount: logs.length,
    };
  }

  function discover() {
    assertEnabled(enabled);
    const classDiscovery = discoverUTClasses(root, limits);
    return {
      ...classDiscovery,
      capabilities: discoverCapabilities(root, capabilityDefinitions, limits),
    };
  }

  function captureSnapshot(details = {}) {
    assertEnabled(enabled);
    const discovery = discover();
    const snapshot = createWebAppSnapshot(
      {
        capturedAt: details.capturedAt ?? now(),
        extensionVersion: options.extensionVersion,
        webAppVersion: details.webAppVersion ?? options.webAppVersion,
        classes: discovery.classes,
        capabilities: discovery.capabilities,
        bridgeHealth: details.bridgeHealth,
        selectors: details.selectors,
        route: details.route,
      },
      limits,
    );
    snapshots = appendBoundedSnapshot(snapshots, snapshot, limits);
    return sanitizeDiagnosticValue(snapshot, {
      maxDepth: limits.maxDepth,
      maxItems: Math.max(limits.maxClasses, limits.maxMethodsPerClass),
      maxKeys: limits.maxObjectKeys,
      maxStringLength: limits.maxStringLength,
    });
  }

  function compareLatestSnapshots() {
    if (snapshots.length < 2) return null;
    return diffWebAppSnapshots(
      snapshots[snapshots.length - 2],
      snapshots[snapshots.length - 1],
      limits,
    );
  }

  function recordRoute(input) {
    if (!enabled) return false;
    const sanitized = sanitizeRouteMetadata(input);
    if (!sanitized) return false;
    navigation = [...navigation, sanitized].slice(-limits.maxRoutes);
    return true;
  }

  function recordNetwork(input) {
    if (!enabled) return false;
    const sanitized = sanitizeNetworkMetadata(input, {
      allowedOrigins: allowedNetworkOrigins,
    });
    if (!sanitized) return false;
    network = [...network, sanitized].slice(-limits.maxNetworkRecords);
    return true;
  }

  function recordLog(input) {
    if (!enabled) return false;
    const sanitized = sanitizeDiagnosticValue(input, {
      maxDepth: 5,
      maxItems: 50,
      maxKeys: 50,
      maxStringLength: 750,
    });
    logs = [...logs, sanitized].slice(-limits.maxLogs);
    return true;
  }

  function exportDiagnostics(details = {}) {
    return createDiagnosticsExport(
      {
        ...details,
        generatedAt: details.generatedAt ?? now(),
        extensionVersion: options.extensionVersion,
        developerMode: getStatus(),
        latestSnapshot: snapshots.at(-1) ?? null,
        snapshotDiff: compareLatestSnapshots(),
        navigation,
        network,
        logs,
      },
      { ...limits, allowedOrigins: allowedNetworkOrigins },
    );
  }

  function clearSnapshots() {
    snapshots = [];
  }

  return Object.freeze({
    enable,
    disable,
    isEnabled: () => enabled,
    getStatus,
    discover,
    captureSnapshot,
    compareLatestSnapshots,
    recordRoute,
    recordNetwork,
    recordLog,
    exportDiagnostics,
    clearSnapshots,
  });
}
