import { ReservationLedger } from "./reservation-ledger.js";
import { validateGeneratedCandidate } from "./candidate-generator.js";
import {
  SolutionConflictCode,
  validateProjectPlan,
  validateSolutionCandidate,
} from "./solution-conflict-validator.js";

export const SequentialPlanStatus = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  BLOCKED: "blocked",
  STALE: "stale",
});

const freeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
  }
  return value;
};

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const smallFingerprint = (value) => {
  const text = canonical(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `plan-${(hash >>> 0).toString(16)}`;
};

export class SequentialSetPlanner {
  constructor({ candidateGenerator, maxChallenges = 50 } = {}) {
    if (!candidateGenerator?.generate) throw new TypeError("SequentialSetPlanner requires a candidate generator");
    if (!Number.isSafeInteger(maxChallenges) || maxChallenges < 1 || maxChallenges > 100) {
      throw new TypeError("maxChallenges must be between 1 and 100");
    }
    this.candidateGenerator = candidateGenerator;
    this.maxChallenges = maxChallenges;
  }

  async plan({
    projectSnapshot,
    inventorySnapshot,
    policySnapshot = {},
    protectionSnapshot = { protectedItemIds: [] },
    challengeSnapshots,
    signal = null,
  } = {}) {
    if (!projectSnapshot || !Number.isSafeInteger(projectSnapshot.generation)) {
      return freeze({ status: SequentialPlanStatus.STALE, reason: SolutionConflictCode.STALE_PROJECT_REFERENCE, allocations: [], canExecute: false });
    }
    if (!inventorySnapshot || !Number.isSafeInteger(inventorySnapshot.generation) || !Array.isArray(inventorySnapshot.items)) {
      return freeze({ status: SequentialPlanStatus.STALE, reason: SolutionConflictCode.STALE_INVENTORY_REFERENCE, allocations: [], canExecute: false });
    }
    if (!Array.isArray(challengeSnapshots) || challengeSnapshots.length === 0 || challengeSnapshots.length > this.maxChallenges) {
      return freeze({ status: SequentialPlanStatus.BLOCKED, reason: "INVALID_CHALLENGE_SET", allocations: [], canExecute: false });
    }
    const challenges = [...challengeSnapshots].sort(
      (left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || String(left.challengeId).localeCompare(String(right.challengeId)),
    );
    if (challenges.some((challenge) => !challenge?.challengeId || challenge.evidenceState !== "verified" || challenge.requirementsKnown !== true)) {
      return freeze({ status: SequentialPlanStatus.BLOCKED, reason: "UNKNOWN_CHALLENGE_REQUIREMENTS", allocations: [], canExecute: false });
    }

    const inventoryFingerprint = inventorySnapshot.fingerprint ?? smallFingerprint(
      inventorySnapshot.items.map(({ itemId, resourceId, location }) => ({ itemId, resourceId, location })),
    );
    const projectFingerprint = projectSnapshot.fingerprint ?? smallFingerprint(projectSnapshot);
    const inventoryBinding = freeze({
      generation: inventorySnapshot.generation,
      fingerprint: inventoryFingerprint,
    });
    const ledger = new ReservationLedger();
    const allocations = [];

    for (const challengeSnapshot of challenges) {
      if (signal?.aborted) {
        return freeze({ status: SequentialPlanStatus.BLOCKED, reason: "ABORTED", allocations, canExecute: false });
      }
      const generated = await this.candidateGenerator.generate({
        challengeSnapshot,
        inventorySnapshot,
        inventoryBinding,
        projectSnapshot,
        policySnapshot,
        excludedOwnedItemIds: ledger.reservedItemIds(),
        maxCandidates: 1,
        signal,
      });
      if (!Array.isArray(generated) || generated.length === 0) {
        return freeze({
          status: SequentialPlanStatus.INCOMPLETE,
          reason: "SEQUENTIAL_SEARCH_EXHAUSTED",
          allocations,
          reservationSnapshot: ledger.snapshot(),
          canExecute: false,
          globallyOptimal: false,
        });
      }
      const candidate = validateGeneratedCandidate({
        ...generated[0],
        projectId: projectSnapshot.projectId,
        inventoryGeneration: inventorySnapshot.generation,
        inventoryFingerprint,
      }, {
        challengeId: challengeSnapshot.challengeId,
        challengeFingerprint: challengeSnapshot.fingerprint,
        requiredPlayers: challengeSnapshot.requiredPlayers,
      });
      const validation = validateSolutionCandidate({
        candidate,
        inventorySnapshot: { ...inventorySnapshot, fingerprint: inventoryFingerprint },
        reservationSnapshot: ledger.snapshot(),
        protectionSnapshot,
      });
      if (!validation.valid) {
        return freeze({
          status: SequentialPlanStatus.BLOCKED,
          reason: validation.codes[0],
          conflicts: validation.conflicts,
          allocations,
          reservationSnapshot: ledger.snapshot(),
          canExecute: false,
          globallyOptimal: false,
        });
      }
      ledger.reserveCandidate(candidate);
      allocations.push(candidate);
    }

    const plan = {
      schemaVersion: 1,
      kind: "SEQUENTIAL_SET_PLAN_V1",
      status: SequentialPlanStatus.COMPLETE,
      projectId: String(projectSnapshot.projectId),
      projectGeneration: projectSnapshot.generation,
      projectFingerprint,
      inventoryGeneration: inventorySnapshot.generation,
      inventoryFingerprint,
      allocations,
      reservationSnapshot: ledger.snapshot(),
      canExecute: false,
      readOnly: true,
      globallyOptimal: false,
      explanationCode: "SEQUENTIAL_NOT_GLOBALLY_OPTIMIZED",
    };
    const finalValidation = validateProjectPlan({
      plan,
      inventorySnapshot: { ...inventorySnapshot, fingerprint: inventoryFingerprint },
      projectSnapshot: { ...projectSnapshot, fingerprint: projectFingerprint },
      protectionSnapshot,
    });
    if (!finalValidation.valid) {
      return freeze({
        ...plan,
        status: SequentialPlanStatus.BLOCKED,
        reason: finalValidation.codes[0],
        conflicts: finalValidation.conflicts,
      });
    }
    return freeze(plan);
  }
}
