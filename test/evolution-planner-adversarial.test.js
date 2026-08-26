import assert from "node:assert/strict";
import test from "node:test";

import {
  EVOLUTION_PLANNER_HARD_LIMITS,
  EvolutionBoundReason,
  EvolutionObjectiveDimension,
  EvolutionObjectiveDirection,
  EvolutionPlannerError,
  EvolutionPlannerErrorCode,
  EvolutionSearchStatus,
  EvolutionTransformOperation,
  planEvolutionPaths,
} from "../src/application/index.js";

const attributes = (overrides = {}) => ({
  pace: 70,
  shooting: 70,
  passing: 70,
  dribbling: 70,
  defending: 70,
  physical: 70,
  ...overrides,
});

const playerState = ({ attributes: attributeOverrides, ...overrides } = {}) => ({
  overall: 70,
  attributes: attributes(attributeOverrides),
  positions: ["ST", "CF"],
  roles: ["target_forward"],
  playstyles: ["rapid"],
  playstylePlus: ["power_shot"],
  rarity: "gold_rare",
  eligibilityTags: ["base", "owned"],
  appliedEvolutions: [],
  ...overrides,
});

const eligibility = (overrides = {}) => ({
  positionsAnyOf: [],
  positionsAllOf: [],
  rolesAllOf: [],
  playstylesAllOf: [],
  playstylePlusAllOf: [],
  raritiesAnyOf: [],
  eligibilityTagsAllOf: [],
  excludedEligibilityTags: [],
  overall: { min: null, max: null },
  attributes: [],
  ...overrides,
});

const transformation = (overrides = {}) => ({
  overall: null,
  attributes: [],
  addPositions: [],
  addRoles: [],
  addPlaystyles: [],
  addPlaystylePlus: [],
  addEligibilityTags: [],
  removeEligibilityTags: [],
  setRarity: null,
  ...overrides,
});

const edge = (
  edgeKey,
  { eligibility: rules, transformation: changes, ...overrides } = {},
) => ({
  edgeKey,
  verification: {
    state: "VERIFIED",
    evidenceFingerprint: `evidence_${edgeKey}`,
  },
  ...overrides,
  eligibility: eligibility(rules),
  transformation: transformation(changes ?? {
    attributes: [{
      attribute: "pace",
      operation: EvolutionTransformOperation.ADD_CAPPED,
      value: 1,
      cap: 99,
    }],
  }),
});

const objective = (overrides = {}) => ({
  roleKey: "striker_v1",
  dimensions: [{
    dimension: EvolutionObjectiveDimension.SHOOTING,
    direction: EvolutionObjectiveDirection.MAXIMIZE,
  }],
  desiredPositions: ["ST"],
  desiredRoles: ["poacher"],
  desiredPlaystyles: ["rapid"],
  desiredPlaystylePlus: ["power_shot"],
  desiredEligibilityTags: [],
  ...overrides,
});

const plan = ({ state = playerState(), edges = [], role = objective(), limits } = {}) =>
  planEvolutionPaths({
    playerState: state,
    edges,
    objective: role,
    ...(limits ? { limits } : {}),
  });

const assertPlannerError = (code) => (error) => {
  assert.equal(error instanceof EvolutionPlannerError, true);
  assert.equal(error.code, code);
  return true;
};

const assertDeepFrozen = (value) => {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
};

const collectKeys = (value, output = new Set()) => {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    output.add(key);
    collectKeys(child, output);
  }
  return output;
};

test("planning is deterministic across player, objective, transform, and edge input order", () => {
  const fast = edge("evo_fast", {
    eligibility: { eligibilityTagsAllOf: ["base"] },
    transformation: {
      attributes: [
        { attribute: "pace", operation: "ADD_CAPPED", value: 8, cap: 99 },
        { attribute: "dribbling", operation: "ADD_CAPPED", value: 2, cap: 99 },
      ],
      addRoles: ["runner", "wide_forward"],
      addEligibilityTags: ["fast_path"],
      removeEligibilityTags: ["base"],
    },
  });
  const finisher = edge("evo_finisher", {
    eligibility: { eligibilityTagsAllOf: ["base"] },
    transformation: {
      attributes: [
        { attribute: "shooting", operation: "ADD_CAPPED", value: 8, cap: 99 },
        { attribute: "passing", operation: "ADD_CAPPED", value: 2, cap: 99 },
      ],
      addRoles: ["poacher", "advanced_forward"],
      addEligibilityTags: ["finish_path"],
      removeEligibilityTags: ["base"],
    },
  });
  const role = objective({
    dimensions: [
      { dimension: "SHOOTING", direction: "MAXIMIZE" },
      { dimension: "PACE", direction: "MAXIMIZE" },
      { dimension: "ROLE_MATCHES", direction: "MAXIMIZE" },
    ],
    desiredRoles: ["poacher", "runner"],
  });
  const state = playerState({
    positions: ["CF", "ST"],
    roles: ["target_forward", "false_nine"],
    playstyles: ["technical", "rapid"],
    eligibilityTags: ["owned", "base"],
  });

  const first = plan({ state, edges: [fast, finisher], role });
  const reordered = plan({
    state: {
      ...state,
      positions: [...state.positions].reverse(),
      roles: [...state.roles].reverse(),
      playstyles: [...state.playstyles].reverse(),
      eligibilityTags: [...state.eligibilityTags].reverse(),
    },
    edges: [finisher, fast].map((entry) => ({
      ...entry,
      transformation: {
        ...entry.transformation,
        attributes: [...entry.transformation.attributes].reverse(),
        addRoles: [...entry.transformation.addRoles].reverse(),
      },
    })),
    role: { ...role, desiredRoles: [...role.desiredRoles].reverse() },
  });

  assert.deepEqual(reordered, first);
});

