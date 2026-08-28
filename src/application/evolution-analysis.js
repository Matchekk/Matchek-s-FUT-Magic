import { cloneAndFreeze, stableFingerprint } from "./immutable.js";
import {
  EVOLUTION_PLANNER_LIMITS,
  EvolutionSearchStatus,
  normalizeEvolutionPlayerState,
  planEvolutionPaths,
} from "./evolution-planner.js";

export const EvolutionResultMode = Object.freeze({
  BEST_FINAL_OVR: "BEST_FINAL_OVR",
  BIGGEST_UPGRADE: "BIGGEST_UPGRADE",
  SHORTEST_STRONG_PATH: "SHORTEST_STRONG_PATH",
  BEST_FOR_ROLE: "BEST_FOR_ROLE",
});

export const FUT_MAGIC_ROLE_PROFILES_V1 = Object.freeze({
  ST: Object.freeze({ pace: 2, shooting: 4, passing: 1, dribbling: 2, defending: 0, physical: 1 }),
  CAM: Object.freeze({ pace: 1, shooting: 2, passing: 3, dribbling: 3, defending: 0, physical: 1 }),
  RW: Object.freeze({ pace: 3, shooting: 2, passing: 2, dribbling: 3, defending: 0, physical: 0 }),
  LW: Object.freeze({ pace: 3, shooting: 2, passing: 2, dribbling: 3, defending: 0, physical: 0 }),
  CM: Object.freeze({ pace: 1, shooting: 1, passing: 3, dribbling: 2, defending: 2, physical: 1 }),
  CDM: Object.freeze({ pace: 1, shooting: 0, passing: 2, dribbling: 1, defending: 4, physical: 2 }),
  CB: Object.freeze({ pace: 1, shooting: 0, passing: 1, dribbling: 0, defending: 5, physical: 3 }),
  LB: Object.freeze({ pace: 3, shooting: 0, passing: 2, dribbling: 1, defending: 3, physical: 1 }),
  RB: Object.freeze({ pace: 3, shooting: 0, passing: 2, dribbling: 1, defending: 3, physical: 1 }),
  GK: Object.freeze({ pace: 0, shooting: 0, passing: 1, dribbling: 0, defending: 5, physical: 4 }),
});

export function scoreEvolutionRole(playerState, roleKey) {
  const state = normalizeEvolutionPlayerState(playerState);
  const profile = FUT_MAGIC_ROLE_PROFILES_V1[String(roleKey).toUpperCase()];
  if (!profile) throw new TypeError(`Unsupported FUT Magic role profile: ${String(roleKey)}`);
  const contributions = Object.entries(profile).map(([attribute, weight]) => ({
    attribute,
    value: state.attributes[attribute],
    weight,
    contribution: state.attributes[attribute] * weight,
  }));
  const totalWeight = contributions.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedTotal = contributions.reduce((sum, entry) => sum + entry.contribution, 0);
  return cloneAndFreeze({
    schemaVersion: 1,
    roleKey: String(roleKey).toUpperCase(),
    score: totalWeight ? weightedTotal / totalWeight : 0,
    contributions,
    profileKind: "FUT_MAGIC_PRODUCT_PREFERENCE_V1",
  });
}

export function scoreEvolutionResult({ playerState, pathLength, baselineOverall, mode, roleKey = null } = {}) {
  const state = normalizeEvolutionPlayerState(playerState);
  const length = Number(pathLength);
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("Evolution path length is invalid");
  if (!Object.values(EvolutionResultMode).includes(mode)) throw new TypeError("Evolution result mode is unsupported");
  if (mode === EvolutionResultMode.BEST_FOR_ROLE) return scoreEvolutionRole(state, roleKey).score;
  if (mode === EvolutionResultMode.BIGGEST_UPGRADE) return state.overall - Number(baselineOverall || 0);
  if (mode === EvolutionResultMode.SHORTEST_STRONG_PATH) return state.overall * 100 - length;
  return state.overall;
}

const outcomeSignature = (alternative) => stableFingerprint({
  overall: alternative.finalState.overall,
  attributes: Object.fromEntries(Object.entries(alternative.finalState.attributes)
    .map(([key, value]) => [key, Math.floor(value / 3)])),
  roles: alternative.finalState.roles,
  playstyles: alternative.finalState.playstyles,
  playstylePlus: alternative.finalState.playstylePlus,
});

export function selectDiverseEvolutionAlternatives(alternatives = [], { topResults = 5, maxPerOutcome = 1 } = {}) {
  if (!Array.isArray(alternatives)) throw new TypeError("Evolution alternatives must be an array");
  if (!Number.isSafeInteger(topResults) || topResults < 1 || topResults > 20) throw new TypeError("topResults must be between 1 and 20");
  if (!Number.isSafeInteger(maxPerOutcome) || maxPerOutcome < 1 || maxPerOutcome > 5) throw new TypeError("maxPerOutcome must be between 1 and 5");
  const counts = new Map();
  const selected = [];
  for (const alternative of [...alternatives].sort((left, right) => left.rank - right.rank || left.pathFingerprint.localeCompare(right.pathFingerprint))) {
    const signature = outcomeSignature(alternative);
    if ((counts.get(signature) ?? 0) >= maxPerOutcome) continue;
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
    selected.push({ ...alternative, diversitySignature: signature });
    if (selected.length >= topResults) break;
  }
  return cloneAndFreeze(selected);
}

