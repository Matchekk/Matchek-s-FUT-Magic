import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "./errors.js";
import { calculateFc26SquadRating } from "../../sbc/solver/rating.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeBoundedString,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./schema.js";

export const PROJECT_OPTIMIZATION_CONTRACT = "project_optimization.v1";
export const PROJECT_OPTIMIZATION_STATUS = Object.freeze(["complete", "partial", "infeasible"]);
export const PROJECT_CANDIDATE_LOCATIONS = Object.freeze([
  "club", "sbc_storage", "unassigned",
]);
export const PROJECT_CANDIDATE_TRADABILITY = Object.freeze([
  "tradable", "untradeable", "unknown",
]);
export const PROJECT_SPECIAL_CLASSES = Object.freeze([
  "totw", "tots", "evolution", "icon", "hero", "promo",
]);
export const PROJECT_OPTIMIZATION_REASON_CODES = Object.freeze([
  "coverage_complete",
  "coverage_gap",
  "lower_local_cost",
  "prefer_duplicate",
  "prefer_sbc_storage",
  "prefer_untradeable",
  "preserve_future_flexibility",
  "preserve_scarce_special",
  "no_feasible_allocation",
]);
export const PROJECT_OPTIMIZATION_WARNING_CODES = Object.freeze([
  "best_effort_not_proven_optimal",
  "input_near_contract_limit",
  "provider_degraded",
]);
export const PROJECT_OPTIMIZATION_OPTIMALITY_STATES = Object.freeze([
  "globally_optimal", "best_found", "infeasible",
]);
export const PROJECT_OPTIMIZATION_LIMITS = Object.freeze({
  maxBytes: 512_000,
  maxDepth: 10,
  maxObjectKeys: 24,
  maxCandidates: 5_000,
  maxProjects: 100,
  maxRequirements: 500,
  maxSpecialRequirementsPerSquad: 8,
  maxReasonCodes: 8,
  maxWarnings: 16,
  maxObjectiveFields: 12,
  maxHandleLength: 80,
  maxFingerprintLength: 128,
  maxModelVersionLength: 64,
  maxTtlMs: 5 * 60_000,
  maxLocalCost: 1_000_000_000,
});

const fail = (code, message, path, details = null) => {
  throw new ProContractError(code, message, { path, details });
};

const invalid = (message, path, details = null) =>
  fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, message, path, details);

const assertRootJson = (value, path) => assertPlainJson(value, {
  path,
  maxBytes: PROJECT_OPTIMIZATION_LIMITS.maxBytes,
  maxDepth: PROJECT_OPTIMIZATION_LIMITS.maxDepth,
  maxArrayLength: PROJECT_OPTIMIZATION_LIMITS.maxCandidates,
  maxObjectKeys: PROJECT_OPTIMIZATION_LIMITS.maxObjectKeys,
});

const booleanAt = (value, path) => {
  if (typeof value !== "boolean") invalid("Expected a boolean", path);
  return value;
};

const nullableHandle = (value, prefix, path) => {
  if (value === null) return null;
  return handleAt(value, prefix, path);
};

