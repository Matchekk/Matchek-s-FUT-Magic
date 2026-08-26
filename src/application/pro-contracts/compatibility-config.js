import {
  CapabilityState,
} from "../capability-registry.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  isPlainObject,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./schema.js";

export const COMPATIBILITY_CONFIG_STATUS = Object.freeze({
  READY: "ready",
  CACHED: "cached",
});

export const COMPATIBILITY_CONFIG_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
export const COMPATIBILITY_CONFIG_MAX_OVERRIDES = 128;

const GAME_VERSIONS = Object.freeze(["fc26", "fc27"]);
const DOWNGRADE_STATES = Object.freeze([
  CapabilityState.DEGRADED,
  CapabilityState.UNVERIFIED,
  CapabilityState.UNAVAILABLE,
]);
const REASON_CODES = Object.freeze([
  "ea_update",
  "feature_disabled",
  "fresh_evidence_required",
  "minimum_client_version",
  "unsupported_game_version",
]);
const STATE_RANK = Object.freeze({
  [CapabilityState.AVAILABLE]: 0,
  [CapabilityState.DEGRADED]: 1,
  [CapabilityState.UNVERIFIED]: 2,
  [CapabilityState.UNAVAILABLE]: 3,
});

const fail = (message, path, code = PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID) => {
  throw new ProContractError(code, message, { path });
};

const normalizeSemanticVersion = (value, path) => {
  const normalized = normalizeSafeId(value, { path, maxLength: 64 });
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(normalized)) {
    fail("Expected a semantic client version", path);
  }
  return normalized;
};

const compareSemanticVersions = (left, right) => {
  const numbers = (value) => value.split("-", 1)[0].split(".").map(Number);
  const a = numbers(left);
  const b = numbers(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  const leftPrerelease = left.includes("-");
  const rightPrerelease = right.includes("-");
  if (leftPrerelease !== rightPrerelease) return leftPrerelease ? -1 : 1;
  if (!leftPrerelease) return 0;
  const leftIdentifiers = left.slice(left.indexOf("-") + 1).split(".");
  const rightIdentifiers = right.slice(right.indexOf("-") + 1).split(".");
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier == null) return -1;
    if (rightIdentifier == null) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftNumeric) {
      const leftValue = leftIdentifier.replace(/^0+(?=\d)/, "");
      const rightValue = rightIdentifier.replace(/^0+(?=\d)/, "");
      if (leftValue.length !== rightValue.length) return leftValue.length - rightValue.length;
      if (leftValue === rightValue) continue;
      return leftValue < rightValue ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
};

const normalizeCapabilityDowngrade = (input, index) => {
  const path = `$compatibilityConfig.capabilityDowngrades[${index}]`;
  assertExactKeys(input, {
    required: ["capabilityId", "state", "reasonCode"],
    path,
  });
  return {
    capabilityId: normalizeSafeId(input.capabilityId, {
      path: `${path}.capabilityId`,
    }),
    state: normalizeEnum(input.state, DOWNGRADE_STATES, {
      path: `${path}.state`,
    }),
    reasonCode: normalizeEnum(input.reasonCode, REASON_CODES, {
      path: `${path}.reasonCode`,
    }),
  };
};

const normalizeLimitCap = (input, index) => {
  const path = `$compatibilityConfig.limitCaps[${index}]`;
  assertExactKeys(input, { required: ["limitId", "maximum"], path });
  return {
    limitId: normalizeSafeId(input.limitId, { path: `${path}.limitId` }),
    maximum: normalizeFiniteInteger(input.maximum, {
      path: `${path}.maximum`, min: 0, max: 1_000_000,
    }),
  };
};

