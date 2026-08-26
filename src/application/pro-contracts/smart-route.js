import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "./errors.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeBoolean,
  normalizeBoundedString,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./schema.js";

export const SMART_ROUTE_CONTRACT = "smart_route.v1";
export const SMART_ROUTE_STATUS = Object.freeze(["proposal", "no_proposal"]);
export const SMART_ROUTE_ACTION_KINDS = Object.freeze([
  "move_to_club",
  "move_to_sbc_storage",
  "hold_for_review",
  "candidate_for_known_recipe",
  "no_action",
]);
export const SMART_ROUTE_REASON_CODES = Object.freeze([
  "verified_club_destination",
  "verified_storage_destination",
  "duplicate_pressure",
  "project_reserve",
  "scarce_special",
  "tradable_opportunity_cost",
  "known_recipe_candidate",
  "no_verified_destination",
  "manual_review_required",
]);
export const SMART_ROUTE_WARNING_CODES = Object.freeze([
  "input_near_contract_limit",
  "provider_degraded",
  "recommendations_incomplete",
]);
export const SMART_ROUTE_LOCATIONS = Object.freeze([
  "club", "sbc_storage", "unassigned",
]);
export const SMART_ROUTE_TRADABILITY = Object.freeze([
  "tradable", "untradeable", "unknown",
]);
export const SMART_ROUTE_SPECIAL_CLASSES = Object.freeze([
  "totw", "tots", "evolution", "icon", "hero", "promo",
]);
export const SMART_ROUTE_DESTINATION_STATES = Object.freeze([
  "verified_available", "verified_unavailable", "unverified",
]);
export const SMART_ROUTE_LIMITS = Object.freeze({
  maxBytes: 256_000,
  maxDepth: 9,
  maxObjectKeys: 24,
  maxCandidates: 100,
  maxKnownRecipesPerCandidate: 32,
  maxProjectDemandSignals: 100,
  maxReasonCodes: 8,
  maxWarnings: 16,
  maxHandleLength: 80,
  maxFingerprintLength: 128,
  maxModelVersionLength: 64,
  maxTtlMs: 2 * 60_000,
  maxLocalCost: 1_000_000_000,
});

const fail = (code, message, path, details = null) => {
  throw new ProContractError(code, message, { path, details });
};

const invalid = (message, path, details = null) =>
  fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, message, path, details);

const assertRootJson = (value, path) => assertPlainJson(value, {
  path,
  maxBytes: SMART_ROUTE_LIMITS.maxBytes,
  maxDepth: SMART_ROUTE_LIMITS.maxDepth,
  maxArrayLength: SMART_ROUTE_LIMITS.maxCandidates,
  maxObjectKeys: SMART_ROUTE_LIMITS.maxObjectKeys,
});

const handleAt = (value, prefix, path) => {
  const handle = normalizeSafeId(value, {
    path, maxLength: SMART_ROUTE_LIMITS.maxHandleLength,
  });
  if (!handle.startsWith(prefix) || handle.length <= prefix.length) {
    invalid(`Expected a request-local ${prefix} handle`, path);
  }
  return handle;
};

const unique = (values, path) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) invalid("Duplicate handle", path, { handle: value });
    seen.add(value);
  }
  return seen;
};

const timestampAt = (value, path) => normalizeFiniteInteger(value, {
  path, min: 0, max: Number.MAX_SAFE_INTEGER,
});

const normalizeSpecialClasses = (value, path) => normalizeStringArray(value, {
  path,
  allowed: SMART_ROUTE_SPECIAL_CLASSES,
  maxItems: SMART_ROUTE_SPECIAL_CLASSES.length,
  maxItemLength: 24,
  sort: true,
  unique: true,
});

const normalizeReasonCodes = (value, path) => normalizeStringArray(value, {
  path,
  allowed: SMART_ROUTE_REASON_CODES,
  maxItems: SMART_ROUTE_LIMITS.maxReasonCodes,
  maxItemLength: 48,
  sort: true,
  unique: true,
});

