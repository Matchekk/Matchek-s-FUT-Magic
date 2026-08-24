import { DEV_LIMITS, resolveDevLimits } from "./limits.js";
import { truncateDiagnosticString } from "./redaction.js";

const UT_CLASS_PATTERN = /^UT[A-Z][A-Za-z0-9_$]*$/;
const STATIC_IGNORES = new Set([
  "arguments",
  "caller",
  "length",
  "name",
  "prototype",
]);

function safeOwnPropertyNames(value) {
  try {
    return Object.getOwnPropertyNames(value);
  } catch {
    return [];
  }
}

function safeDescriptor(value, key) {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function describeMembers(target, ignoredNames, maxItems) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return [];
  }

  const members = [];
  for (const name of safeOwnPropertyNames(target).sort()) {
    if (ignoredNames.has(name)) continue;
    const descriptor = safeDescriptor(target, name);
    if (!descriptor) continue;

    if (typeof descriptor.value === "function") {
      members.push({
        name: truncateDiagnosticString(name, 160),
        kind: "method",
        arity: Math.max(0, Math.floor(descriptor.value.length || 0)),
      });
    } else if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      members.push({
        name: truncateDiagnosticString(name, 160),
        kind: "accessor",
        getter: typeof descriptor.get === "function",
        setter: typeof descriptor.set === "function",
      });
    }

    if (members.length >= maxItems) break;
  }
  return members;
}

function getDataDescriptorValue(target, key) {
  const descriptor = safeDescriptor(target, key);
  if (!descriptor || !("value" in descriptor)) {
    return { ok: false, accessor: !!descriptor };
  }
  return { ok: true, value: descriptor.value };
}

/**
 * Performs an on-demand, read-only scan. It never invokes getters and never
 * replaces constructors, methods or browser prototypes.
 */
export function discoverUTClasses(root = globalThis, options = {}) {
  const limits = resolveDevLimits(options);
  const matchingNames = safeOwnPropertyNames(root)
    .filter((name) => UT_CLASS_PATTERN.test(name))
    .sort();
  const classes = [];

  for (const name of matchingNames.slice(0, limits.maxClasses)) {
    const rootValue = getDataDescriptorValue(root, name);
    if (!rootValue.ok || typeof rootValue.value !== "function") continue;
    const constructor = rootValue.value;
    const prototypeValue = getDataDescriptorValue(constructor, "prototype");

    classes.push({
      name,
      prototypeMembers: prototypeValue.ok
        ? describeMembers(
            prototypeValue.value,
            new Set(["constructor"]),
            limits.maxMethodsPerClass,
          )
        : [],
      staticMembers: describeMembers(
        constructor,
        STATIC_IGNORES,
        limits.maxMethodsPerClass,
      ),
    });
  }

  return {
    classes,
    totalMatchingGlobals: matchingNames.length,
    truncated: matchingNames.length > limits.maxClasses,
  };
}

function normalizeCapabilityPath(path) {
  const parts = Array.isArray(path) ? path : String(path || "").split(".");
  return parts
    .map((part) => String(part).trim())
    .filter(Boolean)
    .slice(0, 16);
}

function inspectPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (current === null || (typeof current !== "object" && typeof current !== "function")) {
      return { available: false, reason: "parent_missing", valueType: "undefined" };
    }
    const descriptor = safeDescriptor(current, segment);
    if (!descriptor) {
      return { available: false, reason: "missing", valueType: "undefined" };
    }
    if (!("value" in descriptor)) {
      return { available: false, reason: "accessor_blocked", valueType: "accessor" };
    }
    current = descriptor.value;
  }
  return { available: true, reason: null, valueType: typeof current };
}

/**
 * Checks explicitly supplied capability paths using descriptors only. A
 * capability definition is `{ id, path, expectedType? }`.
 */
export function discoverCapabilities(root = globalThis, definitions = [], options = {}) {
  const limits = resolveDevLimits(options);
  const normalizedDefinitions = Array.isArray(definitions)
    ? definitions.slice(0, limits.maxCapabilities)
    : [];

  return normalizedDefinitions
    .map((definition, index) => {
      const path = normalizeCapabilityPath(definition?.path);
      const id = truncateDiagnosticString(
        definition?.id || path.join(".") || `capability-${index + 1}`,
        160,
      );
      if (path.length === 0) {
        return { id, path: [], available: false, reason: "invalid_path", valueType: "undefined" };
      }
      const inspected = inspectPath(root, path);
      const expectedType = definition?.expectedType
        ? truncateDiagnosticString(definition.expectedType, 40)
        : null;
      const matchesExpectedType =
        !expectedType || (inspected.available && inspected.valueType === expectedType);
      return {
        id,
        path,
        available: inspected.available && matchesExpectedType,
        reason: matchesExpectedType ? inspected.reason : "type_mismatch",
        valueType: inspected.valueType,
        expectedType,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const DEFAULT_DISCOVERY_LIMITS = Object.freeze({
  maxClasses: DEV_LIMITS.maxClasses,
  maxMethodsPerClass: DEV_LIMITS.maxMethodsPerClass,
  maxCapabilities: DEV_LIMITS.maxCapabilities,
});