const handleAt = (value, prefix, path) => {
  const handle = normalizeSafeId(value, {
    path,
    maxLength: PROJECT_OPTIMIZATION_LIMITS.maxHandleLength,
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

const validateEnvelope = (value, { path, response = false }) => {
  assertExactKeys(value, {
    required: response
      ? ["schemaVersion", "contract", "requestId", "requestFingerprint", "expiresAt"]
      : ["schemaVersion", "contract", "requestId", "fingerprint", "createdAt", "expiresAt"],
    optional: [],
    path,
  });
  assertSchemaVersion(value.schemaVersion, { path: `${path}.schemaVersion` });
  const contract = normalizeEnum(
    value.contract,
    [PROJECT_OPTIMIZATION_CONTRACT],
    { path: `${path}.contract` },
  );
  const requestId = normalizeSafeId(value.requestId, {
    path: `${path}.requestId`, maxLength: PROJECT_OPTIMIZATION_LIMITS.maxHandleLength,
  });
  const expiresAt = timestampAt(value.expiresAt, `${path}.expiresAt`);
  if (response) {
    return {
      schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
      contract,
      requestId,
      requestFingerprint: normalizeBoundedString(value.requestFingerprint, {
        path: `${path}.requestFingerprint`,
        maxLength: PROJECT_OPTIMIZATION_LIMITS.maxFingerprintLength,
        allowEmpty: false,
      }),
      expiresAt,
    };
  }
  const createdAt = timestampAt(value.createdAt, `${path}.createdAt`);
  if (expiresAt <= createdAt || expiresAt - createdAt > PROJECT_OPTIMIZATION_LIMITS.maxTtlMs) {
    invalid("Request expiry must be after creation and within the v1 TTL", `${path}.expiresAt`);
  }
  return {
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    contract,
    requestId,
    fingerprint: normalizeBoundedString(value.fingerprint, {
      path: `${path}.fingerprint`,
      maxLength: PROJECT_OPTIMIZATION_LIMITS.maxFingerprintLength,
      allowEmpty: false,
    }),
    createdAt,
    expiresAt,
  };
};

const normalizeSpecialClasses = (value, path) => normalizeStringArray(value, {
  path,
  allowed: PROJECT_SPECIAL_CLASSES,
  maxItems: PROJECT_SPECIAL_CLASSES.length,
  maxItemLength: 24,
  sort: true,
  unique: true,
});

const normalizeReasonCodes = (value, path) => normalizeStringArray(value, {
  path,
  allowed: PROJECT_OPTIMIZATION_REASON_CODES,
  maxItems: PROJECT_OPTIMIZATION_LIMITS.maxReasonCodes,
  maxItemLength: 48,
  sort: true,
  unique: true,
});

const validateSpecialRequirement = (value, path) => {
  assertExactKeys(value, { required: ["specialClass", "count"], optional: [], path });
  return {
    specialClass: normalizeEnum(value.specialClass, PROJECT_SPECIAL_CLASSES, {
      path: `${path}.specialClass`,
    }),
    count: normalizeFiniteInteger(value.count, { path: `${path}.count`, min: 1, max: 11 }),
  };
};

const validateRequirement = (value, path) => {
  assertExactKeys(value, {
    required: ["requirementHandle", "squadRating", "squadSize", "specialRequirements"],
    optional: [],
    path,
  });
  if (!Array.isArray(value.specialRequirements) ||
      value.specialRequirements.length > PROJECT_OPTIMIZATION_LIMITS.maxSpecialRequirementsPerSquad) {
    invalid("specialRequirements exceeds the v1 bound", `${path}.specialRequirements`);
  }
  const specialRequirements = value.specialRequirements.map((entry, index) =>
    validateSpecialRequirement(entry, `${path}.specialRequirements[${index}]`));
  unique(specialRequirements.map((entry) => entry.specialClass), `${path}.specialRequirements`);
  if (specialRequirements.reduce((sum, entry) => sum + entry.count, 0) > 11) {
    invalid("Special requirements cannot exceed the squad size", `${path}.specialRequirements`);
  }
  return {
    requirementHandle: handleAt(value.requirementHandle, "req_", `${path}.requirementHandle`),
    squadRating: normalizeFiniteInteger(value.squadRating, {
      path: `${path}.squadRating`, min: 1, max: 99,
    }),
    squadSize: normalizeFiniteInteger(value.squadSize, {
      path: `${path}.squadSize`, min: 11, max: 11,
    }),
    specialRequirements,
  };
};

const validateProject = (value, path) => {
  assertExactKeys(value, {
    required: ["projectHandle", "priority", "unknownRequirementCount", "requirements"],
    optional: [],
    path,
  });
  const unknownRequirementCount = normalizeFiniteInteger(value.unknownRequirementCount, {
    path: `${path}.unknownRequirementCount`, min: 0, max: 0,
  });
  if (!Array.isArray(value.requirements) ||
      value.requirements.length > PROJECT_OPTIMIZATION_LIMITS.maxRequirements) {
    invalid("requirements exceeds the v1 bound", `${path}.requirements`);
  }
  if (value.requirements.length === 0) invalid("Project requires at least one known requirement", `${path}.requirements`);
  const requirements = value.requirements.map((entry, index) =>
    validateRequirement(entry, `${path}.requirements[${index}]`));
  unique(requirements.map((entry) => entry.requirementHandle), `${path}.requirements`);
  return {
    projectHandle: handleAt(value.projectHandle, "prj_", `${path}.projectHandle`),
    priority: normalizeFiniteInteger(value.priority, { path: `${path}.priority`, min: 0, max: 100 }),
    unknownRequirementCount,
    requirements,
  };
};

const validateCandidate = (value, path) => {
  assertExactKeys(value, {
    required: [
      "itemHandle", "playerGroupHandle", "versionGroupHandle", "eligibility", "rating",
      "location", "tradability", "duplicate", "specialClasses", "localCost",
      "eligibleRequirementHandles",
    ],
    optional: [],
    path,
  });
  if (!Array.isArray(value.eligibleRequirementHandles) ||
      value.eligibleRequirementHandles.length > PROJECT_OPTIMIZATION_LIMITS.maxRequirements) {
    invalid("eligibleRequirementHandles exceeds the v1 bound", `${path}.eligibleRequirementHandles`);
  }
  const eligibleRequirementHandles = value.eligibleRequirementHandles.map((entry, index) =>
    handleAt(entry, "req_", `${path}.eligibleRequirementHandles[${index}]`));
  unique(eligibleRequirementHandles, `${path}.eligibleRequirementHandles`);
  return {
    itemHandle: handleAt(value.itemHandle, "itm_", `${path}.itemHandle`),
    playerGroupHandle: nullableHandle(value.playerGroupHandle, "ply_", `${path}.playerGroupHandle`),
    versionGroupHandle: nullableHandle(value.versionGroupHandle, "ver_", `${path}.versionGroupHandle`),
    eligibility: normalizeEnum(value.eligibility, ["verified_eligible"], {
      path: `${path}.eligibility`,
    }),
    rating: normalizeFiniteInteger(value.rating, { path: `${path}.rating`, min: 1, max: 99 }),
    location: normalizeEnum(value.location, PROJECT_CANDIDATE_LOCATIONS, {
      path: `${path}.location`,
    }),
    tradability: normalizeEnum(value.tradability, PROJECT_CANDIDATE_TRADABILITY, {
      path: `${path}.tradability`,
    }),
    duplicate: booleanAt(value.duplicate, `${path}.duplicate`),
    specialClasses: normalizeSpecialClasses(value.specialClasses, `${path}.specialClasses`),
    localCost: normalizeFiniteInteger(value.localCost, {
      path: `${path}.localCost`, min: 0, max: PROJECT_OPTIMIZATION_LIMITS.maxLocalCost,
    }),
    eligibleRequirementHandles,
  };
};

export const validateProjectOptimizationRequest = (value) => {
  assertRootJson(value, "$projectOptimizationRequest");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "fingerprint", "createdAt", "expiresAt",
      "gameVersion", "candidates", "projects",
    ],
    optional: [],
    path: "$projectOptimizationRequest",
  });
  const envelope = validateEnvelope({
    schemaVersion: value.schemaVersion,
    contract: value.contract,
    requestId: value.requestId,
    fingerprint: value.fingerprint,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  }, { path: "$projectOptimizationRequest.envelope" });
  if (!Array.isArray(value.candidates) ||
      value.candidates.length > PROJECT_OPTIMIZATION_LIMITS.maxCandidates) {
    invalid("candidates exceeds the v1 bound", "$projectOptimizationRequest.candidates");
  }
  if (!Array.isArray(value.projects) || value.projects.length === 0 ||
      value.projects.length > PROJECT_OPTIMIZATION_LIMITS.maxProjects) {
    invalid("projects must be non-empty and within the v1 bound", "$projectOptimizationRequest.projects");
  }
  const projects = value.projects.map((entry, index) =>
    validateProject(entry, `$projectOptimizationRequest.projects[${index}]`));
  unique(projects.map((entry) => entry.projectHandle), "$projectOptimizationRequest.projects");
  const requirementHandles = unique(
    projects.flatMap((project) => project.requirements.map((entry) => entry.requirementHandle)),
    "$projectOptimizationRequest.projects.requirements",
  );
  const candidates = value.candidates.map((entry, index) =>
    validateCandidate(entry, `$projectOptimizationRequest.candidates[${index}]`));
  unique(candidates.map((entry) => entry.itemHandle), "$projectOptimizationRequest.candidates");
  for (const candidate of candidates) {
    for (const handle of candidate.eligibleRequirementHandles) {
      if (!requirementHandles.has(handle)) {
        fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Candidate references a foreign requirement handle", "$projectOptimizationRequest.candidates", { handle });
      }
    }
  }
  return cloneAndFreezeContract({
    ...envelope,
    gameVersion: normalizeEnum(value.gameVersion, ["fc26"], {
      path: "$projectOptimizationRequest.gameVersion",
    }),
    candidates,
    projects,
  });
};

