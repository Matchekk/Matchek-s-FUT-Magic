import test from "node:test";
import assert from "node:assert/strict";

import {
  EVOLUTION_PLAN_KIND,
  EvolutionBoundReason,
  EvolutionObjectiveDimension,
  EvolutionObjectiveDirection,
  EvolutionPlannerError,
  EvolutionPlannerErrorCode,
  EvolutionSearchStatus,
  EvolutionTransformOperation,
  fingerprintEvolutionPlayerState,
  normalizeEvolutionPlayerState,
  planEvolutionPaths,
} from "../src/application/index.js";

const playerState = (overrides = {}) => {
  const { attributes: attributeOverrides = {}, ...stateOverrides } = overrides;
  return {
    overall: 70,
    attributes: {
      pace: 70,
      shooting: 70,
      passing: 70,
      dribbling: 70,
      defending: 70,
      physical: 70,
      ...attributeOverrides,
    },
    positions: ["CM"],
    roles: ["box_to_box"],
    playstyles: ["technical"],
    playstylePlus: [],
    rarity: "gold",
    eligibilityTags: ["base"],
    appliedEvolutions: [],
    ...stateOverrides,
  };
};

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

const edge = (edgeKey, transformationOverrides, eligibilityOverrides = {}, verification = {}) => ({
  edgeKey,
  verification: {
    state: "VERIFIED",
    evidenceFingerprint: `fixture:${edgeKey}`,
    ...verification,
  },
  eligibility: eligibility(eligibilityOverrides),
  transformation: transformation(transformationOverrides),
});

const objective = (dimensions = [{
  dimension: EvolutionObjectiveDimension.PACE,
  direction: EvolutionObjectiveDirection.MAXIMIZE,
}], overrides = {}) => ({
  roleKey: "role.cm.runner",
  dimensions,
  desiredPositions: ["CM"],
  desiredRoles: ["box_to_box"],
  desiredPlaystyles: ["technical"],
  desiredPlaystylePlus: [],
  desiredEligibilityTags: [],
  ...overrides,
});

const request = (overrides = {}) => ({
  playerState: playerState(),
  edges: [],
  objective: objective(),
  ...overrides,
});

const forbiddenPublicKeys = new Set([
  "itemId", "playerId", "resourceId", "definitionId", "eaId", "assetId",
  "steps", "actions", "commands", "workflow", "controller", "selector", "endpoint", "token",
]);

const assertPublicRedaction = (value) => {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(forbiddenPublicKeys.has(key), false, `forbidden public key ${key}`);
    assertPublicRedaction(entry);
  }
};

test("creates an immutable proposal-only path from exact verified metadata", () => {
  const input = request({
    edges: [edge("evo.midfield", {
      attributes: [{
        attribute: "pace",
        operation: EvolutionTransformOperation.ADD_CAPPED,
        value: 8,
        cap: 76,
      }],
      addPositions: ["CAM"],
      addRoles: ["playmaker"],
      addPlaystyles: ["incisive_pass"],
      addPlaystylePlus: ["technical_plus"],
      addEligibilityTags: ["evolved"],
      overall: { operation: "MAX", value: 75, cap: null },
      setRarity: "evolution",
    }, {
      positionsAnyOf: ["CM"],
      rolesAllOf: ["box_to_box"],
      playstylesAllOf: ["technical"],
      raritiesAnyOf: ["gold"],
      eligibilityTagsAllOf: ["base"],
      excludedEligibilityTags: ["blocked"],
      overall: { min: 65, max: 75 },
      attributes: [{ attribute: "pace", min: 65, max: 75 }],
    })],
  });
  const before = structuredClone(input);

  const result = planEvolutionPaths(input);

  assert.deepEqual(input, before);
  assert.equal(result.kind, EVOLUTION_PLAN_KIND);
  assert.equal(result.readOnly, true);
  assert.equal(result.canExecute, false);
  assert.equal(result.searchStatus, EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS);
  assert.equal(result.boundReason, null);
  assert.equal(result.alternatives.length, 1);
  assert.deepEqual(result.alternatives[0].path, ["evo.midfield"]);
  assert.equal(result.alternatives[0].finalState.attributes.pace, 76);
  assert.equal(result.alternatives[0].finalState.overall, 75);
  assert.deepEqual(result.alternatives[0].finalState.positions, ["CAM", "CM"]);
  assert.equal(result.alternatives[0].finalState.rarity, "evolution");
  assert.match(result.alternatives[0].pathFingerprint, /^fnv1a32:/);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.alternatives[0].finalState.attributes));
  assert.throws(() => { result.alternatives[0].path.push("mutate"); }, TypeError);
  assertPublicRedaction(result);
});

