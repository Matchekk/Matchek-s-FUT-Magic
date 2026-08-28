import test from "node:test";
import assert from "node:assert/strict";

import {
  EvolutionEligibilityReason,
  EvolutionObjectiveDirection,
  EvolutionResultMode,
  applyEvolution,
  evaluateEvolutionEligibility,
  planEvolutionPaths,
  rankEvolutionAlternatives,
  scanClubEvolutionCandidates,
  scoreEvolutionRole,
  selectDiverseEvolutionAlternatives,
} from "../src/application/index.js";

const state = (overrides = {}) => ({
  overall: 70,
  attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
  positions: ["CM"],
  roles: ["box_to_box"],
  playstyles: ["technical"],
  playstylePlus: [],
  rarity: "gold",
  eligibilityTags: ["base"],
  appliedEvolutions: [],
  ...overrides,
});
const evolution = (edgeKey, value = 75, eligibility = {}) => ({
  edgeKey,
  verification: { state: "VERIFIED", evidenceFingerprint: `evidence:${edgeKey}` },
  eligibility: {
    positionsAnyOf: [], positionsAllOf: [], rolesAllOf: [], playstylesAllOf: [],
    playstylePlusAllOf: [], raritiesAnyOf: [], eligibilityTagsAllOf: [],
    excludedEligibilityTags: [], overall: { min: null, max: null }, attributes: [],
    ...eligibility,
  },
  transformation: {
    overall: { operation: "MAX", value, cap: null },
    attributes: [{ attribute: "passing", operation: "MAX", value, cap: null }],
    addPositions: [], addRoles: [], addPlaystyles: [], addPlaystylePlus: [],
    addEligibilityTags: [], removeEligibilityTags: [], setRarity: null,
  },
});
const objective = {
  roleKey: "role.cm",
  dimensions: [{ dimension: "OVERALL", direction: EvolutionObjectiveDirection.MAXIMIZE }],
  desiredPositions: ["CM"], desiredRoles: ["box_to_box"], desiredPlaystyles: [],
  desiredPlaystylePlus: [], desiredEligibilityTags: [],
};

test("public eligibility returns stable reasons and simulator is immutable/versioned", () => {
  const edge = evolution("passing", 75, {
    positionsAnyOf: ["CAM"],
    overall: { min: null, max: 69 },
  });
  const eligibility = evaluateEvolutionEligibility({ playerState: state(), evolution: edge });
  assert.equal(eligibility.eligible, false);
  assert.deepEqual(eligibility.reasons.map(({ code }) => code), [
    EvolutionEligibilityReason.POSITION_ANY_OF_MISSING,
    EvolutionEligibilityReason.OVERALL_ABOVE_MAXIMUM,
  ]);

  const input = state();
  const output = applyEvolution({ playerState: input, evolution: evolution("valid", 75) });
  assert.equal(input.overall, 70);
  assert.equal(output.overall, 75);
  assert.equal(Object.isFrozen(output), true);
  assert.throws(
    () => applyEvolution({ playerState: input, evolution: evolution("valid", 75), rulesVersion: "unknown" }),
    { code: "INVALID_TRANSFORMATION" },
  );
});

test("role scores are transparent and named result modes stay deterministic", () => {
  const role = scoreEvolutionRole(state({
    attributes: { pace: 80, shooting: 90, passing: 70, dribbling: 80, defending: 20, physical: 60 },
  }), "ST");
  assert.equal(role.profileKind, "FUT_MAGIC_PRODUCT_PREFERENCE_V1");
  assert.equal(role.contributions.find(({ attribute }) => attribute === "shooting").weight, 4);
  assert.equal(role.contributions.reduce((sum, entry) => sum + entry.contribution, 0) / 10, role.score);

  const result = planEvolutionPaths({
    playerState: state(),
    edges: [evolution("low", 72), evolution("high", 78)],
    objective,
  });
  const ranked = rankEvolutionAlternatives({ result, mode: EvolutionResultMode.BEST_FINAL_OVR });
  assert.equal(ranked[0].finalState.overall, 78);
});

test("shortest strong path keeps strength ahead of a negligible shorter result", () => {
  const result = {
    baseline: { overall: 70 },
    alternatives: [
      { path: ["weak"], pathFingerprint: "weak", finalState: state({ overall: 71 }) },
      { path: ["strong-a", "strong-b"], pathFingerprint: "strong", finalState: state({ overall: 95 }) },
    ],
  };
  const ranked = rankEvolutionAlternatives({
    result,
    mode: EvolutionResultMode.SHORTEST_STRONG_PATH,
  });
  assert.equal(ranked[0].pathFingerprint, "strong");
});

test("diversity collapses strategically equivalent outcomes", () => {
  const base = {
    rank: 1,
    path: ["a"],
    pathFingerprint: "a",
    finalState: state({ overall: 75 }),
  };
  const alternatives = [
    base,
    { ...base, rank: 2, path: ["b"], pathFingerprint: "b", finalState: state({ overall: 75, appliedEvolutions: ["b"] }) },
    { ...base, rank: 3, path: ["c"], pathFingerprint: "c", finalState: state({ overall: 80, roles: ["playmaker"] }) },
  ];
  const selected = selectDiverseEvolutionAlternatives(alternatives, { topResults: 3, maxPerOutcome: 1 });
  assert.deepEqual(selected.map(({ pathFingerprint }) => pathFingerprint), ["a", "c"]);
});

test("club scan is generation-bound, bounded and identifier-free", async () => {
  const candidates = [
    { candidateKey: "candidate:b", evidenceState: "verified", inventoryGeneration: 4, playerState: state({ overall: 71 }) },
    { candidateKey: "candidate:a", evidenceState: "verified", inventoryGeneration: 4, playerState: state({ overall: 70 }) },
  ];
  const scan = await scanClubEvolutionCandidates({
    inventoryGeneration: 4,
    catalogFingerprint: "catalog:verified",
    candidates,
    edges: [evolution("upgrade", 80)],
    objective,
    mode: EvolutionResultMode.BEST_FINAL_OVR,
  });
  assert.equal(scan.status, "complete");
  assert.equal(scan.readOnly, true);
  assert.equal(scan.canExecute, false);
  assert.doesNotMatch(JSON.stringify(scan), /itemId|resourceId|definitionId/);

  const stale = await scanClubEvolutionCandidates({
    inventoryGeneration: 5,
    catalogFingerprint: "catalog:verified",
    candidates,
    edges: [evolution("upgrade", 80)],
    objective,
  });
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.results, []);
});

test("club scan yields for cancellation and enforces one aggregate budget", async () => {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    candidateKey: `candidate:${index}`,
    evidenceState: "verified",
    inventoryGeneration: 4,
    playerState: state(),
  }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  const aborted = await scanClubEvolutionCandidates({
    inventoryGeneration: 4,
    catalogFingerprint: "catalog:verified",
    candidates,
    edges: [evolution("upgrade", 80)],
    objective,
    signal: controller.signal,
  });
  assert.equal(aborted.status, "aborted");
  assert.deepEqual(aborted.results, []);

  const bounded = await scanClubEvolutionCandidates({
    inventoryGeneration: 4,
    catalogFingerprint: "catalog:verified",
    candidates: candidates.slice(0, 2),
    edges: [],
    objective,
    scanLimits: { maxTotalNodes: 1, maxTotalEdgeEvaluations: 10 },
  });
  assert.equal(bounded.status, "bounded");
  assert.equal(bounded.reason, "CLUB_SCAN_AGGREGATE_BOUND");
  assert.deepEqual(bounded.results, []);
});