/** Normalize signed/versioned compatibility data after transport verification. */
export const normalizeCompatibilityConfig = (input, { now = Date.now() } = {}) => {
  assertPlainJson(input, {
    path: "$compatibilityConfig",
    maxArrayLength: COMPATIBILITY_CONFIG_MAX_OVERRIDES,
  });
  assertExactKeys(input, {
    required: [
      "schemaVersion",
      "status",
      "configVersion",
      "issuedAt",
      "expiresAt",
      "gameVersions",
      "minimumClientVersion",
      "capabilityDowngrades",
      "limitCaps",
    ],
    path: "$compatibilityConfig",
  });
  assertSchemaVersion(input.schemaVersion, {
    path: "$compatibilityConfig.schemaVersion",
  });
  const currentTime = normalizeFiniteInteger(now, { path: "$now", min: 0 });
  const issuedAt = normalizeFiniteInteger(input.issuedAt, {
    path: "$compatibilityConfig.issuedAt", min: 0,
  });
  const expiresAt = normalizeFiniteInteger(input.expiresAt, {
    path: "$compatibilityConfig.expiresAt", min: 0,
  });
  if (issuedAt > currentTime) {
    fail("Compatibility config issue time is in the future", "$compatibilityConfig.issuedAt");
  }
  if (expiresAt <= issuedAt || expiresAt <= currentTime) {
    fail(
      "Compatibility config expiry has elapsed or does not follow its issue time",
      "$compatibilityConfig.expiresAt",
      PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED,
    );
  }
  if (expiresAt - issuedAt > COMPATIBILITY_CONFIG_MAX_VALIDITY_MS) {
    fail("Compatibility config validity exceeds its bounded expiry", "$compatibilityConfig.expiresAt");
  }
  if (!Array.isArray(input.capabilityDowngrades) ||
      input.capabilityDowngrades.length > COMPATIBILITY_CONFIG_MAX_OVERRIDES) {
    fail("Compatibility config exceeds its capability override limit", "$compatibilityConfig.capabilityDowngrades");
  }
  if (!Array.isArray(input.limitCaps) || input.limitCaps.length > COMPATIBILITY_CONFIG_MAX_OVERRIDES) {
    fail("Compatibility config exceeds its limit cap count", "$compatibilityConfig.limitCaps");
  }
  const capabilityDowngrades = input.capabilityDowngrades.map(
    normalizeCapabilityDowngrade,
  );
  const capabilityIds = capabilityDowngrades.map((entry) => entry.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail("Capability downgrade IDs must be unique", "$compatibilityConfig.capabilityDowngrades");
  }
  capabilityDowngrades.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const limitCaps = input.limitCaps.map(normalizeLimitCap);
  const limitIds = limitCaps.map((entry) => entry.limitId);
  if (new Set(limitIds).size !== limitIds.length) {
    fail("Compatibility limit IDs must be unique", "$compatibilityConfig.limitCaps");
  }
  limitCaps.sort((left, right) => left.limitId.localeCompare(right.limitId));

  return cloneAndFreezeContract({
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    status: normalizeEnum(input.status, Object.values(COMPATIBILITY_CONFIG_STATUS), {
      path: "$compatibilityConfig.status",
    }),
    configVersion: normalizeSafeId(input.configVersion, {
      path: "$compatibilityConfig.configVersion",
    }),
    issuedAt,
    expiresAt,
    gameVersions: normalizeStringArray(input.gameVersions, {
      path: "$compatibilityConfig.gameVersions",
      allowed: GAME_VERSIONS,
      maxItems: GAME_VERSIONS.length,
      sort: true,
    }),
    minimumClientVersion: normalizeSemanticVersion(
      input.minimumClientVersion,
      "$compatibilityConfig.minimumClientVersion",
    ),
    capabilityDowngrades,
    limitCaps,
  });
};