test("applies every eligibility field exactly and ignores ineligible edges", () => {
  const exactGate = {
    positionsAnyOf: ["CM"],
    positionsAllOf: ["CM"],
    rolesAllOf: ["box_to_box"],
    playstylesAllOf: ["technical"],
    playstylePlusAllOf: [],
    raritiesAnyOf: ["gold"],
    eligibilityTagsAllOf: ["base"],
    excludedEligibilityTags: ["blocked"],
    attributes: [{ attribute: "pace", min: 70, max: 70 }],
  };
  const result = planEvolutionPaths(request({
    edges: [
      edge("a.ineligible", { attributes: [{ attribute: "pace", operation: "MAX", value: 99, cap: null }] }, {
        ...exactGate,
        playstylePlusAllOf: ["missing_plus"],
      }),
      edge("b.eligible", { attributes: [{ attribute: "pace", operation: "MAX", value: 75, cap: null }] }, exactGate),
    ],
  }));

  assert.deepEqual(result.alternatives.map((entry) => entry.path), [["b.eligible"]]);
  assert.equal(result.alternatives[0].finalState.attributes.pace, 75);
});

test("rejects any unverified edge before traversal with a stable typed error", () => {
  const input = request({
    edges: [
      edge("a.valid", { addEligibilityTags: ["valid"] }),
      edge("b.unknown", { addEligibilityTags: ["unknown"] }, {}, { state: "UNKNOWN" }),
    ],
  });

  assert.throws(() => planEvolutionPaths(input), (error) => {
    assert.ok(error instanceof EvolutionPlannerError);
    assert.equal(error.code, EvolutionPlannerErrorCode.UNVERIFIED_EDGE);
    assert.match(error.path, /verification\.state$/);
    return true;
  });
});

test("is deterministic across edge and set-like input permutations", () => {
  const edges = [
    edge("evo.pace", { attributes: [{ attribute: "pace", operation: "MAX", value: 74, cap: null }] }),
    edge("evo.pass", { attributes: [{ attribute: "passing", operation: "MAX", value: 75, cap: null }] }),
  ];
  const first = request({
    playerState: playerState({ positions: ["CM", "CAM"], roles: ["playmaker", "box_to_box"] }),
    edges,
    objective: objective([
      { dimension: "PACE", direction: "MAXIMIZE" },
      { dimension: "PASSING", direction: "MAXIMIZE" },
    ]),
  });
  const second = request({
    ...first,
    playerState: { ...first.playerState, positions: [...first.playerState.positions].reverse(), roles: [...first.playerState.roles].reverse() },
    edges: [...edges].reverse(),
  });

  const a = planEvolutionPaths(first);
  const b = planEvolutionPaths(second);
  assert.deepEqual(a, b);
  assert.equal(fingerprintEvolutionPlayerState(first.playerState), fingerprintEvolutionPlayerState(second.playerState));
});