const validateAllocation = (value, path) => {
  assertExactKeys(value, {
    required: ["projectHandle", "requirementHandle", "candidateHandles", "reasonCodes"],
    optional: [],
    path,
  });
  if (!Array.isArray(value.candidateHandles) || value.candidateHandles.length !== 11) {
    invalid("An allocation must contain exactly 11 candidate handles", `${path}.candidateHandles`);
  }
  const candidateHandles = value.candidateHandles.map((entry, index) =>
    handleAt(entry, "itm_", `${path}.candidateHandles[${index}]`));
  unique(candidateHandles, `${path}.candidateHandles`);
  return {
    projectHandle: handleAt(value.projectHandle, "prj_", `${path}.projectHandle`),
    requirementHandle: handleAt(value.requirementHandle, "req_", `${path}.requirementHandle`),
    candidateHandles,
    reasonCodes: normalizeReasonCodes(value.reasonCodes, `${path}.reasonCodes`),
  };
};

const validateGap = (value, path) => {
  assertExactKeys(value, {
    required: ["projectHandle", "requirementHandle", "missingCandidateCount", "reasonCodes"],
    optional: [],
    path,
  });
  return {
    projectHandle: handleAt(value.projectHandle, "prj_", `${path}.projectHandle`),
    requirementHandle: handleAt(value.requirementHandle, "req_", `${path}.requirementHandle`),
    missingCandidateCount: normalizeFiniteInteger(value.missingCandidateCount, {
      path: `${path}.missingCandidateCount`, min: 1, max: 11,
    }),
    reasonCodes: normalizeReasonCodes(value.reasonCodes, `${path}.reasonCodes`),
  };
};

