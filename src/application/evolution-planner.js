import { cloneAndFreeze, stableFingerprint, stableStringify } from "./immutable.js";

export const EVOLUTION_PLAN_KIND = "EVOLUTION_GRAPH_PLAN_V1";
export const EVOLUTION_PLAN_SCHEMA_VERSION = 1;

export const EVOLUTION_PLANNER_LIMITS = Object.freeze({
  maxDepth: 4,
  maxNodes: 256,
  maxEdges: 128,
  maxEdgeEvaluations: 10_000,
  maxAlternatives: 16,
  maxCollectionSize: 32,
});

export const EVOLUTION_PLANNER_HARD_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 2_000,
  maxEdges: 512,
  maxEdgeEvaluations: 50_000,
  maxAlternatives: 64,
  maxCollectionSize: 64,
});

export const EvolutionAttribute = Object.freeze({
  PACE: "pace",
  SHOOTING: "shooting",
  PASSING: "passing",
  DRIBBLING: "dribbling",
  DEFENDING: "defending",
  PHYSICAL: "physical",
});

export const EvolutionPosition = Object.freeze([
  "GK", "RB", "RWB", "CB", "LB", "LWB", "CDM", "CM", "CAM",
  "RM", "RW", "LM", "LW", "CF", "ST",
]);

export const EvolutionObjectiveDimension = Object.freeze({
  OVERALL: "OVERALL",
  PACE: "PACE",
  SHOOTING: "SHOOTING",
  PASSING: "PASSING",
  DRIBBLING: "DRIBBLING",
  DEFENDING: "DEFENDING",
  PHYSICAL: "PHYSICAL",
  POSITION_MATCHES: "POSITION_MATCHES",
  ROLE_MATCHES: "ROLE_MATCHES",
  PLAYSTYLE_MATCHES: "PLAYSTYLE_MATCHES",
  PLAYSTYLE_PLUS_MATCHES: "PLAYSTYLE_PLUS_MATCHES",
  ELIGIBILITY_TAG_MATCHES: "ELIGIBILITY_TAG_MATCHES",
  PATH_LENGTH: "PATH_LENGTH",
});

export const EvolutionObjectiveDirection = Object.freeze({
  MAXIMIZE: "MAXIMIZE",
  MINIMIZE: "MINIMIZE",
});

export const EvolutionTransformOperation = Object.freeze({
  ADD_CAPPED: "ADD_CAPPED",
  SET: "SET",
  MAX: "MAX",
});

export const EvolutionSearchStatus = Object.freeze({
  COMPLETE_WITHIN_BOUNDS: "COMPLETE_WITHIN_BOUNDS",
  NO_VERIFIED_PATH: "NO_VERIFIED_PATH",
  BOUNDED: "BOUNDED",
});

export const EvolutionBoundReason = Object.freeze({
  DEPTH_BOUND_REACHED: "DEPTH_BOUND_REACHED",
  NODE_BOUND_REACHED: "NODE_BOUND_REACHED",
  EDGE_EVALUATION_BOUND_REACHED: "EDGE_EVALUATION_BOUND_REACHED",
  ALTERNATIVE_BOUND_REACHED: "ALTERNATIVE_BOUND_REACHED",
});

export const EvolutionExplanationCode = Object.freeze({
  STARTING_STATE: "STARTING_STATE",
  VERIFIED_EDGE_APPLIED: "VERIFIED_EDGE_APPLIED",
  OVERALL_CHANGED: "OVERALL_CHANGED",
  ATTRIBUTE_CHANGED: "ATTRIBUTE_CHANGED",
  POSITION_ADDED: "POSITION_ADDED",
  ROLE_ADDED: "ROLE_ADDED",
  PLAYSTYLE_ADDED: "PLAYSTYLE_ADDED",
  PLAYSTYLE_PLUS_ADDED: "PLAYSTYLE_PLUS_ADDED",
  RARITY_CHANGED: "RARITY_CHANGED",
  ELIGIBILITY_TAG_CHANGED: "ELIGIBILITY_TAG_CHANGED",
  PARETO_NON_DOMINATED: "PARETO_NON_DOMINATED",
});

export const EvolutionPlannerErrorCode = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  BOUND_EXCEEDED: "BOUND_EXCEEDED",
  UNVERIFIED_EDGE: "UNVERIFIED_EDGE",
  DUPLICATE_EDGE: "DUPLICATE_EDGE",
  INVALID_TRANSFORMATION: "INVALID_TRANSFORMATION",
  INVALID_OBJECTIVE: "INVALID_OBJECTIVE",
});

export class EvolutionPlannerError extends Error {
  constructor(code, message, path = "$evolutionPlanner") {
    super(message);
    this.name = "EvolutionPlannerError";
    this.code = code;
    this.path = path;
  }
}