test("preserves deterministic Pareto alternatives instead of inventing weights", () => {
  const result = planEvolutionPaths(request({
    edges: [
      edge("branch.pace", {
        attributes: [{ attribute: "pace", operation: "MAX", value: 80, cap: null }],
        addEligibilityTags: ["pace_path"],
      }, { excludedEligibilityTags: ["pass_path"] }),
      edge("branch.pass", {
        attributes: [{ attribute: "passing", operation: "MAX", value: 80, cap: null }],
        addEligibilityTags: ["pass_path"],
      }, { excludedEligibilityTags: ["pace_path"] }),
    ],
    objective: objective([
      { dimension: "PACE", direction: "MAXIMIZE" },
      { dimension: "PASSING", direction: "MAXIMIZE" },
    ]),
    limits: { maxDepth: 1, maxNodes: 8, maxEdges: 2, maxEdgeEvaluations: 16, maxAlternatives: 4 },
  }));

  assert.equal(result.searchStatus, EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS);
  assert.equal(result.alternatives.length, 2);
  assert.deepEqual(result.alternatives.map((entry) => entry.path), [["branch.pace"], ["branch.pass"]]);
  assert.deepEqual(result.alternatives.map((entry) => entry.objectiveVector.map((part) => part.value)), [[80, 70], [70, 80]]);
});

test("keeps explicitly injected overall and role-fit tradeoffs on the Pareto frontier", () => {
  const result = planEvolutionPaths(request({
    edges: [
      edge("branch.overall", {
        overall: { operation: "MAX", value: 82, cap: null },
        addEligibilityTags: ["overall_path"],
      }, { excludedEligibilityTags: ["role_path"] }),
      edge("branch.role", {
        overall: { operation: "MAX", value: 76, cap: null },
        addRoles: ["holding_plus"],
        addEligibilityTags: ["role_path"],
      }, { excludedEligibilityTags: ["overall_path"] }),
    ],
    objective: objective([
      { dimension: "OVERALL", direction: "MAXIMIZE" },
      { dimension: "ROLE_MATCHES", direction: "MAXIMIZE" },
    ], { desiredRoles: ["holding_plus"] }),
    limits: { maxDepth: 1, maxNodes: 8, maxEdges: 2, maxEdgeEvaluations: 16, maxAlternatives: 4 },
  }));

  assert.deepEqual(result.alternatives.map((entry) => entry.objectiveVector.map((part) => part.value)), [[82, 0], [76, 1]]);
});

test("reports the starting state only as baseline when no verified path is eligible", () => {
  const result = planEvolutionPaths(request({
    edges: [edge("needs.gk", { addRoles: ["keeper"] }, { positionsAnyOf: ["GK"] })],
  }));

  assert.equal(result.searchStatus, EvolutionSearchStatus.NO_VERIFIED_PATH);
  assert.equal(result.boundReason, null);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.baseline.stateFingerprint, fingerprintEvolutionPlayerState(playerState()));
  assert.deepEqual(result.baseline.objectiveVector.map((entry) => entry.value), [70]);
});

test("prevents semantic cycles and repeated Evolution use", () => {
  const result = planEvolutionPaths(request({
    edges: [
      edge("a.add", { addEligibilityTags: ["temporary"] }, { excludedEligibilityTags: ["temporary"] }),
      edge("b.remove", { removeEligibilityTags: ["temporary"] }, { eligibilityTagsAllOf: ["temporary"] }),
    ],
    limits: { maxDepth: 3, maxNodes: 16, maxEdges: 2, maxEdgeEvaluations: 32, maxAlternatives: 8 },
  }));

  assert.equal(result.searchStatus, EvolutionSearchStatus.COMPLETE_WITHIN_BOUNDS);
  assert.ok(result.explored.rejectedCycleCount >= 1);
  assert.ok(result.explored.rejectedReuseCount >= 1);
  for (const alternative of result.alternatives) {
    assert.equal(new Set(alternative.path).size, alternative.path.length);
  }
});