const validateOptimality = (value, path) => {
  assertExactKeys(value, {
    required: ["state", "evaluatedAllocationCount", "objectiveTuple"], optional: [], path,
  });
  if (!Array.isArray(value.objectiveTuple) ||
      value.objectiveTuple.length > PROJECT_OPTIMIZATION_LIMITS.maxObjectiveFields) {
    invalid("objectiveTuple exceeds the v1 bound", `${path}.objectiveTuple`);
  }
  return {
    state: normalizeEnum(value.state, PROJECT_OPTIMIZATION_OPTIMALITY_STATES, {
      path: `${path}.state`,
    }),
    evaluatedAllocationCount: normalizeFiniteInteger(value.evaluatedAllocationCount, {
      path: `${path}.evaluatedAllocationCount`, min: 0, max: 1_000_000_000,
    }),
    objectiveTuple: value.objectiveTuple.map((entry, index) =>
      normalizeFiniteInteger(entry, {
        path: `${path}.objectiveTuple[${index}]`, min: 0, max: 1_000_000_000,
      })),
  };
};

const usedHandleSet = (value) => {
  if (value == null) return new Set();
  if (value instanceof Set) return new Set([...value].map(String));
  if (Array.isArray(value)) return new Set(value.map(String));
  invalid("usedHandles must be a Set or array", "$projectOptimizationResponse.usedHandles");
};