const ATTRIBUTE_KEYS = Object.freeze(Object.values(EvolutionAttribute));
const POSITION_SET = new Set(EvolutionPosition);
const OBJECTIVE_DIMENSIONS = new Set(Object.values(EvolutionObjectiveDimension));
const DIRECTIONS = new Set(Object.values(EvolutionObjectiveDirection));
const TRANSFORM_OPERATIONS = new Set(Object.values(EvolutionTransformOperation));
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const fail = (code, message, path) => {
  throw new EvolutionPlannerError(code, message, path);
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value, required, path, optional = []) => {
  if (!isPlainObject(value)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Expected a plain object", path);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Symbol keys are not allowed", path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Accessor and hidden fields are not allowed", `${path}.${key}`);
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) {
    if (!allowed.has(key)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, `Unknown field: ${key}`, `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, `Missing field: ${key}`, `${path}.${key}`);
  }
};

const token = (value, path, maxLength = 80) => {
  if (typeof value !== "string") fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Expected a string token", path);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !SAFE_TOKEN.test(normalized)) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Expected a bounded safe token", path);
  }
  return normalized;
};

const integer = (value, { path, min = 0, max = 99 } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, `Expected an integer from ${min} to ${max}`, path);
  }
  return value;
};

const sortedUniqueTokens = (value, path, limit = EVOLUTION_PLANNER_HARD_LIMITS.maxCollectionSize) => {
  if (!Array.isArray(value) || value.length > limit) {
    fail(EvolutionPlannerErrorCode.BOUND_EXCEEDED, `Collection exceeds ${limit} entries`, path);
  }
  const output = value.map((entry, index) => token(entry, `${path}[${index}]`));
  if (new Set(output).size !== output.length) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Collection values must be unique", path);
  }
  return output.sort(compareText);
};

const positions = (value, path) => {
  const output = sortedUniqueTokens(value, path);
  for (const entry of output) {
    if (!POSITION_SET.has(entry)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, `Unknown position: ${entry}`, path);
  }
  return output;
};

const normalizeAttributes = (value, path) => {
  exactKeys(value, ATTRIBUTE_KEYS, path);
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [
    key,
    integer(value[key], { path: `${path}.${key}` }),
  ]));
};

export const normalizeEvolutionPlayerState = (value, path = "$evolutionPlanner.playerState") => {
  exactKeys(value, [
    "overall", "attributes", "positions", "roles", "playstyles", "playstylePlus",
    "rarity", "eligibilityTags", "appliedEvolutions",
  ], path);
  return cloneAndFreeze({
    overall: integer(value.overall, { path: `${path}.overall` }),
    attributes: normalizeAttributes(value.attributes, `${path}.attributes`),
    positions: positions(value.positions, `${path}.positions`),
    roles: sortedUniqueTokens(value.roles, `${path}.roles`),
    playstyles: sortedUniqueTokens(value.playstyles, `${path}.playstyles`),
    playstylePlus: sortedUniqueTokens(value.playstylePlus, `${path}.playstylePlus`),
    rarity: token(value.rarity, `${path}.rarity`),
    eligibilityTags: sortedUniqueTokens(value.eligibilityTags, `${path}.eligibilityTags`),
    appliedEvolutions: sortedUniqueTokens(value.appliedEvolutions, `${path}.appliedEvolutions`),
  });
};

const normalizeAttributeEligibility = (value, path) => {
  if (!Array.isArray(value) || value.length > ATTRIBUTE_KEYS.length) {
    fail(EvolutionPlannerErrorCode.BOUND_EXCEEDED, "Attribute eligibility exceeds its bound", path);
  }
  const output = value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    exactKeys(entry, ["attribute", "min", "max"], entryPath);
    const attribute = token(entry.attribute, `${entryPath}.attribute`);
    if (!ATTRIBUTE_KEYS.includes(attribute)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Unknown attribute", `${entryPath}.attribute`);
    const min = entry.min == null ? null : integer(entry.min, { path: `${entryPath}.min` });
    const max = entry.max == null ? null : integer(entry.max, { path: `${entryPath}.max` });
    if (min == null && max == null) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Attribute gate requires min or max", entryPath);
    if (min != null && max != null && min > max) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Attribute gate min exceeds max", entryPath);
    return { attribute, min, max };
  });
  if (new Set(output.map((entry) => entry.attribute)).size !== output.length) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Attribute gates must be unique", path);
  }
  return output.sort((left, right) => compareText(left.attribute, right.attribute));
};

const normalizeEligibility = (value, path) => {
  const keys = [
    "positionsAnyOf", "positionsAllOf", "rolesAllOf", "playstylesAllOf",
    "playstylePlusAllOf", "raritiesAnyOf", "eligibilityTagsAllOf",
    "excludedEligibilityTags", "overall", "attributes",
  ];
  exactKeys(value, keys, path);
  exactKeys(value.overall, ["min", "max"], `${path}.overall`);
  const overallMin = value.overall.min == null
    ? null
    : integer(value.overall.min, { path: `${path}.overall.min` });
  const overallMax = value.overall.max == null
    ? null
    : integer(value.overall.max, { path: `${path}.overall.max` });
  if (overallMin != null && overallMax != null && overallMin > overallMax) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Overall gate min exceeds max", `${path}.overall`);
  }
  return {
    positionsAnyOf: positions(value.positionsAnyOf, `${path}.positionsAnyOf`),
    positionsAllOf: positions(value.positionsAllOf, `${path}.positionsAllOf`),
    rolesAllOf: sortedUniqueTokens(value.rolesAllOf, `${path}.rolesAllOf`),
    playstylesAllOf: sortedUniqueTokens(value.playstylesAllOf, `${path}.playstylesAllOf`),
    playstylePlusAllOf: sortedUniqueTokens(value.playstylePlusAllOf, `${path}.playstylePlusAllOf`),
    raritiesAnyOf: sortedUniqueTokens(value.raritiesAnyOf, `${path}.raritiesAnyOf`),
    eligibilityTagsAllOf: sortedUniqueTokens(value.eligibilityTagsAllOf, `${path}.eligibilityTagsAllOf`),
    excludedEligibilityTags: sortedUniqueTokens(value.excludedEligibilityTags, `${path}.excludedEligibilityTags`),
    overall: { min: overallMin, max: overallMax },
    attributes: normalizeAttributeEligibility(value.attributes, `${path}.attributes`),
  };
};

const normalizeScalarTransform = (value, path) => {
  if (value == null) return null;
  exactKeys(value, ["operation", "value", "cap"], path);
  const operation = token(value.operation, `${path}.operation`);
  if (!TRANSFORM_OPERATIONS.has(operation)) {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Unknown scalar transform", `${path}.operation`);
  }
  const transformedValue = integer(value.value, { path: `${path}.value` });
  const cap = value.cap == null ? null : integer(value.cap, { path: `${path}.cap` });
  if (operation === EvolutionTransformOperation.ADD_CAPPED && cap == null) {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "ADD_CAPPED requires an explicit cap", `${path}.cap`);
  }
  if (operation !== EvolutionTransformOperation.ADD_CAPPED && cap !== null) {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Only ADD_CAPPED accepts cap", `${path}.cap`);
  }
  return { operation, value: transformedValue, cap };
};

const normalizeAttributeTransforms = (value, path) => {
  if (!Array.isArray(value) || value.length > ATTRIBUTE_KEYS.length) {
    fail(EvolutionPlannerErrorCode.BOUND_EXCEEDED, "Attribute transforms exceed their bound", path);
  }
  const output = value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    exactKeys(entry, ["attribute", "operation", "value", "cap"], entryPath);
    const attribute = token(entry.attribute, `${entryPath}.attribute`);
    if (!ATTRIBUTE_KEYS.includes(attribute)) fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Unknown transformed attribute", `${entryPath}.attribute`);
    const operation = token(entry.operation, `${entryPath}.operation`);
    if (!TRANSFORM_OPERATIONS.has(operation)) fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Unknown attribute transform", `${entryPath}.operation`);
    const transformedValue = integer(entry.value, { path: `${entryPath}.value` });
    const cap = entry.cap == null ? null : integer(entry.cap, { path: `${entryPath}.cap` });
    if (operation === EvolutionTransformOperation.ADD_CAPPED && cap == null) {
      fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "ADD_CAPPED requires an explicit cap", `${entryPath}.cap`);
    }
    if (operation !== EvolutionTransformOperation.ADD_CAPPED && cap !== null) {
      fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Only ADD_CAPPED accepts cap", `${entryPath}.cap`);
    }
    return { attribute, operation, value: transformedValue, cap };
  });
  if (new Set(output.map((entry) => entry.attribute)).size !== output.length) {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Attribute transforms must be unique", path);
  }
  return output.sort((left, right) => compareText(left.attribute, right.attribute));
};

const normalizeTransformation = (value, path) => {
  const keys = [
    "overall", "attributes", "addPositions", "addRoles", "addPlaystyles", "addPlaystylePlus",
    "addEligibilityTags", "removeEligibilityTags", "setRarity",
  ];
  exactKeys(value, keys, path);
  const output = {
    overall: normalizeScalarTransform(value.overall, `${path}.overall`),
    attributes: normalizeAttributeTransforms(value.attributes, `${path}.attributes`),
    addPositions: positions(value.addPositions, `${path}.addPositions`),
    addRoles: sortedUniqueTokens(value.addRoles, `${path}.addRoles`),
    addPlaystyles: sortedUniqueTokens(value.addPlaystyles, `${path}.addPlaystyles`),
    addPlaystylePlus: sortedUniqueTokens(value.addPlaystylePlus, `${path}.addPlaystylePlus`),
    addEligibilityTags: sortedUniqueTokens(value.addEligibilityTags, `${path}.addEligibilityTags`),
    removeEligibilityTags: sortedUniqueTokens(value.removeEligibilityTags, `${path}.removeEligibilityTags`),
    setRarity: value.setRarity == null ? null : token(value.setRarity, `${path}.setRarity`),
  };
  const additions = [
    output.attributes, output.addPositions, output.addRoles, output.addPlaystyles,
    output.addPlaystylePlus, output.addEligibilityTags, output.removeEligibilityTags,
  ].reduce((sum, entries) => sum + entries.length, 0);
  if (additions === 0 && output.overall == null && output.setRarity == null) {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Evolution edge has no transformation", path);
  }
  return output;
};

const normalizeEdge = (value, index) => {
  const path = `$evolutionPlanner.edges[${index}]`;
  exactKeys(value, ["edgeKey", "verification", "eligibility", "transformation"], path);
  exactKeys(value.verification, ["state", "evidenceFingerprint"], `${path}.verification`);
  if (value.verification.state !== "VERIFIED") {
    fail(EvolutionPlannerErrorCode.UNVERIFIED_EDGE, "Only verified evolution edges are accepted", `${path}.verification.state`);
  }
  return {
    edgeKey: token(value.edgeKey, `${path}.edgeKey`),
    verification: {
      state: "VERIFIED",
      evidenceFingerprint: token(value.verification.evidenceFingerprint, `${path}.verification.evidenceFingerprint`, 128),
    },
    eligibility: normalizeEligibility(value.eligibility, `${path}.eligibility`),
    transformation: normalizeTransformation(value.transformation, `${path}.transformation`),
  };
};

const normalizeObjective = (value) => {
  const path = "$evolutionPlanner.objective";
  exactKeys(value, [
    "roleKey", "dimensions", "desiredPositions", "desiredRoles", "desiredPlaystyles",
    "desiredPlaystylePlus", "desiredEligibilityTags",
  ], path);
  if (!Array.isArray(value.dimensions) || value.dimensions.length < 1 ||
      value.dimensions.length > Object.keys(EvolutionObjectiveDimension).length) {
    fail(EvolutionPlannerErrorCode.INVALID_OBJECTIVE, "Objective requires a bounded dimension vector", `${path}.dimensions`);
  }
  const dimensions = value.dimensions.map((entry, index) => {
    const entryPath = `${path}.dimensions[${index}]`;
    exactKeys(entry, ["dimension", "direction"], entryPath);
    if (!OBJECTIVE_DIMENSIONS.has(entry.dimension) || !DIRECTIONS.has(entry.direction)) {
      fail(EvolutionPlannerErrorCode.INVALID_OBJECTIVE, "Unknown objective dimension or direction", entryPath);
    }
    return { dimension: entry.dimension, direction: entry.direction };
  });
  if (new Set(dimensions.map((entry) => entry.dimension)).size !== dimensions.length) {
    fail(EvolutionPlannerErrorCode.INVALID_OBJECTIVE, "Objective dimensions must be unique", `${path}.dimensions`);
  }
  return cloneAndFreeze({
    roleKey: token(value.roleKey, `${path}.roleKey`),
    dimensions,
    desiredPositions: positions(value.desiredPositions, `${path}.desiredPositions`),
    desiredRoles: sortedUniqueTokens(value.desiredRoles, `${path}.desiredRoles`),
    desiredPlaystyles: sortedUniqueTokens(value.desiredPlaystyles, `${path}.desiredPlaystyles`),
    desiredPlaystylePlus: sortedUniqueTokens(value.desiredPlaystylePlus, `${path}.desiredPlaystylePlus`),
    desiredEligibilityTags: sortedUniqueTokens(value.desiredEligibilityTags, `${path}.desiredEligibilityTags`),
  });
};

const normalizeLimits = (value = {}) => {
  if (!isPlainObject(value)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Limits must be an object", "$evolutionPlanner.limits");
  const keys = ["maxDepth", "maxNodes", "maxEdges", "maxEdgeEvaluations", "maxAlternatives"];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, `Unknown limit: ${key}`, `$evolutionPlanner.limits.${key}`);
  }
  const output = {};
  for (const key of keys) {
    output[key] = integer(value[key] ?? EVOLUTION_PLANNER_LIMITS[key], {
      path: `$evolutionPlanner.limits.${key}`,
      min: 1,
      max: EVOLUTION_PLANNER_HARD_LIMITS[key],
    });
  }
  return Object.freeze(output);
};

const containsAll = (actual, required) => {
  const set = new Set(actual);
  return required.every((entry) => set.has(entry));
};

export const EvolutionEligibilityReason = Object.freeze({
  POSITION_ANY_OF_MISSING: "POSITION_ANY_OF_MISSING",
  POSITION_ALL_OF_MISSING: "POSITION_ALL_OF_MISSING",
  ROLE_MISSING: "ROLE_MISSING",
  PLAYSTYLE_MISSING: "PLAYSTYLE_MISSING",
  PLAYSTYLE_PLUS_MISSING: "PLAYSTYLE_PLUS_MISSING",
  RARITY_MISMATCH: "RARITY_MISMATCH",
  ELIGIBILITY_TAG_MISSING: "ELIGIBILITY_TAG_MISSING",
  EXCLUDED_ELIGIBILITY_TAG: "EXCLUDED_ELIGIBILITY_TAG",
  OVERALL_BELOW_MINIMUM: "OVERALL_BELOW_MINIMUM",
  OVERALL_ABOVE_MAXIMUM: "OVERALL_ABOVE_MAXIMUM",
  ATTRIBUTE_BELOW_MINIMUM: "ATTRIBUTE_BELOW_MINIMUM",
  ATTRIBUTE_ABOVE_MAXIMUM: "ATTRIBUTE_ABOVE_MAXIMUM",
  EVOLUTION_ALREADY_APPLIED: "EVOLUTION_ALREADY_APPLIED",
});

const eligibilityReasons = (state, edge, pathHistory = []) => {
  const rule = edge.eligibility;
  const reasons = [];
  if (pathHistory.includes(edge.edgeKey) || state.appliedEvolutions.includes(edge.edgeKey)) {
    reasons.push({ code: EvolutionEligibilityReason.EVOLUTION_ALREADY_APPLIED, field: "edgeKey" });
  }
  if (rule.positionsAnyOf.length && !rule.positionsAnyOf.some((entry) => state.positions.includes(entry))) {
    reasons.push({ code: EvolutionEligibilityReason.POSITION_ANY_OF_MISSING, field: "positions" });
  }
  if (!containsAll(state.positions, rule.positionsAllOf)) reasons.push({ code: EvolutionEligibilityReason.POSITION_ALL_OF_MISSING, field: "positions" });
  if (!containsAll(state.roles, rule.rolesAllOf)) reasons.push({ code: EvolutionEligibilityReason.ROLE_MISSING, field: "roles" });
  if (!containsAll(state.playstyles, rule.playstylesAllOf)) reasons.push({ code: EvolutionEligibilityReason.PLAYSTYLE_MISSING, field: "playstyles" });
  if (!containsAll(state.playstylePlus, rule.playstylePlusAllOf)) reasons.push({ code: EvolutionEligibilityReason.PLAYSTYLE_PLUS_MISSING, field: "playstylePlus" });
  if (rule.raritiesAnyOf.length && !rule.raritiesAnyOf.includes(state.rarity)) reasons.push({ code: EvolutionEligibilityReason.RARITY_MISMATCH, field: "rarity" });
  if (!containsAll(state.eligibilityTags, rule.eligibilityTagsAllOf)) reasons.push({ code: EvolutionEligibilityReason.ELIGIBILITY_TAG_MISSING, field: "eligibilityTags" });
  if (rule.excludedEligibilityTags.some((entry) => state.eligibilityTags.includes(entry))) reasons.push({ code: EvolutionEligibilityReason.EXCLUDED_ELIGIBILITY_TAG, field: "eligibilityTags" });
  if (rule.overall.min != null && state.overall < rule.overall.min) reasons.push({ code: EvolutionEligibilityReason.OVERALL_BELOW_MINIMUM, field: "overall" });
  if (rule.overall.max != null && state.overall > rule.overall.max) reasons.push({ code: EvolutionEligibilityReason.OVERALL_ABOVE_MAXIMUM, field: "overall" });
  for (const entry of rule.attributes) {
    const current = state.attributes[entry.attribute];
    if (entry.min != null && current < entry.min) reasons.push({ code: EvolutionEligibilityReason.ATTRIBUTE_BELOW_MINIMUM, field: entry.attribute });
    if (entry.max != null && current > entry.max) reasons.push({ code: EvolutionEligibilityReason.ATTRIBUTE_ABOVE_MAXIMUM, field: entry.attribute });
  }
  return reasons;
};

const eligibleForEdge = (state, edge) => eligibilityReasons(state, edge).length === 0;

export function evaluateEvolutionEligibility({ playerState, evolution, pathHistory = [] } = {}) {
  if (!Array.isArray(pathHistory) || pathHistory.length > EVOLUTION_PLANNER_HARD_LIMITS.maxDepth) {
    fail(EvolutionPlannerErrorCode.BOUND_EXCEEDED, "Path history exceeds its bound", "$evolutionPlanner.pathHistory");
  }
  const state = normalizeEvolutionPlayerState(playerState);
  const edge = normalizeEdge(evolution, 0);
  const history = sortedUniqueTokens(pathHistory, "$evolutionPlanner.pathHistory");
  const reasons = eligibilityReasons(state, edge, history);
  return cloneAndFreeze({ eligible: reasons.length === 0, reasons });
}

const union = (left, right) => [...new Set([...left, ...right])].sort(compareText);

const transformAttribute = (current, rule) => {
  if (rule.operation === EvolutionTransformOperation.SET) return rule.value;
  if (rule.operation === EvolutionTransformOperation.MAX) return Math.max(current, rule.value);
  return Math.max(current, Math.min(rule.cap, current + rule.value));
};

const applyEdge = (state, edge) => {
  const attributes = { ...state.attributes };
  for (const rule of edge.transformation.attributes) {
    attributes[rule.attribute] = transformAttribute(attributes[rule.attribute], rule);
  }
  const removedTags = new Set(edge.transformation.removeEligibilityTags);
  return normalizeEvolutionPlayerState({
    overall: edge.transformation.overall == null
      ? state.overall
      : transformAttribute(state.overall, edge.transformation.overall),
    attributes,
    positions: union(state.positions, edge.transformation.addPositions),
    roles: union(state.roles, edge.transformation.addRoles),
    playstyles: union(state.playstyles, edge.transformation.addPlaystyles),
    playstylePlus: union(state.playstylePlus, edge.transformation.addPlaystylePlus),
    rarity: edge.transformation.setRarity ?? state.rarity,
    eligibilityTags: union(
      state.eligibilityTags.filter((entry) => !removedTags.has(entry)),
      edge.transformation.addEligibilityTags,
    ),
    appliedEvolutions: union(state.appliedEvolutions, [edge.edgeKey]),
  }, "$evolutionPlanner.transformedState");
};

export function applyEvolution({
  playerState,
  evolution,
  pathHistory = [],
  rulesVersion = "evolution_rules.v1",
} = {}) {
  if (rulesVersion !== "evolution_rules.v1") {
    fail(EvolutionPlannerErrorCode.INVALID_TRANSFORMATION, "Unsupported Evolution rules version", "$evolutionPlanner.rulesVersion");
  }
  const state = normalizeEvolutionPlayerState(playerState);
  const edge = normalizeEdge(evolution, 0);
  const eligibility = evaluateEvolutionEligibility({ playerState: state, evolution, pathHistory });
  if (!eligibility.eligible) {
    fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Evolution is not eligible for this player state", "$evolutionPlanner.evolution");
  }
  return applyEdge(state, edge);
}

const semanticState = (state) => ({
  overall: state.overall,
  attributes: state.attributes,
  positions: state.positions,
  roles: state.roles,
  playstyles: state.playstyles,
  playstylePlus: state.playstylePlus,
  rarity: state.rarity,
  eligibilityTags: state.eligibilityTags,
});

export const fingerprintEvolutionPlayerState = (state) =>
  stableFingerprint(normalizeEvolutionPlayerState(state));

const semanticFingerprint = (state) => stableFingerprint(semanticState(state));

const intersectionCount = (actual, desired) => {
  const wanted = new Set(desired);
  return actual.reduce((count, entry) => count + Number(wanted.has(entry)), 0);
};

const dimensionValue = (dimension, state, pathLength, objective) => {
  const attributes = {
    [EvolutionObjectiveDimension.PACE]: EvolutionAttribute.PACE,
    [EvolutionObjectiveDimension.SHOOTING]: EvolutionAttribute.SHOOTING,
    [EvolutionObjectiveDimension.PASSING]: EvolutionAttribute.PASSING,
    [EvolutionObjectiveDimension.DRIBBLING]: EvolutionAttribute.DRIBBLING,
    [EvolutionObjectiveDimension.DEFENDING]: EvolutionAttribute.DEFENDING,
    [EvolutionObjectiveDimension.PHYSICAL]: EvolutionAttribute.PHYSICAL,
  };
  if (dimension === EvolutionObjectiveDimension.OVERALL) return state.overall;
  if (attributes[dimension]) return state.attributes[attributes[dimension]];
  if (dimension === EvolutionObjectiveDimension.POSITION_MATCHES) return intersectionCount(state.positions, objective.desiredPositions);
  if (dimension === EvolutionObjectiveDimension.ROLE_MATCHES) return intersectionCount(state.roles, objective.desiredRoles);
  if (dimension === EvolutionObjectiveDimension.PLAYSTYLE_MATCHES) return intersectionCount(state.playstyles, objective.desiredPlaystyles);
  if (dimension === EvolutionObjectiveDimension.PLAYSTYLE_PLUS_MATCHES) return intersectionCount(state.playstylePlus, objective.desiredPlaystylePlus);
  if (dimension === EvolutionObjectiveDimension.ELIGIBILITY_TAG_MATCHES) return intersectionCount(state.eligibilityTags, objective.desiredEligibilityTags);
  return pathLength;
};

const objectiveVector = (node, objective) => objective.dimensions.map((entry) => ({
  dimension: entry.dimension,
  direction: entry.direction,
  value: dimensionValue(entry.dimension, node.state, node.path.length, objective),
}));

const dominates = (left, right) => {
  let strict = false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    const noWorse = a.direction === EvolutionObjectiveDirection.MAXIMIZE
      ? a.value >= b.value
      : a.value <= b.value;
    if (!noWorse) return false;
    strict ||= a.value !== b.value;
  }
  return strict;
};

const compareAlternatives = (left, right) => {
  for (let index = 0; index < left.objectiveVector.length; index += 1) {
    const a = left.objectiveVector[index];
    const b = right.objectiveVector[index];
    if (a.value === b.value) continue;
    return a.direction === EvolutionObjectiveDirection.MAXIMIZE
      ? b.value - a.value
      : a.value - b.value;
  }
  return compareText(stableStringify(left.path), stableStringify(right.path)) ||
    compareText(left.nodeFingerprint, right.nodeFingerprint);
};

const explanationForNode = (node, byEdgeKey) => {
  if (node.path.length === 0) {
    return [
      { code: EvolutionExplanationCode.STARTING_STATE, edgeKey: null, fields: [] },
      { code: EvolutionExplanationCode.PARETO_NON_DOMINATED, edgeKey: null, fields: [] },
    ];
  }
  const explanations = [];
  for (const edgeKey of node.path) {
    const edge = byEdgeKey.get(edgeKey);
    const transformation = edge.transformation;
    explanations.push({ code: EvolutionExplanationCode.VERIFIED_EDGE_APPLIED, edgeKey, fields: [] });
    if (transformation.overall != null) explanations.push({
      code: EvolutionExplanationCode.OVERALL_CHANGED,
      edgeKey,
      fields: ["overall"],
    });
    if (transformation.attributes.length) explanations.push({
      code: EvolutionExplanationCode.ATTRIBUTE_CHANGED,
      edgeKey,
      fields: transformation.attributes.map((entry) => entry.attribute),
    });
    if (transformation.addPositions.length) explanations.push({ code: EvolutionExplanationCode.POSITION_ADDED, edgeKey, fields: transformation.addPositions });
    if (transformation.addRoles.length) explanations.push({ code: EvolutionExplanationCode.ROLE_ADDED, edgeKey, fields: transformation.addRoles });
    if (transformation.addPlaystyles.length) explanations.push({ code: EvolutionExplanationCode.PLAYSTYLE_ADDED, edgeKey, fields: transformation.addPlaystyles });
    if (transformation.addPlaystylePlus.length) explanations.push({ code: EvolutionExplanationCode.PLAYSTYLE_PLUS_ADDED, edgeKey, fields: transformation.addPlaystylePlus });
    if (transformation.setRarity != null) explanations.push({ code: EvolutionExplanationCode.RARITY_CHANGED, edgeKey, fields: [transformation.setRarity] });
    if (transformation.addEligibilityTags.length || transformation.removeEligibilityTags.length) explanations.push({
      code: EvolutionExplanationCode.ELIGIBILITY_TAG_CHANGED,
      edgeKey,
      fields: union(transformation.addEligibilityTags, transformation.removeEligibilityTags),
    });
  }
  explanations.push({ code: EvolutionExplanationCode.PARETO_NON_DOMINATED, edgeKey: null, fields: [] });
  return explanations;
};

export const planEvolutionPaths = (request = {}) => {
  exactKeys(request, ["playerState", "edges", "objective"], "$evolutionPlanner", ["limits"]);
  const { playerState, edges, objective, limits = {} } = request;
  const normalizedState = normalizeEvolutionPlayerState(playerState);
  const normalizedObjective = normalizeObjective(objective);
  const normalizedLimits = normalizeLimits(limits);
  if (!Array.isArray(edges)) fail(EvolutionPlannerErrorCode.INVALID_INPUT, "Edges must be an array", "$evolutionPlanner.edges");
  if (edges.length > normalizedLimits.maxEdges) {
    fail(EvolutionPlannerErrorCode.BOUND_EXCEEDED, "Evolution edge input exceeds its configured bound", "$evolutionPlanner.edges");
  }
  const normalizedEdges = edges.map(normalizeEdge).sort((left, right) => compareText(left.edgeKey, right.edgeKey));
  if (new Set(normalizedEdges.map((edge) => edge.edgeKey)).size !== normalizedEdges.length) {
    fail(EvolutionPlannerErrorCode.DUPLICATE_EDGE, "Evolution edge keys must be unique", "$evolutionPlanner.edges");
  }
  const byEdgeKey = new Map(normalizedEdges.map((edge) => [edge.edgeKey, edge]));
  const initialSemanticFingerprint = semanticFingerprint(normalizedState);
  const initial = {
    state: normalizedState,
    path: [],
    semanticFingerprints: new Set([initialSemanticFingerprint]),
  };
  const queue = [initial];
  const nodes = [initial];
  const globallySeen = new Set([fingerprintEvolutionPlayerState(normalizedState)]);
  let edgeEvaluations = 0;
  let rejectedCycles = 0;
  let rejectedReuse = 0;
  let boundReason = null;
  let maximumDepthReached = 0;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const node = queue[queueIndex];
    maximumDepthReached = Math.max(maximumDepthReached, node.path.length);
    if (node.path.length >= normalizedLimits.maxDepth) {
      for (const edge of normalizedEdges) {
        if (edgeEvaluations >= normalizedLimits.maxEdgeEvaluations) {
          boundReason = EvolutionBoundReason.EDGE_EVALUATION_BOUND_REACHED;
          break;
        }
        edgeEvaluations += 1;
        if (node.state.appliedEvolutions.includes(edge.edgeKey) || node.path.includes(edge.edgeKey)) {
          rejectedReuse += 1;
          continue;
        }
        if (!eligibleForEdge(node.state, edge)) continue;
        const nextState = applyEdge(node.state, edge);
        const nextSemanticFingerprint = semanticFingerprint(nextState);
        if (node.semanticFingerprints.has(nextSemanticFingerprint)) {
          rejectedCycles += 1;
          continue;
        }
        if (globallySeen.has(fingerprintEvolutionPlayerState(nextState))) continue;
        boundReason = EvolutionBoundReason.DEPTH_BOUND_REACHED;
        break;
      }
      if (boundReason) break;
      continue;
    }
    for (const edge of normalizedEdges) {
      if (edgeEvaluations >= normalizedLimits.maxEdgeEvaluations) {
        boundReason = EvolutionBoundReason.EDGE_EVALUATION_BOUND_REACHED;
        break;
      }
      edgeEvaluations += 1;
      if (node.state.appliedEvolutions.includes(edge.edgeKey) || node.path.includes(edge.edgeKey)) {
        rejectedReuse += 1;
        continue;
      }
      if (!eligibleForEdge(node.state, edge)) continue;
      const nextState = applyEdge(node.state, edge);
      const nextSemanticFingerprint = semanticFingerprint(nextState);
      if (node.semanticFingerprints.has(nextSemanticFingerprint)) {
        rejectedCycles += 1;
        continue;
      }
      const nextNodeFingerprint = fingerprintEvolutionPlayerState(nextState);
      if (globallySeen.has(nextNodeFingerprint)) continue;
      if (nodes.length >= normalizedLimits.maxNodes) {
        boundReason = EvolutionBoundReason.NODE_BOUND_REACHED;
        break;
      }
      const next = {
        state: nextState,
        path: [...node.path, edge.edgeKey],
        semanticFingerprints: new Set([...node.semanticFingerprints, nextSemanticFingerprint]),
      };
      globallySeen.add(nextNodeFingerprint);
      nodes.push(next);
      queue.push(next);
      maximumDepthReached = Math.max(maximumDepthReached, next.path.length);
    }
    if (boundReason) break;
  }

  const inputCanonical = {
    schemaVersion: EVOLUTION_PLAN_SCHEMA_VERSION,
    playerState: normalizedState,
    edges: normalizedEdges,
    objective: normalizedObjective,
    limits: normalizedLimits,
  };
  const inputFingerprint = stableFingerprint(inputCanonical);
  const baseline = {
    overall: normalizedState.overall,
    stateFingerprint: fingerprintEvolutionPlayerState(normalizedState),
    objectiveVector: objectiveVector(initial, normalizedObjective),
  };
  let paretoCount = 0;
  let alternatives = [];
  if (!boundReason) {
    const evaluated = nodes.slice(1).map((node) => ({
      node,
      objectiveVector: objectiveVector(node, normalizedObjective),
    }));
    const pareto = evaluated.filter((candidate, index) =>
      !evaluated.some((other, otherIndex) => otherIndex !== index &&
        dominates(other.objectiveVector, candidate.objectiveVector)));
    paretoCount = pareto.length;
    if (pareto.length > normalizedLimits.maxAlternatives) {
      boundReason = EvolutionBoundReason.ALTERNATIVE_BOUND_REACHED;
    } else {
      alternatives = pareto.map(({ node, objectiveVector: vector }) => {
        const pathEdges = node.path.map((edgeKey) => byEdgeKey.get(edgeKey));
        return {
          path: [...node.path],
          finalState: node.state,
          nodeFingerprint: fingerprintEvolutionPlayerState(node.state),
          pathFingerprint: stableFingerprint({
            inputFingerprint,
            pathEdges,
          }),
          objectiveVector: vector,
          explanations: explanationForNode(node, byEdgeKey),
        };
      }).sort(compareAlternatives)
        .map((alternative, index) => ({ rank: index + 1, ...alternative }));
    }
  }

  const result = {
    kind: EVOLUTION_PLAN_KIND,
    schemaVersion: EVOLUTION_PLAN_SCHEMA_VERSION,
    readOnly: true,
    canExecute: false,
    searchStatus: boundReason
      ? EvolutionSearchStatus.BOUNDED
      : alternatives.length === 0
        ? EvolutionSearchStatus.NO_VERIFIED_PATH
        : EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS,
    boundReason,
    limits: normalizedLimits,
    explored: {
      nodeCount: nodes.length,
      edgeEvaluationCount: edgeEvaluations,
      maximumDepthReached,
      rejectedCycleCount: rejectedCycles,
      rejectedReuseCount: rejectedReuse,
      paretoCount,
    },
    objective: normalizedObjective,
    baseline,
    alternatives,
    fingerprints: {
      input: inputFingerprint,
      result: null,
    },
  };
  result.fingerprints.result = stableFingerprint({ ...result, fingerprints: { input: result.fingerprints.input } });
  return cloneAndFreeze(result);
};