test("fails closed with no alternatives when depth, node or evaluation bounds are reached", () => {
  const depth = planEvolutionPaths(request({
    edges: [
      edge("a.first", { addEligibilityTags: ["first"] }, { excludedEligibilityTags: ["first"] }),
      edge("b.second", { addEligibilityTags: ["second"] }, { eligibilityTagsAllOf: ["first"] }),
    ],
    limits: { maxDepth: 1, maxNodes: 8, maxEdges: 2, maxEdgeEvaluations: 16, maxAlternatives: 8 },
  }));
  assert.equal(depth.searchStatus, EvolutionSearchStatus.BOUNDED);
  assert.equal(depth.boundReason, EvolutionBoundReason.DEPTH_BOUND_REACHED);
  assert.deepEqual(depth.alternatives, []);

  const nodes = planEvolutionPaths(request({
    edges: [edge("a.node", { addEligibilityTags: ["node"] })],
    limits: { maxDepth: 2, maxNodes: 1, maxEdges: 1, maxEdgeEvaluations: 8, maxAlternatives: 8 },
  }));
  assert.equal(nodes.boundReason, EvolutionBoundReason.NODE_BOUND_REACHED);
  assert.deepEqual(nodes.alternatives, []);

  const evaluations = planEvolutionPaths(request({
    edges: [
      edge("a.ineligible", { addEligibilityTags: ["never"] }, { positionsAnyOf: ["GK"] }),
      edge("b.eligible", { addEligibilityTags: ["yes"] }),
    ],
    limits: { maxDepth: 2, maxNodes: 8, maxEdges: 2, maxEdgeEvaluations: 1, maxAlternatives: 8 },
  }));
  assert.equal(evaluations.boundReason, EvolutionBoundReason.EDGE_EVALUATION_BOUND_REACHED);
  assert.deepEqual(evaluations.alternatives, []);
});

test("fails closed rather than slicing an oversized Pareto frontier", () => {
  const result = planEvolutionPaths(request({
    edges: [
      edge("branch.pace", {
        attributes: [{ attribute: "pace", operation: "MAX", value: 80, cap: null }],
        addEligibilityTags: ["pace_path"],
      }, { excludedEligibilityTags: ["pass_path"] }),
      edge("branch.pass", {
        attributes: [{ attribute: "passing", operation: "MAX", value: 80, cap: null }],
        addEligibilityTags: ["pass_path"],
      }, { excludedEligibilityTags: ["pace_path"] }),
    ],
    objective: objective([
      { dimension: "PACE", direction: "MAXIMIZE" },
      { dimension: "PASSING", direction: "MAXIMIZE" },
    ]),
    limits: { maxDepth: 1, maxNodes: 8, maxEdges: 2, maxEdgeEvaluations: 16, maxAlternatives: 1 },
  }));

  assert.equal(result.searchStatus, EvolutionSearchStatus.BOUNDED);
  assert.equal(result.boundReason, EvolutionBoundReason.ALTERNATIVE_BOUND_REACHED);
  assert.equal(result.explored.paretoCount, 2);
  assert.deepEqual(result.alternatives, []);
});

test("binds fingerprints to evidence and rejects identities, guessed OVR, and weights", () => {
  const base = request({ edges: [edge("evo.one", { addRoles: ["runner"] })] });
  const changedEvidence = structuredClone(base);
  changedEvidence.edges[0].verification.evidenceFingerprint = "fixture:evo.one:changed";

  assert.notEqual(planEvolutionPaths(base).fingerprints.input, planEvolutionPaths(changedEvidence).fingerprints.input);
  assert.throws(() => planEvolutionPaths({ ...base, itemId: "owned-1" }), (error) => error.code === EvolutionPlannerErrorCode.INVALID_INPUT);
  assert.throws(() => planEvolutionPaths(request({
    objective: objective([{ dimension: "OVR", direction: "MAXIMIZE" }]),
  })), (error) => error.code === EvolutionPlannerErrorCode.INVALID_OBJECTIVE);
  assert.throws(() => planEvolutionPaths(request({
    objective: objective([{ dimension: "PACE", direction: "MAXIMIZE", weight: 1 }]),
  })), (error) => error.code === EvolutionPlannerErrorCode.INVALID_INPUT);
});

test("normalizes anonymous PlayerState without retaining caller references", () => {
  const input = playerState({ roles: ["runner", "box_to_box"] });
  const normalized = normalizeEvolutionPlayerState(input);
  input.roles.push("mutated_after_normalize");

  assert.deepEqual(normalized.roles, ["box_to_box", "runner"]);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.roles), true);
});