export function rankEvolutionAlternatives({ result, mode, roleKey = null, topResults = 5 } = {}) {
  if (!result || !Array.isArray(result.alternatives)) throw new TypeError("Evolution planner result is required");
  if (!Object.values(EvolutionResultMode).includes(mode)) throw new TypeError("Evolution result mode is unsupported");
  const baselineOverall = Number(result.baseline?.overall ?? result.baseline?.state?.overall ?? 0);
  const scored = result.alternatives.map((alternative) => {
    const role = mode === EvolutionResultMode.BEST_FOR_ROLE
      ? scoreEvolutionRole(alternative.finalState, roleKey)
      : null;
    const primary = scoreEvolutionResult({
      playerState: alternative.finalState,
      pathLength: alternative.path.length,
      baselineOverall,
      mode,
      roleKey,
    });
    return { alternative, primary, role };
  }).sort((left, right) =>
    right.primary - left.primary ||
    right.alternative.finalState.overall - left.alternative.finalState.overall ||
    left.alternative.path.length - right.alternative.path.length ||
    left.alternative.pathFingerprint.localeCompare(right.alternative.pathFingerprint),
  );
  return cloneAndFreeze(scored.slice(0, topResults).map((entry, index) => ({
    rank: index + 1,
    mode,
    primaryScore: entry.primary,
    roleScore: entry.role,
    path: entry.alternative.path,
    finalState: entry.alternative.finalState,
    pathFingerprint: entry.alternative.pathFingerprint,
  })));
}

export async function scanClubEvolutionCandidates({
  inventoryGeneration,
  catalogFingerprint,
  candidates,
  edges,
  objective,
  limits = {},
  mode = EvolutionResultMode.BEST_FINAL_OVR,
  roleKey = null,
  topResults = 10,
  signal = null,
  scanLimits = {},
} = {}) {
  if (!Number.isSafeInteger(inventoryGeneration) || inventoryGeneration < 0) throw new TypeError("Inventory generation is required");
  if (typeof catalogFingerprint !== "string" || !catalogFingerprint) throw new TypeError("Catalog fingerprint is required");
  if (!Array.isArray(candidates) || candidates.length > 250) throw new TypeError("Club scan supports at most 250 candidates");
  const maxTotalNodes = Number(scanLimits.maxTotalNodes ?? 4_000);
  const maxTotalEdgeEvaluations = Number(scanLimits.maxTotalEdgeEvaluations ?? 50_000);
  if (!Number.isSafeInteger(maxTotalNodes) || maxTotalNodes < 1 || maxTotalNodes > 20_000) {
    throw new TypeError("Club scan maxTotalNodes must be between 1 and 20000");
  }
  if (!Number.isSafeInteger(maxTotalEdgeEvaluations) || maxTotalEdgeEvaluations < 1 || maxTotalEdgeEvaluations > 250_000) {
    throw new TypeError("Club scan maxTotalEdgeEvaluations must be between 1 and 250000");
  }
  const results = [];
  let totalNodes = 0;
  let totalEdgeEvaluations = 0;
  for (const candidate of [...candidates].sort((left, right) => String(left.candidateKey).localeCompare(String(right.candidateKey)))) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) return cloneAndFreeze({ status: "aborted", readOnly: true, canExecute: false, results: [] });
    if (
      typeof candidate?.candidateKey !== "string" || !candidate.candidateKey ||
      candidate.evidenceState !== "verified" ||
      candidate.inventoryGeneration !== inventoryGeneration
    ) {
      return cloneAndFreeze({ status: "stale", reason: "CANDIDATE_EVIDENCE_STALE", readOnly: true, canExecute: false, results: [] });
    }
    const remainingNodes = maxTotalNodes - totalNodes;
    const remainingEdgeEvaluations = maxTotalEdgeEvaluations - totalEdgeEvaluations;
    if (remainingNodes < 1 || remainingEdgeEvaluations < 1) {
      return cloneAndFreeze({ status: "bounded", reason: "CLUB_SCAN_AGGREGATE_BOUND", readOnly: true, canExecute: false, results: [] });
    }
    const plan = planEvolutionPaths({
      playerState: candidate.playerState,
      edges,
      objective,
      limits: {
        ...limits,
        maxNodes: Math.min(Number(limits.maxNodes ?? EVOLUTION_PLANNER_LIMITS.maxNodes), remainingNodes),
        maxEdgeEvaluations: Math.min(
          Number(limits.maxEdgeEvaluations ?? EVOLUTION_PLANNER_LIMITS.maxEdgeEvaluations),
          remainingEdgeEvaluations,
        ),
      },
    });
    totalNodes += plan.explored.nodeCount;
    totalEdgeEvaluations += plan.explored.edgeEvaluationCount;
    if (signal?.aborted) return cloneAndFreeze({ status: "aborted", readOnly: true, canExecute: false, results: [] });
    if (plan.searchStatus === EvolutionSearchStatus.BOUNDED) {
      return cloneAndFreeze({ status: "bounded", reason: plan.boundReason, readOnly: true, canExecute: false, results: [] });
    }
    if (plan.searchStatus === EvolutionSearchStatus.NO_VERIFIED_PATH) continue;
    const [best] = rankEvolutionAlternatives({ result: plan, mode, roleKey, topResults: 1 });
    if (best) results.push({ candidateKey: candidate.candidateKey, result: best });
  }
  results.sort((left, right) =>
    right.result.primaryScore - left.result.primaryScore ||
    left.candidateKey.localeCompare(right.candidateKey),
  );
  return cloneAndFreeze({
    schemaVersion: 1,
    status: "complete",
    readOnly: true,
    canExecute: false,
    inventoryGeneration,
    catalogFingerprint,
    explored: { totalNodes, totalEdgeEvaluations },
    results: results.slice(0, topResults),
  });
}