test("unknown or unverified edges reject the whole request without partial paths", () => {
  for (const state of ["UNKNOWN", "UNVERIFIED", "INELIGIBLE"]) {
    const suspect = edge(`edge_${state.toLowerCase()}`);
    suspect.verification.state = state;
    assert.throws(
      () => plan({ edges: [edge("verified"), suspect] }),
      assertPlannerError(EvolutionPlannerErrorCode.UNVERIFIED_EDGE),
    );
  }
});

test("eligibility is exact across every declared gate and boundary", async (t) => {
  const exactEdge = edge("exact_match", {
    eligibility: {
      positionsAnyOf: ["ST"],
      positionsAllOf: ["CF"],
      rolesAllOf: ["target_forward"],
      playstylesAllOf: ["rapid"],
      playstylePlusAllOf: ["power_shot"],
      raritiesAnyOf: ["gold_rare"],
      eligibilityTagsAllOf: ["owned"],
      excludedEligibilityTags: ["blocked"],
      overall: { min: 70, max: 70 },
      attributes: [{ attribute: "shooting", min: 70, max: 70 }],
    },
    transformation: {
      attributes: [{ attribute: "shooting", operation: "ADD_CAPPED", value: 10, cap: 80 }],
    },
  });
  const eligible = plan({ edges: [exactEdge] });
  assert.deepEqual(eligible.alternatives.map((entry) => entry.path), [["exact_match"]]);

  const ineligibleStates = [
    ["missing any-of position", playerState({ positions: ["CF"] })],
    ["missing all-of position", playerState({ positions: ["ST"] })],
    ["missing required role", playerState({ roles: [] })],
    ["missing required playstyle", playerState({ playstyles: [] })],
    ["missing required playstyle plus", playerState({ playstylePlus: [] })],
    ["missing required tag", playerState({ eligibilityTags: ["base"] })],
    ["wrong exact overall", playerState({ overall: 71 })],
    ["wrong exact attribute", playerState({ attributes: { shooting: 71 } })],
    ["excluded tag present", playerState({ eligibilityTags: ["base", "owned", "blocked"] })],
    ["wrong rarity", playerState({ rarity: "silver_rare" })],
  ];
  for (const [name, state] of ineligibleStates) {
    await t.test(name, () => {
      const result = plan({ state, edges: [exactEdge] });
      assert.equal(result.searchStatus, EvolutionSearchStatus.NO_VERIFIED_PATH);
      assert.deepEqual(result.alternatives, []);
    });
  }
});

test("search rejects semantic cycles and repeated Evolution use", () => {
  const raise = edge("raise", {
    eligibility: { attributes: [{ attribute: "shooting", min: null, max: 70 }] },
    transformation: {
      attributes: [{ attribute: "shooting", operation: "SET", value: 80, cap: null }],
    },
  });
  const reset = edge("reset", {
    eligibility: { attributes: [{ attribute: "shooting", min: 80, max: null }] },
    transformation: {
      attributes: [{ attribute: "shooting", operation: "SET", value: 70, cap: null }],
    },
  });

  const result = plan({ edges: [reset, raise] });

  assert.equal(result.searchStatus, EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS);
  assert.ok(result.explored.rejectedCycleCount >= 1);
  assert.ok(result.explored.rejectedReuseCount >= 1);
  for (const alternative of result.alternatives) {
    assert.equal(new Set(alternative.path).size, alternative.path.length);
  }
});

