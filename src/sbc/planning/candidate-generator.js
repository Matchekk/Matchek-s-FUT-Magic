export class SquadCandidateGenerator {
  async generate(_request) {
    throw new Error("SquadCandidateGenerator.generate() is not implemented");
  }
}

const candidateIdFor = (challengeId, ownedItemIds) => {
  const input = `${challengeId}:${[...ownedItemIds].sort().join(",")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `candidate-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

/** Produces one honest local candidate through the existing verified solver. */
export class ExistingSolverCandidateGenerator extends SquadCandidateGenerator {
  constructor({ solver } = {}) {
    super();
    if (!solver?.solve) throw new TypeError("ExistingSolverCandidateGenerator requires a solver");
    this.solver = solver;
  }

  async generate({
    challengeSnapshot,
    inventorySnapshot,
    projectSnapshot,
    policySnapshot = {},
    excludedOwnedItemIds = [],
    maxCandidates = 1,
    signal = null,
  } = {}) {
    if (signal?.aborted) return [];
    if (maxCandidates !== 1) {
      throw new TypeError("The current local solver candidate generator supports exactly one candidate");
    }
    if (
      !challengeSnapshot?.challengeId || challengeSnapshot.evidenceState !== "verified" ||
      challengeSnapshot.requirementsKnown !== true ||
      !Array.isArray(challengeSnapshot.requirementsNormalized) ||
      !Number.isSafeInteger(challengeSnapshot.requiredPlayers) ||
      challengeSnapshot.requiredPlayers < 1 || challengeSnapshot.requiredPlayers > 11 ||
      typeof challengeSnapshot.fingerprint !== "string" || !challengeSnapshot.fingerprint
    ) {
      throw new TypeError("A verified challenge snapshot with normalized requirements is required");
    }
    if (!inventorySnapshot || !Array.isArray(inventorySnapshot.items)) {
      throw new TypeError("A complete inventory snapshot is required");
    }
    const excluded = [...new Set(excludedOwnedItemIds.map(String))].sort();
    const result = await this.solver.solve({
      players: inventorySnapshot.items,
      requirementsNormalized: challengeSnapshot.requirementsNormalized,
      filters: {
        ...(policySnapshot.filters ?? {}),
        excludedPlayerIds: [...new Set([
          ...(policySnapshot.filters?.excludedPlayerIds ?? []).map(String),
          ...excluded,
        ])],
      },
      fodderPolicy: policySnapshot.fodderPolicy ?? {},
      targetProjects: policySnapshot.targetProjects ?? [],
      prioritize: policySnapshot.prioritize ?? {},
    });
    const ownedItemIds = Array.isArray(result?.solutions?.[0])
      ? result.solutions[0].map(String)
      : [];
    if (
      result?.stats?.solved !== true ||
      result?.stats?.submitReady !== true ||
      ownedItemIds.length !== challengeSnapshot.requiredPlayers ||
      (result?.failingRequirements?.length ?? 0) > 0
    ) {
      return [];
    }
    if (ownedItemIds.some((itemId) => excluded.includes(itemId))) {
      throw new TypeError("Solver returned a previously reserved owned item");
    }
    return [Object.freeze({
      candidateId: candidateIdFor(challengeSnapshot.challengeId, ownedItemIds),
      challengeId: String(challengeSnapshot.challengeId),
      projectId: String(projectSnapshot?.projectId ?? "local-set"),
      ownedItemIds: Object.freeze(ownedItemIds),
      conceptRefs: Object.freeze([]),
      submitReady: true,
      hardRequirementsSatisfied: true,
      inventoryGeneration: inventorySnapshot.generation,
      inventoryFingerprint: inventorySnapshot.fingerprint ?? null,
      challengeFingerprint: challengeSnapshot.fingerprint ?? null,
      policyFingerprint: policySnapshot.fingerprint ?? null,
      objectiveFields: Object.freeze(result?.policy?.objectiveFields ?? []),
      objectiveTuple: Object.freeze(result?.policy?.objectiveTuple ?? []),
    })];
  }
}

export function validateGeneratedCandidate(candidate, {
  challengeId,
  challengeFingerprint,
  requiredPlayers,
} = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("Generated candidate must be an object");
  }
  if (String(candidate.challengeId ?? "") !== String(challengeId ?? "")) {
    throw new TypeError("Generated candidate does not match the requested challenge");
  }
  if (!Number.isSafeInteger(requiredPlayers) || requiredPlayers < 1 || requiredPlayers > 11) {
    throw new TypeError("A verified required-player count is required");
  }
  if (!Array.isArray(candidate.ownedItemIds) || candidate.ownedItemIds.length !== requiredPlayers) {
    throw new TypeError(`Generated candidate must contain exactly ${requiredPlayers} owned items`);
  }
  if (candidate.submitReady !== true || candidate.hardRequirementsSatisfied !== true) {
    throw new TypeError("Generated candidate is not independently submit-ready");
  }
  if (
    typeof challengeFingerprint !== "string" || !challengeFingerprint ||
    candidate.challengeFingerprint !== challengeFingerprint
  ) {
    throw new TypeError("Generated candidate challenge evidence is stale");
  }
  const ids = candidate.ownedItemIds.map(String);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Generated candidate reuses an owned item");
  }
  return Object.freeze({
    ...candidate,
    candidateId: String(candidate.candidateId),
    challengeId: String(candidate.challengeId),
    projectId: String(candidate.projectId),
    ownedItemIds: Object.freeze(ids),
    conceptRefs: Object.freeze((candidate.conceptRefs ?? []).map(String)),
    hardRequirementsSatisfied: candidate.hardRequirementsSatisfied === true,
  });
}
