import { cloneAndFreeze, stableFingerprint } from "./immutable.js";
import {
  applyEvolution,
  evaluateEvolutionEligibility,
  fingerprintEvolutionPlayerState,
  normalizeEvolutionPlayerState,
} from "./evolution-planner.js";
import {
  EvolutionResultMode,
  scoreEvolutionResult,
  selectDiverseEvolutionAlternatives,
} from "./evolution-analysis.js";

export const EvolutionBeamStatus = Object.freeze({
  HEURISTIC_COMPLETE: "HEURISTIC_COMPLETE",
  NO_VERIFIED_PATH: "NO_VERIFIED_PATH",
  BOUNDED: "BOUNDED",
});

const HARD = Object.freeze({ maxDepth: 8, beamWidth: 64, topResults: 20, maxNodes: 2000, maxEdgeEvaluations: 50_000, maxEdges: 512 });

const positiveInteger = (value, field, maximum, fallback) => {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`${field} must be between 1 and ${maximum}`);
  }
  return normalized;
};

const semanticFingerprint = (state) => stableFingerprint({
  overall: state.overall,
  attributes: state.attributes,
  positions: state.positions,
  roles: state.roles,
  playstyles: state.playstyles,
  playstylePlus: state.playstylePlus,
  rarity: state.rarity,
  eligibilityTags: state.eligibilityTags,
});

const score = (node, baseOverall, mode, roleKey) => {
  return scoreEvolutionResult({
    playerState: node.state,
    pathLength: node.path.length,
    baselineOverall: baseOverall,
    mode,
    roleKey,
  });
};

const compareNode = (baseOverall, mode, roleKey) => (left, right) =>
  score(right, baseOverall, mode, roleKey) - score(left, baseOverall, mode, roleKey) ||
  right.state.overall - left.state.overall ||
  left.path.length - right.path.length ||
  left.path.join("\u0000").localeCompare(right.path.join("\u0000"));

export function beamSearchEvolutionPaths({
  playerState,
  edges,
  mode = EvolutionResultMode.BEST_FINAL_OVR,
  roleKey = null,
  maxDepth = 4,
  beamWidth = 16,
  topResults = 5,
  maxNodes = 512,
  maxEdgeEvaluations = 10_000,
} = {}) {
  if (!Array.isArray(edges) || edges.length > HARD.maxEdges) throw new TypeError("Evolution edges exceed the beam-search bound");
  if (!Object.values(EvolutionResultMode).includes(mode)) throw new TypeError("Evolution result mode is unsupported");
  const limits = Object.freeze({
    maxDepth: positiveInteger(maxDepth, "maxDepth", HARD.maxDepth, 4),
    beamWidth: positiveInteger(beamWidth, "beamWidth", HARD.beamWidth, 16),
    topResults: positiveInteger(topResults, "topResults", HARD.topResults, 5),
    maxNodes: positiveInteger(maxNodes, "maxNodes", HARD.maxNodes, 512),
    maxEdgeEvaluations: positiveInteger(maxEdgeEvaluations, "maxEdgeEvaluations", HARD.maxEdgeEvaluations, 10_000),
  });
  const base = normalizeEvolutionPlayerState(playerState);
  const orderedEdges = [...edges].sort((left, right) => String(left.edgeKey).localeCompare(String(right.edgeKey)));
  let frontier = [{ state: base, path: [], semanticHistory: new Set([semanticFingerprint(base)]) }];
  const results = [];
  let nodeCount = 1;
  let edgeEvaluationCount = 0;
  let prunedCount = 0;

  for (let depth = 1; depth <= limits.maxDepth; depth += 1) {
    const next = [];
    const layerSeen = new Set();
    for (const node of frontier) {
      for (const evolution of orderedEdges) {
        edgeEvaluationCount += 1;
        if (edgeEvaluationCount > limits.maxEdgeEvaluations) {
          return cloneAndFreeze({ status: EvolutionBeamStatus.BOUNDED, reason: "EDGE_EVALUATION_BOUND", results: [], limits, explored: { nodeCount, edgeEvaluationCount: edgeEvaluationCount - 1, prunedCount }, readOnly: true, canExecute: false });
        }
        const eligibility = evaluateEvolutionEligibility({ playerState: node.state, evolution, pathHistory: node.path });
        if (!eligibility.eligible) continue;
        const state = applyEvolution({ playerState: node.state, evolution, pathHistory: node.path });
        const semantic = semanticFingerprint(state);
        if (node.semanticHistory.has(semantic)) continue;
        const fingerprint = fingerprintEvolutionPlayerState(state);
        if (layerSeen.has(fingerprint)) continue;
        layerSeen.add(fingerprint);
        nodeCount += 1;
        if (nodeCount > limits.maxNodes) {
          return cloneAndFreeze({ status: EvolutionBeamStatus.BOUNDED, reason: "NODE_BOUND", results: [], limits, explored: { nodeCount: nodeCount - 1, edgeEvaluationCount, prunedCount }, readOnly: true, canExecute: false });
        }
        next.push({
          state,
          path: [...node.path, evolution.edgeKey],
          semanticHistory: new Set([...node.semanticHistory, semantic]),
        });
      }
    }
    if (!next.length) break;
    next.sort(compareNode(base.overall, mode, roleKey));
    if (next.length > limits.beamWidth) prunedCount += next.length - limits.beamWidth;
    frontier = next.slice(0, limits.beamWidth);
    results.push(...frontier);
  }

  const alternatives = results.sort(compareNode(base.overall, mode, roleKey)).map((node, index) => ({
    rank: index + 1,
    path: node.path,
    finalState: node.state,
    pathFingerprint: stableFingerprint({ path: node.path, finalState: node.state }),
    primaryScore: score(node, base.overall, mode, roleKey),
  }));
  const diverse = selectDiverseEvolutionAlternatives(alternatives, {
    topResults: limits.topResults,
    maxPerOutcome: 1,
  });

  // Reapply every returned path through the public eligibility/simulator API.
  const edgeByKey = new Map(orderedEdges.map((edge) => [String(edge.edgeKey), edge]));
  for (const alternative of diverse) {
    let replay = base;
    const history = [];
    for (const edgeKey of alternative.path) {
      const evolution = edgeByKey.get(edgeKey);
      const eligibility = evaluateEvolutionEligibility({ playerState: replay, evolution, pathHistory: history });
      if (!eligibility.eligible) throw new TypeError("Beam result failed step-by-step eligibility replay");
      replay = applyEvolution({ playerState: replay, evolution, pathHistory: history });
      history.push(edgeKey);
    }
  }

  return cloneAndFreeze({
    schemaVersion: 1,
    strategy: "BOUNDED_BEAM_V1",
    status: diverse.length ? EvolutionBeamStatus.HEURISTIC_COMPLETE : EvolutionBeamStatus.NO_VERIFIED_PATH,
    searchComplete: false,
    globallyOptimal: false,
    readOnly: true,
    canExecute: false,
    mode,
    roleKey,
    limits,
    explored: { nodeCount, edgeEvaluationCount, prunedCount },
    results: diverse,
  });
}