const normalizeEnvelope = (value, { path, response = false }) => {
  assertExactKeys(value, {
    required: response
      ? ["schemaVersion", "contract", "requestId", "requestFingerprint", "expiresAt"]
      : ["schemaVersion", "contract", "requestId", "fingerprint", "createdAt", "expiresAt"],
    optional: [],
    path,
  });
  assertSchemaVersion(value.schemaVersion, { path: `${path}.schemaVersion` });
  const contract = normalizeEnum(value.contract, [SMART_ROUTE_CONTRACT], {
    path: `${path}.contract`,
  });
  const requestId = normalizeSafeId(value.requestId, {
    path: `${path}.requestId`, maxLength: SMART_ROUTE_LIMITS.maxHandleLength,
  });
  const expiresAt = timestampAt(value.expiresAt, `${path}.expiresAt`);
  if (response) {
    return {
      schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
      contract,
      requestId,
      requestFingerprint: normalizeBoundedString(value.requestFingerprint, {
        path: `${path}.requestFingerprint`,
        maxLength: SMART_ROUTE_LIMITS.maxFingerprintLength,
        allowEmpty: false,
      }),
      expiresAt,
    };
  }
  const createdAt = timestampAt(value.createdAt, `${path}.createdAt`);
  if (expiresAt <= createdAt || expiresAt - createdAt > SMART_ROUTE_LIMITS.maxTtlMs) {
    invalid("Request expiry must be after creation and within the v1 TTL", `${path}.expiresAt`);
  }
  return {
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    contract,
    requestId,
    fingerprint: normalizeBoundedString(value.fingerprint, {
      path: `${path}.fingerprint`,
      maxLength: SMART_ROUTE_LIMITS.maxFingerprintLength,
      allowEmpty: false,
    }),
    createdAt,
    expiresAt,
  };
};

const validateCandidate = (value, path) => {
  assertExactKeys(value, {
    required: [
      "itemHandle", "eligibility", "rating", "location", "tradability", "duplicate",
      "specialClasses", "localCost", "clubMove", "storageMove", "knownRecipeHandles",
    ],
    optional: [],
    path,
  });
  if (!Array.isArray(value.knownRecipeHandles) ||
      value.knownRecipeHandles.length > SMART_ROUTE_LIMITS.maxKnownRecipesPerCandidate) {
    invalid("knownRecipeHandles exceeds the v1 bound", `${path}.knownRecipeHandles`);
  }
  const knownRecipeHandles = value.knownRecipeHandles.map((entry, index) =>
    handleAt(entry, "rcp_", `${path}.knownRecipeHandles[${index}]`));
  unique(knownRecipeHandles, `${path}.knownRecipeHandles`);
  const duplicate = normalizeBoolean(value.duplicate, { path: `${path}.duplicate` });
  if (!duplicate) invalid("Smart Route v1 accepts only current duplicate candidates", `${path}.duplicate`);
  return {
    itemHandle: handleAt(value.itemHandle, "itm_", `${path}.itemHandle`),
    eligibility: normalizeEnum(value.eligibility, ["verified_eligible"], {
      path: `${path}.eligibility`,
    }),
    rating: normalizeFiniteInteger(value.rating, { path: `${path}.rating`, min: 1, max: 99 }),
    location: normalizeEnum(value.location, SMART_ROUTE_LOCATIONS, {
      path: `${path}.location`,
    }),
    tradability: normalizeEnum(value.tradability, SMART_ROUTE_TRADABILITY, {
      path: `${path}.tradability`,
    }),
    duplicate,
    specialClasses: normalizeSpecialClasses(value.specialClasses, `${path}.specialClasses`),
    localCost: normalizeFiniteInteger(value.localCost, {
      path: `${path}.localCost`, min: 0, max: SMART_ROUTE_LIMITS.maxLocalCost,
    }),
    clubMove: normalizeEnum(value.clubMove, SMART_ROUTE_DESTINATION_STATES, {
      path: `${path}.clubMove`,
    }),
    storageMove: normalizeEnum(value.storageMove, SMART_ROUTE_DESTINATION_STATES, {
      path: `${path}.storageMove`,
    }),
    knownRecipeHandles,
  };
};

const validateProjectDemand = (value, path) => {
  assertExactKeys(value, {
    required: ["rating", "count", "priority", "specialClass"], optional: [], path,
  });
  return {
    rating: normalizeFiniteInteger(value.rating, { path: `${path}.rating`, min: 1, max: 99 }),
    count: normalizeFiniteInteger(value.count, { path: `${path}.count`, min: 1, max: 500 }),
    priority: normalizeFiniteInteger(value.priority, { path: `${path}.priority`, min: 0, max: 100 }),
    specialClass: value.specialClass === null
      ? null
      : normalizeEnum(value.specialClass, SMART_ROUTE_SPECIAL_CLASSES, {
          path: `${path}.specialClass`,
        }),
  };
};

