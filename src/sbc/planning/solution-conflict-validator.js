import { normalizeIdentifier } from "../../inventory/item-model.js";

export const SolutionConflictCode = Object.freeze({
  OWNED_ITEM_REUSED: "OWNED_ITEM_REUSED",
  INVALID_ITEM_REFERENCE: "INVALID_ITEM_REFERENCE",
  PROTECTED_ITEM_USAGE: "PROTECTED_ITEM_USAGE",
  CONFLICTING_RESERVATION: "CONFLICTING_RESERVATION",
  STALE_INVENTORY_REFERENCE: "STALE_INVENTORY_REFERENCE",
  STALE_PROJECT_REFERENCE: "STALE_PROJECT_REFERENCE",
  HARD_REQUIREMENT_FAILED: "HARD_REQUIREMENT_FAILED",
});

const frozenResult = (conflicts) => Object.freeze({
  valid: conflicts.length === 0,
  conflicts: Object.freeze(conflicts.map((entry) => Object.freeze(entry))),
  codes: Object.freeze([...new Set(conflicts.map(({ code }) => code))]),
});

const candidateIds = (candidate) => (Array.isArray(candidate?.ownedItemIds)
  ? candidate.ownedItemIds.map((itemId) => normalizeIdentifier(itemId, { required: true, name: "itemId" }))
  : []);

export function validateSolutionCandidate({
  candidate,
  inventorySnapshot,
  reservationSnapshot = { reservations: [] },
  protectionSnapshot = { protectedItemIds: [] },
} = {}) {
  const conflicts = [];
  const ids = candidateIds(candidate);
  if (new Set(ids).size !== ids.length) {
    conflicts.push({ code: SolutionConflictCode.OWNED_ITEM_REUSED, candidateId: candidate?.candidateId ?? null });
  }
  if (!inventorySnapshot || !Array.isArray(inventorySnapshot.items)) {
    conflicts.push({ code: SolutionConflictCode.STALE_INVENTORY_REFERENCE });
    return frozenResult(conflicts);
  }
  if (
    candidate?.inventoryGeneration != null &&
    candidate.inventoryGeneration !== inventorySnapshot.generation
  ) {
    conflicts.push({ code: SolutionConflictCode.STALE_INVENTORY_REFERENCE });
  }
  if (
    candidate?.inventoryFingerprint != null && inventorySnapshot.fingerprint != null &&
    candidate.inventoryFingerprint !== inventorySnapshot.fingerprint
  ) {
    conflicts.push({ code: SolutionConflictCode.STALE_INVENTORY_REFERENCE });
  }
  const inventoryIds = new Set(inventorySnapshot.items.map(({ itemId }) => String(itemId)));
  const protectedIds = new Set((protectionSnapshot.protectedItemIds ?? []).map(String));
  const reservations = new Map((reservationSnapshot.reservations ?? []).map((entry) => [
    String(entry?.itemRef?.itemId ?? ""), entry,
  ]));
  for (const itemId of ids) {
    if (!inventoryIds.has(itemId)) {
      conflicts.push({ code: SolutionConflictCode.INVALID_ITEM_REFERENCE, itemId });
    }
    if (protectedIds.has(itemId)) {
      conflicts.push({ code: SolutionConflictCode.PROTECTED_ITEM_USAGE, itemId });
    }
    const reserved = reservations.get(itemId);
    if (reserved && reserved.candidateId !== candidate?.candidateId) {
      conflicts.push({
        code: SolutionConflictCode.CONFLICTING_RESERVATION,
        itemId,
        candidateId: reserved.candidateId,
      });
    }
  }
  if (candidate?.hardRequirementsSatisfied !== true) {
    conflicts.push({ code: SolutionConflictCode.HARD_REQUIREMENT_FAILED, candidateId: candidate?.candidateId ?? null });
  }
  return frozenResult(conflicts);
}

export function validateProjectPlan({
  plan,
  inventorySnapshot,
  projectSnapshot,
  protectionSnapshot = { protectedItemIds: [] },
} = {}) {
  const conflicts = [];
  const hasFingerprint = (value) => typeof value === "string" && value.length > 0;
  if (
    plan?.inventoryGeneration !== inventorySnapshot?.generation ||
    !hasFingerprint(plan?.inventoryFingerprint) ||
    !hasFingerprint(inventorySnapshot?.fingerprint) ||
    plan.inventoryFingerprint !== inventorySnapshot.fingerprint
  ) {
    conflicts.push({ code: SolutionConflictCode.STALE_INVENTORY_REFERENCE });
  }
  if (
    typeof plan?.projectId !== "string" || !plan.projectId ||
    typeof projectSnapshot?.projectId !== "string" || !projectSnapshot.projectId ||
    plan.projectId !== projectSnapshot.projectId ||
    plan?.projectGeneration !== projectSnapshot?.generation ||
    !hasFingerprint(plan?.projectFingerprint) ||
    !hasFingerprint(projectSnapshot?.fingerprint) ||
    plan.projectFingerprint !== projectSnapshot.fingerprint
  ) {
    conflicts.push({ code: SolutionConflictCode.STALE_PROJECT_REFERENCE });
  }
  const seen = new Map();
  for (const candidate of plan?.allocations ?? []) {
    const validation = validateSolutionCandidate({
      candidate,
      inventorySnapshot,
      protectionSnapshot,
    });
    conflicts.push(...validation.conflicts);
    for (const itemId of candidateIds(candidate)) {
      if (seen.has(itemId)) {
        conflicts.push({
          code: SolutionConflictCode.OWNED_ITEM_REUSED,
          itemId,
          challengeIds: [seen.get(itemId), candidate.challengeId],
        });
      } else {
        seen.set(itemId, candidate.challengeId);
      }
    }
  }
  return frozenResult(conflicts);
}