export const validateProjectOptimizationResponse = (
  value,
  { request, now = Date.now(), usedHandles = null } = {},
) => {
  const normalizedRequest = validateProjectOptimizationRequest(request);
  assertRootJson(value, "$projectOptimizationResponse");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "requestFingerprint", "expiresAt",
      "status", "modelVersion", "optimality", "allocations", "coverageGaps", "reasonCodes", "warningCodes",
    ],
    optional: [],
    path: "$projectOptimizationResponse",
  });
  const envelope = validateEnvelope({
    schemaVersion: value.schemaVersion,
    contract: value.contract,
    requestId: value.requestId,
    requestFingerprint: value.requestFingerprint,
    expiresAt: value.expiresAt,
  }, { path: "$projectOptimizationResponse.envelope", response: true });
  if (envelope.contract !== normalizedRequest.contract ||
      envelope.requestId !== normalizedRequest.requestId ||
      envelope.requestFingerprint !== normalizedRequest.fingerprint) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH, "Response does not match its request", "$projectOptimizationResponse");
  }
  const currentTime = timestampAt(now, "$projectOptimizationResponse.now");
  if (envelope.expiresAt > normalizedRequest.expiresAt ||
      envelope.expiresAt <= normalizedRequest.createdAt ||
      envelope.expiresAt <= currentTime) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED, "Response is expired or outlives its request", "$projectOptimizationResponse.expiresAt");
  }
  const status = normalizeEnum(value.status, PROJECT_OPTIMIZATION_STATUS, {
    path: "$projectOptimizationResponse.status",
  });
  if (!Array.isArray(value.allocations) || value.allocations.length > PROJECT_OPTIMIZATION_LIMITS.maxRequirements) {
    invalid("allocations exceeds the v1 bound", "$projectOptimizationResponse.allocations");
  }
  if (!Array.isArray(value.coverageGaps) || value.coverageGaps.length > PROJECT_OPTIMIZATION_LIMITS.maxRequirements) {
    invalid("coverageGaps exceeds the v1 bound", "$projectOptimizationResponse.coverageGaps");
  }
  const allocations = value.allocations.map((entry, index) =>
    validateAllocation(entry, `$projectOptimizationResponse.allocations[${index}]`));
  const coverageGaps = value.coverageGaps.map((entry, index) =>
    validateGap(entry, `$projectOptimizationResponse.coverageGaps[${index}]`));
  if (status === "complete" && (allocations.length === 0 || coverageGaps.length !== 0)) {
    invalid("A complete response requires allocations and no coverage gaps", "$projectOptimizationResponse.status");
  }
  if (status === "partial" && (allocations.length === 0 || coverageGaps.length === 0)) {
    invalid("A partial response requires allocations and coverage gaps", "$projectOptimizationResponse.status");
  }
  if (status === "infeasible" && (allocations.length !== 0 || coverageGaps.length === 0)) {
    invalid("An infeasible response requires no allocations and at least one coverage gap", "$projectOptimizationResponse.status");
  }
  const projectByHandle = new Map(normalizedRequest.projects.map((entry) => [entry.projectHandle, entry]));
  const requirementByHandle = new Map(normalizedRequest.projects.flatMap((project) =>
    project.requirements.map((requirement) => [requirement.requirementHandle, { project, requirement }])));
  const candidateByHandle = new Map(normalizedRequest.candidates.map((entry) => [entry.itemHandle, entry]));
  const responseRequirementHandles = unique(
    [...allocations, ...coverageGaps].map((entry) => entry.requirementHandle),
    "$projectOptimizationResponse.requirements",
  );
  const responseCandidateHandles = unique(
    allocations.flatMap((entry) => entry.candidateHandles),
    "$projectOptimizationResponse.allocations.candidateHandles",
  );
  const previouslyUsed = usedHandleSet(usedHandles);
  const optimality = validateOptimality(value.optimality, "$projectOptimizationResponse.optimality");
  if ((status === "infeasible") !== (optimality.state === "infeasible")) {
    invalid("Optimality state does not match response status", "$projectOptimizationResponse.optimality.state");
  }
  if (status !== "complete" && optimality.state === "globally_optimal") {
    invalid("Only a complete proposal may claim global optimality", "$projectOptimizationResponse.optimality.state");
  }
  for (const entry of [...allocations, ...coverageGaps]) {
    const requirementEntry = requirementByHandle.get(entry.requirementHandle);
    if (!projectByHandle.has(entry.projectHandle) || !requirementEntry ||
        requirementEntry.project.projectHandle !== entry.projectHandle) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response references a foreign project or requirement handle", "$projectOptimizationResponse", { handle: entry.requirementHandle });
    }
  }
  for (const handle of responseCandidateHandles) {
    const candidate = candidateByHandle.get(handle);
    if (!candidate) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response references a foreign candidate handle", "$projectOptimizationResponse", { handle });
    }
    if (previouslyUsed.has(handle)) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Response reuses a consumed candidate handle", "$projectOptimizationResponse", { handle });
    }
    const allocation = allocations.find((entry) => entry.candidateHandles.includes(handle));
    if (!candidate.eligibleRequirementHandles.includes(allocation.requirementHandle)) {
      fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Candidate was not locally eligible for the proposed requirement", "$projectOptimizationResponse.allocations", { handle });
    }
  }
  for (const allocation of allocations) {
    const requirement = requirementByHandle.get(allocation.requirementHandle).requirement;
    const selected = allocation.candidateHandles.map((handle) => candidateByHandle.get(handle));
    const playerGroups = selected
      .map((candidate) => candidate.playerGroupHandle)
      .filter((handle) => handle !== null);
    if (new Set(playerGroups).size !== playerGroups.length) {
      fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Proposal selects the same footballer more than once", "$projectOptimizationResponse.allocations", { requirementHandle: allocation.requirementHandle });
    }
    if (calculateFc26SquadRating(selected.map((candidate) => candidate.rating)) < requirement.squadRating) {
      fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Proposal does not meet the requested FC26 squad rating", "$projectOptimizationResponse.allocations", { requirementHandle: allocation.requirementHandle });
    }
    for (const specialRequirement of requirement.specialRequirements) {
      const observed = selected.filter((candidate) =>
        candidate.specialClasses.includes(specialRequirement.specialClass)).length;
      if (observed < specialRequirement.count) {
        fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Proposal does not meet a requested special-class count", "$projectOptimizationResponse.allocations", { requirementHandle: allocation.requirementHandle, specialClass: specialRequirement.specialClass });
      }
    }
  }
  if (responseRequirementHandles.size !== requirementByHandle.size) {
    invalid("Response must account for every request requirement exactly once", "$projectOptimizationResponse");
  }
  void responseRequirementHandles;
  return cloneAndFreezeContract({
    ...envelope,
    status,
    modelVersion: normalizeBoundedString(value.modelVersion, {
      path: "$projectOptimizationResponse.modelVersion",
      maxLength: PROJECT_OPTIMIZATION_LIMITS.maxModelVersionLength,
      allowEmpty: false,
    }),
    optimality,
    allocations,
    coverageGaps,
    reasonCodes: normalizeReasonCodes(value.reasonCodes, "$projectOptimizationResponse.reasonCodes"),
    warningCodes: normalizeStringArray(value.warningCodes, {
      path: "$projectOptimizationResponse.warningCodes",
      allowed: PROJECT_OPTIMIZATION_WARNING_CODES,
      maxItems: PROJECT_OPTIMIZATION_LIMITS.maxWarnings,
      maxItemLength: 48,
      sort: true,
      unique: true,
    }),
  });
};