export const validateSmartRouteRequest = (value) => {
  assertRootJson(value, "$smartRouteRequest");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "fingerprint", "createdAt", "expiresAt",
      "gameVersion", "storage", "supportedActionKinds", "candidates", "projectDemand",
    ],
    optional: [],
    path: "$smartRouteRequest",
  });
  const envelope = normalizeEnvelope({
    schemaVersion: value.schemaVersion,
    contract: value.contract,
    requestId: value.requestId,
    fingerprint: value.fingerprint,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  }, { path: "$smartRouteRequest.envelope" });
  assertExactKeys(value.storage, {
    required: ["state", "remainingCapacity"], optional: [], path: "$smartRouteRequest.storage",
  });
  const storage = {
    state: normalizeEnum(value.storage.state, ["verified"], {
      path: "$smartRouteRequest.storage.state",
    }),
    remainingCapacity: normalizeFiniteInteger(value.storage.remainingCapacity, {
      path: "$smartRouteRequest.storage.remainingCapacity", min: 0, max: 100,
    }),
  };
  const supportedActionKinds = normalizeStringArray(value.supportedActionKinds, {
    path: "$smartRouteRequest.supportedActionKinds",
    allowed: SMART_ROUTE_ACTION_KINDS,
    maxItems: SMART_ROUTE_ACTION_KINDS.length,
    maxItemLength: 48,
    sort: true,
    unique: true,
  });
  if (supportedActionKinds.length === 0) {
    invalid("At least one locally supported proposal kind is required", "$smartRouteRequest.supportedActionKinds");
  }
  if (!Array.isArray(value.candidates) || value.candidates.length === 0 ||
      value.candidates.length > SMART_ROUTE_LIMITS.maxCandidates) {
    invalid("candidates must be non-empty and within the v1 bound", "$smartRouteRequest.candidates");
  }
  const candidates = value.candidates.map((entry, index) =>
    validateCandidate(entry, `$smartRouteRequest.candidates[${index}]`));
  unique(candidates.map((entry) => entry.itemHandle), "$smartRouteRequest.candidates");
  if (!Array.isArray(value.projectDemand) ||
      value.projectDemand.length > SMART_ROUTE_LIMITS.maxProjectDemandSignals) {
    invalid("projectDemand exceeds the v1 bound", "$smartRouteRequest.projectDemand");
  }
  const projectDemand = value.projectDemand.map((entry, index) =>
    validateProjectDemand(entry, `$smartRouteRequest.projectDemand[${index}]`));
  return cloneAndFreezeContract({
    ...envelope,
    gameVersion: normalizeEnum(value.gameVersion, ["fc26"], {
      path: "$smartRouteRequest.gameVersion",
    }),
    storage,
    supportedActionKinds,
    candidates,
    projectDemand,
  });
};

const validateRecommendation = (value, path) => {
  assertExactKeys(value, {
    required: ["itemHandle", "kind", "recipeHandle", "rank", "reasonCodes"],
    optional: [],
    path,
  });
  const kind = normalizeEnum(value.kind, SMART_ROUTE_ACTION_KINDS, { path: `${path}.kind` });
  const recipeHandle = value.recipeHandle === null
    ? null
    : handleAt(value.recipeHandle, "rcp_", `${path}.recipeHandle`);
  if ((kind === "candidate_for_known_recipe") !== (recipeHandle !== null)) {
    invalid("recipeHandle is required only for a known-recipe proposal", `${path}.recipeHandle`);
  }
  return {
    itemHandle: handleAt(value.itemHandle, "itm_", `${path}.itemHandle`),
    kind,
    recipeHandle,
    rank: normalizeFiniteInteger(value.rank, { path: `${path}.rank`, min: 1, max: SMART_ROUTE_LIMITS.maxCandidates }),
    reasonCodes: normalizeReasonCodes(value.reasonCodes, `${path}.reasonCodes`),
  };
};

const usedHandleSet = (value) => {
  if (value == null) return new Set();
  if (value instanceof Set) return new Set([...value].map(String));
  if (Array.isArray(value)) return new Set(value.map(String));
  invalid("usedHandles must be a Set or array", "$smartRouteResponse.usedHandles");
};

