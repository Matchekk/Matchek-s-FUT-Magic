import { DEV_LIMITS, jsonByteLength, resolveDevLimits } from "./limits.js";
import { sanitizeDiagnosticValue, truncateDiagnosticString } from "./redaction.js";

function finiteTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function normalizeMember(member) {
  if (!member || typeof member !== "object") return null;
  const kind = member.kind === "accessor" ? "accessor" : "method";
  const normalized = {
    name: truncateDiagnosticString(member.name || "unknown", 160),
    kind,
  };
  if (kind === "method") {
    normalized.arity = Number.isFinite(Number(member.arity))
      ? Math.max(0, Math.floor(Number(member.arity)))
      : 0;
  } else {
    normalized.getter = !!member.getter;
    normalized.setter = !!member.setter;
  }
  return normalized;
}

function normalizeMembers(members, limit) {
  return (Array.isArray(members) ? members : [])
    .slice(0, limit)
    .map(normalizeMember)
    .filter(Boolean)
    .sort((a, b) => `${a.name}:${a.kind}`.localeCompare(`${b.name}:${b.kind}`));
}

function normalizeClasses(classes, limits) {
  return (Array.isArray(classes) ? classes : [])
    .slice(0, limits.maxClasses)
    .map((entry) => ({
      name: truncateDiagnosticString(entry?.name || "unknown", 160),
      prototypeMembers: normalizeMembers(
        entry?.prototypeMembers,
        limits.maxMethodsPerClass,
      ),
      staticMembers: normalizeMembers(entry?.staticMembers, limits.maxMethodsPerClass),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeCapabilities(capabilities, limits) {
  return (Array.isArray(capabilities) ? capabilities : [])
    .slice(0, limits.maxCapabilities)
    .map((entry, index) => ({
      id: truncateDiagnosticString(entry?.id || `capability-${index + 1}`, 160),
      path: (Array.isArray(entry?.path) ? entry.path : [])
        .slice(0, 16)
        .map((part) => truncateDiagnosticString(part, 100)),
      available: !!entry?.available,
      reason: entry?.reason ? truncateDiagnosticString(entry.reason, 80) : null,
      valueType: truncateDiagnosticString(entry?.valueType || "undefined", 40),
      expectedType: entry?.expectedType
        ? truncateDiagnosticString(entry.expectedType, 40)
        : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function trimSnapshotToByteLimit(snapshot, maxBytes) {
  const result = snapshot;
  while (jsonByteLength(result) > maxBytes && result.classes.length > 0) {
    result.classes.pop();
    result.truncated.classes = true;
    result.truncated.bytes = true;
  }
  while (jsonByteLength(result) > maxBytes && result.capabilities.length > 0) {
    result.capabilities.pop();
    result.truncated.capabilities = true;
    result.truncated.bytes = true;
  }
  if (jsonByteLength(result) > maxBytes) {
    result.bridgeHealth = null;
    result.selectors = null;
    result.route = null;
    result.truncated.bytes = true;
  }
  return result;
}

/**
 * Builds a deterministic, JSON-only snapshot from previously discovered data.
 * `capturedAt` is supplied by the caller so the function remains pure.
 */
export function createWebAppSnapshot(input = {}, options = {}) {
  const limits = resolveDevLimits(options);
  const sourceClasses = Array.isArray(input.classes) ? input.classes : [];
  const sourceCapabilities = Array.isArray(input.capabilities)
    ? input.capabilities
    : [];
  const snapshot = {
    schemaVersion: 1,
    capturedAt: finiteTimestamp(input.capturedAt),
    extensionVersion: truncateDiagnosticString(input.extensionVersion || "unknown", 80),
    webAppVersion: truncateDiagnosticString(input.webAppVersion || "unknown", 120),
    classes: normalizeClasses(sourceClasses, limits),
    capabilities: normalizeCapabilities(sourceCapabilities, limits),
    bridgeHealth: sanitizeDiagnosticValue(input.bridgeHealth ?? null, {
      maxDepth: 4,
      maxItems: 50,
      maxKeys: 50,
      maxStringLength: 500,
    }),
    selectors: sanitizeDiagnosticValue(input.selectors ?? null, {
      maxDepth: 3,
      maxItems: 50,
      maxKeys: 50,
      maxStringLength: 300,
    }),
    route: sanitizeDiagnosticValue(input.route ?? null, {
      maxDepth: 3,
      maxItems: 20,
      maxKeys: 20,
      maxStringLength: 500,
    }),
    truncated: {
      classes: sourceClasses.length > limits.maxClasses,
      capabilities: sourceCapabilities.length > limits.maxCapabilities,
      bytes: false,
    },
  };
  return trimSnapshotToByteLimit(snapshot, limits.maxSnapshotBytes);
}

function memberIdentity(member) {
  if (!member || typeof member !== "object") return null;
  return member.kind === "accessor"
    ? `${member.name}:accessor:${member.getter ? 1 : 0}:${member.setter ? 1 : 0}`
    : `${member.name}:method:${member.arity}`;
}

function difference(left, right) {
  const filteredLeft = left.filter(Boolean);
  const rightSet = new Set(right.filter(Boolean));
  return filteredLeft.filter((value) => !rightSet.has(value));
}

function classMap(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.classes) ? snapshot.classes : []).map((entry) => [
      String(entry.name),
      entry,
    ]),
  );
}

function capabilityMap(snapshot) {
  return new Map(
    (Array.isArray(snapshot?.capabilities) ? snapshot.capabilities : []).map((entry) => [
      String(entry.id),
      entry,
    ]),
  );
}

function comparableCapability(entry) {
  return JSON.stringify({
    available: !!entry?.available,
    reason: entry?.reason ?? null,
    valueType: entry?.valueType ?? "undefined",
    expectedType: entry?.expectedType ?? null,
  });
}

/** Pure, scope-aware comparison of two snapshots. */
export function diffWebAppSnapshots(previous = {}, current = {}, options = {}) {
  const limits = resolveDevLimits(options);
  const beforeClasses = classMap(previous);
  const afterClasses = classMap(current);
  const allClassNames = [...new Set([...beforeClasses.keys(), ...afterClasses.keys()])].sort();
  const addedClasses = [];
  const removedClasses = [];
  const changedClasses = [];

  for (const name of allClassNames) {
    const before = beforeClasses.get(name);
    const after = afterClasses.get(name);
    if (!before) {
      addedClasses.push(name);
      continue;
    }
    if (!after) {
      removedClasses.push(name);
      continue;
    }
    const beforePrototype = (before.prototypeMembers || []).map(memberIdentity);
    const afterPrototype = (after.prototypeMembers || []).map(memberIdentity);
    const beforeStatic = (before.staticMembers || []).map(memberIdentity);
    const afterStatic = (after.staticMembers || []).map(memberIdentity);
    const changes = {
      name,
      prototypeAdded: difference(afterPrototype, beforePrototype),
      prototypeRemoved: difference(beforePrototype, afterPrototype),
      staticAdded: difference(afterStatic, beforeStatic),
      staticRemoved: difference(beforeStatic, afterStatic),
    };
    if (
      changes.prototypeAdded.length ||
      changes.prototypeRemoved.length ||
      changes.staticAdded.length ||
      changes.staticRemoved.length
    ) {
      changedClasses.push(changes);
    }
  }

  const beforeCapabilities = capabilityMap(previous);
  const afterCapabilities = capabilityMap(current);
  const capabilityChanges = [];
  for (const id of [...new Set([...beforeCapabilities.keys(), ...afterCapabilities.keys()])].sort()) {
    const before = beforeCapabilities.get(id) ?? null;
    const after = afterCapabilities.get(id) ?? null;
    if (!before || !after || comparableCapability(before) !== comparableCapability(after)) {
      capabilityChanges.push({
        id,
        before: before
          ? { available: !!before.available, reason: before.reason ?? null, valueType: before.valueType }
          : null,
        after: after
          ? { available: !!after.available, reason: after.reason ?? null, valueType: after.valueType }
          : null,
      });
    }
  }

  const totals = {
    addedClasses: addedClasses.length,
    removedClasses: removedClasses.length,
    changedClasses: changedClasses.length,
    capabilityChanges: capabilityChanges.length,
  };
  let remaining = limits.maxDiffItems;
  const take = (values) => {
    const result = values.slice(0, remaining);
    remaining -= result.length;
    return result;
  };
  const result = {
    schemaVersion: 1,
    previousCapturedAt: finiteTimestamp(previous?.capturedAt),
    currentCapturedAt: finiteTimestamp(current?.capturedAt),
    addedClasses: take(addedClasses),
    removedClasses: take(removedClasses),
    changedClasses: take(changedClasses),
    capabilityChanges: take(capabilityChanges),
    totals,
    truncated:
      totals.addedClasses +
        totals.removedClasses +
        totals.changedClasses +
        totals.capabilityChanges >
      limits.maxDiffItems,
  };

  while (jsonByteLength(result) > limits.maxSnapshotBytes && result.changedClasses.length) {
    result.changedClasses.pop();
    result.truncated = true;
  }
  while (jsonByteLength(result) > limits.maxSnapshotBytes && result.capabilityChanges.length) {
    result.capabilityChanges.pop();
    result.truncated = true;
  }
  while (jsonByteLength(result) > limits.maxSnapshotBytes && result.addedClasses.length) {
    result.addedClasses.pop();
    result.truncated = true;
  }
  while (jsonByteLength(result) > limits.maxSnapshotBytes && result.removedClasses.length) {
    result.removedClasses.pop();
    result.truncated = true;
  }
  return result;
}

/** Returns a new FIFO history constrained by both item count and total bytes. */
export function appendBoundedSnapshot(history, snapshot, options = {}) {
  const limits = resolveDevLimits(options);
  const next = [...(Array.isArray(history) ? history : []), snapshot].slice(
    -limits.maxSnapshots,
  );
  while (
    next.length > 0 &&
    next.reduce((total, entry) => total + jsonByteLength(entry), 0) >
      limits.maxSnapshotHistoryBytes
  ) {
    next.shift();
  }
  return next;
}

export const DEFAULT_SNAPSHOT_LIMITS = Object.freeze({
  maxSnapshots: DEV_LIMITS.maxSnapshots,
  maxSnapshotBytes: DEV_LIMITS.maxSnapshotBytes,
  maxSnapshotHistoryBytes: DEV_LIMITS.maxSnapshotHistoryBytes,
});
