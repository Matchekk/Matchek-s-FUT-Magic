import test from "node:test";
import assert from "node:assert/strict";

import {
  EvolutionBeamStatus,
  EvolutionResultMode,
  beamSearchEvolutionPaths,
  evaluateEvolutionEligibility,
  applyEvolution,
} from "../src/application/index.js";

const state = {
  overall: 70,
  attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
  positions: ["CM"], roles: ["box_to_box"], playstyles: [], playstylePlus: [],
  rarity: "gold", eligibilityTags: ["base"], appliedEvolutions: [],
};
const edge = (edgeKey, overall) => ({
  edgeKey,
  verification: { state: "VERIFIED", evidenceFingerprint: `evidence:${edgeKey}` },
  eligibility: {
    positionsAnyOf: [], positionsAllOf: [], rolesAllOf: [], playstylesAllOf: [],
    playstylePlusAllOf: [], raritiesAnyOf: [], eligibilityTagsAllOf: [],
    excludedEligibilityTags: [], overall: { min: null, max: null }, attributes: [],
  },
  transformation: {
    overall: { operation: "MAX", value: overall, cap: null }, attributes: [],
    addPositions: [], addRoles: [], addPlaystyles: [], addPlaystylePlus: [],
    addEligibilityTags: [edgeKey], removeEligibilityTags: [], setRarity: null,
  },
});

test("beam search prunes deterministically and never claims global completeness", () => {
  const edges = [edge("low", 72), edge("mid", 75), edge("high", 78)];
  const first = beamSearchEvolutionPaths({
    playerState: state,
    edges,
    maxDepth: 2,
    beamWidth: 1,
    topResults: 2,
    mode: EvolutionResultMode.BEST_FINAL_OVR,
  });
  const second = beamSearchEvolutionPaths({
    playerState: state,
    edges: [...edges].reverse(),
    maxDepth: 2,
    beamWidth: 1,
    topResults: 2,
    mode: EvolutionResultMode.BEST_FINAL_OVR,
  });
  assert.deepEqual(first, second);
  assert.equal(first.status, EvolutionBeamStatus.HEURISTIC_COMPLETE);
  assert.equal(first.searchComplete, false);
  assert.equal(first.globallyOptimal, false);
  assert.ok(first.explored.prunedCount > 0);
  assert.ok(first.results.length <= 2);
});

test("every beam result replays eligibility step by step", () => {
  const edges = [edge("one", 74), edge("two", 78)];
  const result = beamSearchEvolutionPaths({ playerState: state, edges, maxDepth: 2, beamWidth: 4 });
  const byKey = new Map(edges.map((entry) => [entry.edgeKey, entry]));
  for (const alternative of result.results) {
    let current = state;
    const history = [];
    for (const edgeKey of alternative.path) {
      const evolution = byKey.get(edgeKey);
      assert.equal(evaluateEvolutionEligibility({ playerState: current, evolution, pathHistory: history }).eligible, true);
      current = applyEvolution({ playerState: current, evolution, pathHistory: history });
      history.push(edgeKey);
    }
    assert.deepEqual(current, alternative.finalState);
  }
});

test("hard node/evaluation bounds fail closed with no partial results", () => {
  const bounded = beamSearchEvolutionPaths({
    playerState: state,
    edges: [edge("one", 74), edge("two", 78)],
    maxDepth: 4,
    beamWidth: 4,
    maxNodes: 1,
  });
  assert.equal(bounded.status, EvolutionBeamStatus.BOUNDED);
  assert.deepEqual(bounded.results, []);
});