export const validateSmartRouteResponse = (
  value,
  { request, now = Date.now(), usedHandles = null } = {},
) => {
  const normalizedRequest = validateSmartRouteRequest(request);
  assertRootJson(value, "$smartRouteResponse");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "requestFingerprint", "expiresAt",
      "status", "modelVersion", "recommendations", "reasonCodes", "warningCodes",
    ],
    optional: [],
    path: "$smartRouteResponse",
  });
  const envelope = normalizeEnvelope({
    schemaVersion: value.schemaVersion,
    contract: value.contract,
    requestId: value.requestId,
    requestFingerprint: value.requestFingerprint,
    expiresAt: value.expiresAt,
  }, { path: "$smartRouteResponse.envelope", response: true });
  if (envelope.contract !== normalizedRequest.contract ||
      envelope.requestId !== normalizedRequest.requestId ||
      envelope.requestFingerprint !== normalizedRequest.fingerprint) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH, "Response does not match its request", "$smartRouteResponse");
  }
  const currentTime = timestampAt(now, "$smartRouteResponse.now");
  if (envelope.expiresAt > normalizedRequest.expiresAt ||
      envelope.expiresAt <= normalizedRequest.createdAt ||
      envelope.expiresAt <= currentTime) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED, "Response is expired or outlives its request", "$smartRouteResponse.expiresAt");
  }
  const status = normalizeEnum(value.status, SMART_ROUTE_STATUS, {
    path: "$smartRouteResponse.status",
  });
  if (!Array.isArray(value.recommendations) ||
      value.recommendations.length > normalizedRequest.candidates.length) {
    invalid("recommendations exceeds the candidate bound", "$smartRouteResponse.recommendations");
  }
  if (status === "no_proposal" && value.recommendations.length !== 0) {
    invalid("A no_proposal response cannot include recommendations", "$smartRouteResponse.recommendations");
  }
  if (status === "proposal" && value.recommendations.length === 0) {
    invalid("A proposal response requires at least one recommendation", "$smartRouteResponse.recommendations");
  }
  const recommendations = value.recommendations.map((entry, index) =>
    validateRecommendation(entry, `$smartRouteResponse.recommendations[${index}]`));
  unique(recommendations.map((entry) => entry.itemHandle), "$smartRouteResponse.recommendations");
  unique(recommendations.map((entry) => String(entry.rank)), "$smartRouteResponse.recommendations.rank");
  const candidateByHandle = new Map(normalizedRequest.candidates.map((entry) => [entry.itemHandle, entry]));
  const previouslyUsed = usedHandleSet(usedHandles);
  let storageMoveCount = 0;
  for (const recommendation of recommendations) {
    const candidate = candidateByHandle.get(recommendation.itemHandle);
    if (!candidate) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response references a foreign candidate handle", "$smartRouteResponse.recommendations", { handle: recommendation.itemHandle });
    }
    if (previouslyUsed.has(recommendation.itemHandle)) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response reuses a consumed candidate handle", "$smartRouteResponse.recommendations", { handle: recommendation.itemHandle });
    }
    if (!normalizedRequest.supportedActionKinds.includes(recommendation.kind)) {
      fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Proposal kind is not locally supported for this request", "$smartRouteResponse.recommendations", { kind: recommendation.kind });
    }
    if (recommendation.kind === "move_to_club" && candidate.clubMove !== "verified_available") {
      fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Club destination was not locally verified", "$smartRouteResponse.recommendations", { handle: recommendation.itemHandle });
    }
    if (recommendation.kind === "move_to_sbc_storage") {
      if (candidate.storageMove !== "verified_available") {
        fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Storage destination was not locally verified", "$smartRouteResponse.recommendations", { handle: recommendation.itemHandle });
      }
      storageMoveCount += 1;
    }
    if (recommendation.kind === "candidate_for_known_recipe" &&
        !candidate.knownRecipeHandles.includes(recommendation.recipeHandle)) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response references a foreign recipe handle", "$smartRouteResponse.recommendations", { handle: recommendation.recipeHandle });
    }
  }
  if (storageMoveCount > normalizedRequest.storage.remainingCapacity) {
    fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Storage proposals exceed verified remaining capacity", "$smartRouteResponse.recommendations");
  }
  return cloneAndFreezeContract({
    ...envelope,
    status,
    modelVersion: normalizeBoundedString(value.modelVersion, {
      path: "$smartRouteResponse.modelVersion",
      maxLength: SMART_ROUTE_LIMITS.maxModelVersionLength,
      allowEmpty: false,
    }),
    recommendations,
    reasonCodes: normalizeReasonCodes(value.reasonCodes, "$smartRouteResponse.reasonCodes"),
    warningCodes: normalizeStringArray(value.warningCodes, {
      path: "$smartRouteResponse.warningCodes",
      allowed: SMART_ROUTE_WARNING_CODES,
      maxItems: SMART_ROUTE_LIMITS.maxWarnings,
      maxItemLength: 48,
      sort: true,
      unique: true,
    }),
  });
};