test("input and traversal bounds reject or block without truncating partial alternatives", () => {
  const inputs = [edge("one"), edge("two")];
  const before = structuredClone(inputs);
  assert.throws(
    () => plan({ edges: inputs, limits: { maxEdges: 1 } }),
    assertPlannerError(EvolutionPlannerErrorCode.BOUND_EXCEEDED),
  );
  assert.deepEqual(inputs, before);

  assert.throws(
    () => plan({
      edges: [],
      limits: { maxEdges: EVOLUTION_PLANNER_HARD_LIMITS.maxEdges + 1 },
    }),
    assertPlannerError(EvolutionPlannerErrorCode.INVALID_INPUT),
  );

  const bounded = plan({ edges: [edge("reachable")], limits: { maxNodes: 1 } });
  assert.equal(bounded.searchStatus, EvolutionSearchStatus.BOUNDED);
  assert.equal(bounded.boundReason, EvolutionBoundReason.NODE_BOUND_REACHED);
  assert.deepEqual(bounded.alternatives, []);
});

const exclusiveTradeoffEdges = () => [
  edge("pace_path", {
    eligibility: { eligibilityTagsAllOf: ["base"] },
    transformation: {
      overall: { operation: "SET", value: 95, cap: null },
      attributes: [{ attribute: "pace", operation: "ADD_CAPPED", value: 10, cap: 99 }],
      addRoles: ["wide_forward"],
      addEligibilityTags: ["pace_done"],
      removeEligibilityTags: ["base"],
    },
  }),
  edge("shooting_path", {
    eligibility: { eligibilityTagsAllOf: ["base"] },
    transformation: {
      overall: { operation: "SET", value: 80, cap: null },
      attributes: [{ attribute: "shooting", operation: "ADD_CAPPED", value: 10, cap: 99 }],
      addRoles: ["poacher"],
      addEligibilityTags: ["shooting_done"],
      removeEligibilityTags: ["base"],
    },
  }),
];

test("the frontier retains every non-dominated pace-versus-shooting tradeoff", () => {
  const result = plan({
    edges: exclusiveTradeoffEdges(),
    role: objective({
      dimensions: [
        { dimension: "PACE", direction: "MAXIMIZE" },
        { dimension: "SHOOTING", direction: "MAXIMIZE" },
      ],
    }),
  });

  assert.equal(result.searchStatus, EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS);
  assert.deepEqual(result.alternatives.map((entry) => entry.path), [
    ["pace_path"],
    ["shooting_path"],
  ]);
  const vectors = result.alternatives.map((entry) =>
    Object.fromEntries(entry.objectiveVector.map((part) => [part.dimension, part.value])));
  assert.deepEqual(vectors, [
    { PACE: 80, SHOOTING: 70 },
    { PACE: 70, SHOOTING: 80 },
  ]);
});

test("role profiles preserve distinct tradeoffs instead of naming an OVR-only winner", () => {
  const dimensions = [
    { dimension: "ROLE_MATCHES", direction: "MAXIMIZE" },
    { dimension: "OVERALL", direction: "MAXIMIZE" },
  ];
  const poacher = plan({
    edges: exclusiveTradeoffEdges(),
    role: objective({ roleKey: "poacher_v1", dimensions, desiredRoles: ["poacher"] }),
  });
  const wide = plan({
    edges: exclusiveTradeoffEdges(),
    role: objective({ roleKey: "wide_v1", dimensions, desiredRoles: ["wide_forward"] }),
  });

  assert.deepEqual(poacher.alternatives[0].path, ["shooting_path"]);
  assert.deepEqual(wide.alternatives[0].path, ["pace_path"]);
  assert.equal(
    Object.values(EvolutionObjectiveDimension).includes("OVERALL"),
    true,
  );
  assert.equal(poacher.alternatives[0].finalState.overall, 80);
  assert.equal(poacher.alternatives[1].finalState.overall, 95);
});

test("results are immutable, redacted proposals with no execution surface", () => {
  const request = {
    state: playerState(),
    edges: [edge("safe_fixture")],
    role: objective(),
  };
  const before = structuredClone(request);
  const result = plan(request);

  assert.deepEqual(request, before);
  assert.equal(result.readOnly, true);
  assert.equal(result.canExecute, false);
  assertDeepFrozen(result);
  assert.throws(() => { result.alternatives.length = 0; }, TypeError);

  const keys = collectKeys(result);
  for (const forbidden of [
    "itemId", "ownedItemId", "playerId", "resourceId", "assetId",
    "steps", "actions", "command", "commands", "workflow", "adapter",
    "controller", "activation", "execute",
  ]) {
    assert.equal(keys.has(forbidden), false, `public result leaked ${forbidden}`);
  }

  assert.throws(
    () => plan({ state: { ...playerState(), itemId: "owned-secret" } }),
    assertPlannerError(EvolutionPlannerErrorCode.INVALID_INPUT),
  );
  const executableEdge = edge("malicious");
  executableEdge.command = "ACTIVATE_EVOLUTION";
  assert.throws(
    () => plan({ edges: [executableEdge] }),
    assertPlannerError(EvolutionPlannerErrorCode.INVALID_INPUT),
  );
});