const registryRecords = (registry) => {
  const snapshot = typeof registry?.snapshot === "function" ? registry.snapshot() : registry;
  if (!isPlainObject(snapshot) || !Array.isArray(snapshot.capabilities)) {
    throw new TypeError("registry must be a CapabilityRegistry or capability snapshot");
  }
  return snapshot.capabilities.map((record, index) => {
    if (!isPlainObject(record)) throw new TypeError(`registry capability ${index} must be an object`);
    const state = normalizeEnum(record.state, Object.values(CapabilityState), {
      path: `$registry.capabilities[${index}].state`,
    });
    return {
      id: normalizeSafeId(record.id, { path: `$registry.capabilities[${index}].id` }),
      state,
      reason: record.reason == null ? null : String(record.reason),
      observedAt: record.observedAt == null ? null : normalizeFiniteInteger(record.observedAt, {
        path: `$registry.capabilities[${index}].observedAt`, min: 0,
      }),
      revision: normalizeFiniteInteger(record.revision ?? 0, {
        path: `$registry.capabilities[${index}].revision`, min: 0,
      }),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
};

const lowerState = (current, requested) =>
  STATE_RANK[requested] > STATE_RANK[current] ? requested : current;

const normalizeLocalLimits = (value) => {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new TypeError("localLimits must be a plain object");
  return Object.fromEntries(Object.entries(value)
    .map(([id, maximum]) => [
      normalizeSafeId(id, { path: `$localLimits.${id}` }),
      normalizeFiniteInteger(maximum, { path: `$localLimits.${id}`, min: 0, max: 1_000_000 }),
    ])
    .sort(([left], [right]) => left.localeCompare(right)));
};

/**
 * Intersect local capability evidence and local ceilings with remote policy.
 * The returned snapshot is pure data; the supplied registry is never mutated.
 */
export const applyCompatibilityConfig = ({
  registry,
  config,
  gameVersion,
  clientVersion,
  localLimits = {},
  now = Date.now(),
}) => {
  const records = registryRecords(registry);
  const normalizedGameVersion = normalizeEnum(gameVersion, GAME_VERSIONS, {
    path: "$gameVersion",
  });
  const normalizedClientVersion = normalizeSemanticVersion(clientVersion, "$clientVersion");
  const limits = normalizeLocalLimits(localLimits);
  const normalizedConfig = normalizeCompatibilityConfig(config, { now });
  const appliesToGame = normalizedConfig.gameVersions.includes(normalizedGameVersion);
  const requiresClientUpdate = appliesToGame && compareSemanticVersions(
    normalizedClientVersion,
    normalizedConfig.minimumClientVersion,
  ) < 0;
  const localIds = new Set(records.map((record) => record.id));
  const downgradeById = new Map(
    (appliesToGame ? normalizedConfig.capabilityDowngrades : [])
      .filter((entry) => localIds.has(entry.capabilityId))
      .map((entry) => [entry.capabilityId, entry]),
  );
  const ignoredCapabilityIds = (appliesToGame ? normalizedConfig.capabilityDowngrades : [])
    .map((entry) => entry.capabilityId)
    .filter((id) => !localIds.has(id))
    .sort();

  const capabilities = records.map((record) => {
    let state = record.state;
    let reason = record.reason;
    let compatibilityReasonCode = null;
    if (requiresClientUpdate) {
      state = CapabilityState.UNAVAILABLE;
      reason = "A newer FUT Magic version is required";
      compatibilityReasonCode = "minimum_client_version";
    } else if (normalizedGameVersion === "fc27") {
      const lowered = lowerState(state, CapabilityState.UNVERIFIED);
      if (lowered !== state) {
        state = lowered;
        reason = "FC27 behavior is unverified";
        compatibilityReasonCode = "unsupported_game_version";
      }
    }
    const downgrade = downgradeById.get(record.id);
    if (downgrade) {
      const lowered = lowerState(state, downgrade.state);
      if (lowered !== state) {
        state = lowered;
        reason = `Compatibility config: ${downgrade.reasonCode}`;
        compatibilityReasonCode = downgrade.reasonCode;
      }
    }
    return { ...record, state, reason, compatibilityReasonCode };
  });

  const capById = new Map(
    (appliesToGame ? normalizedConfig.limitCaps : []).map((entry) => [entry.limitId, entry.maximum]),
  );
  for (const id of Object.keys(limits)) {
    if (capById.has(id)) limits[id] = Math.min(limits[id], capById.get(id));
  }
  const ignoredLimitIds = (appliesToGame ? normalizedConfig.limitCaps : [])
    .map((entry) => entry.limitId)
    .filter((id) => !Object.hasOwn(limits, id))
    .sort();

  return cloneAndFreezeContract({
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    status: normalizedConfig.status,
    configVersion: normalizedConfig.configVersion,
    gameVersion: normalizedGameVersion,
    clientVersion: normalizedClientVersion,
    applied: appliesToGame,
    requiresClientUpdate,
    capabilities,
    limits,
    ignoredCapabilityIds,
    ignoredLimitIds,
  });
};
