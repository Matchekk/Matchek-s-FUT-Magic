export const DuplicateRecycleStatus = Object.freeze({
  READY: "ready",
  BLOCKED: "blocked",
  EMPTY: "empty",
  STALE: "stale",
});

export const DuplicateRecycleReason = Object.freeze({
  NO_BLOCKING_DUPLICATES: "NO_BLOCKING_DUPLICATES",
  NO_VERIFIED_RECIPE: "NO_VERIFIED_RECIPE",
  DUPLICATE_NOT_ACCEPTED: "DUPLICATE_NOT_ACCEPTED",
  PROTECTED_ITEM_USAGE: "PROTECTED_ITEM_USAGE",
  ITEM_EVIDENCE_UNVERIFIED: "ITEM_EVIDENCE_UNVERIFIED",
  INVALID_SOLUTION_REFERENCE: "INVALID_SOLUTION_REFERENCE",
  STALE_INVENTORY: "STALE_INVENTORY",
  STALE_PROJECT: "STALE_PROJECT",
  ACTIVITY_GUARD_NOT_NORMAL: "ACTIVITY_GUARD_NOT_NORMAL",
});

const freeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
  }
  return value;
};

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value) => {
  const input = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export function fingerprintDuplicateRecycleInventory(snapshot = {}) {
  return fingerprint({
    storageCapacity: snapshot.storageCapacity ?? null,
    items: [...(snapshot.items ?? [])].map((item) => ({
      itemId: String(item.itemId ?? ""),
      resourceId: item.resourceId == null ? null : String(item.resourceId),
      definitionId: item.definitionId == null ? null : String(item.definitionId),
      location: String(item.location ?? ""),
      rating: Number(item.rating || 0),
      isTradable: item.isTradable ?? null,
      isDuplicate: item.isDuplicate ?? null,
      isLocked: item.isLocked ?? null,
      isProtected: item.isProtected ?? null,
      isInStartingSquad: item.isInStartingSquad ?? null,
      hasTradabilityEvidence: item.hasTradabilityEvidence ?? null,
      hasLockedEvidence: item.hasLockedEvidence ?? null,
      hasProtectedEvidence: item.hasProtectedEvidence ?? null,
      hasStartingSquadEvidence: item.hasStartingSquadEvidence ?? null,
      hasSpecialEvidence: item.hasSpecialEvidence ?? null,
    })).sort((left, right) => left.itemId.localeCompare(right.itemId)),
  });
}

export function fingerprintDuplicateRecycleProjects(projects = []) {
  return fingerprint([...(Array.isArray(projects) ? projects : [])]
    .map((project) => ({
      id: String(project?.id ?? ""),
      active: project?.active !== false,
      priority: Number(project?.priority || 0),
      requiredSquadsRemaining: Number(project?.requiredSquadsRemaining || 0),
      completionProgress: Number(project?.completionProgress || 0),
      sourceSetId: project?.sourceSetId == null ? null : String(project.sourceSetId),
      sourceChallengeIds: [...(project?.sourceChallengeIds ?? [])].map(String).sort(),
      sourceChallenges: [...(project?.sourceChallenges ?? [])].map((challenge) => ({
        id: String(challenge?.id ?? ""),
        completed: challenge?.completed === true,
        requiredSquadRating: challenge?.requiredSquadRating ?? null,
        specialCardRequirements: [...(challenge?.specialCardRequirements ?? [])]
          .map((entry) => ({
            cardType: String(entry?.cardType ?? ""),
            count: Number(entry?.count || 0),
            completed: Number(entry?.completed || 0),
            perRemainingSquad: entry?.perRemainingSquad === true,
          }))
          .sort((left, right) => left.cardType.localeCompare(right.cardType)),
        unknownRequirements: [...(challenge?.unknownRequirements ?? [])].map(String).sort(),
      })).sort((left, right) => left.id.localeCompare(right.id)),
      ratingRequirements: [...(project?.ratingRequirements ?? [])]
        .map((entry) => ({
          rating: Number(entry?.rating || 0),
          count: Number(entry?.count || 0),
          completed: Number(entry?.completed || 0),
        }))
        .sort((left, right) => left.rating - right.rating),
      specialCardRequirements: [...(project?.specialCardRequirements ?? [])]
        .map((entry) => ({
          cardType: String(entry?.cardType ?? ""),
          count: Number(entry?.count || 0),
          completed: Number(entry?.completed || 0),
          perRemainingSquad: entry?.perRemainingSquad === true,
        }))
        .sort((left, right) => left.cardType.localeCompare(right.cardType)),
      protectedPlayerIds: [...(project?.protectedPlayerIds ?? [])].map(String).sort(),
      protectedResourceIds: [...(project?.protectedResourceIds ?? [])].map(String).sort(),
      protectedRatings: project?.protectedRatings ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function fingerprintDuplicateRecycleRequirement({ setId, challenge } = {}) {
  return fingerprint({
    setId: setId == null ? null : String(setId),
    challengeId: challenge?.id == null ? null : String(challenge.id),
    completed: challenge?.completed === true,
    requiredSquadRating: challenge?.requiredSquadRating ?? null,
    specialCardRequirements: [...(challenge?.specialCardRequirements ?? [])]
      .map((entry) => ({
        cardType: String(entry?.cardType ?? ""),
        count: Number(entry?.count || 0),
        completed: Number(entry?.completed || 0),
        perRemainingSquad: entry?.perRemainingSquad === true,
      }))
      .sort((left, right) => left.cardType.localeCompare(right.cardType)),
    unknownRequirements: [...(challenge?.unknownRequirements ?? [])].map(String).sort(),
  });
}

export function fingerprintDuplicateRecycleCapabilities(capabilities = []) {
  return fingerprint([...(Array.isArray(capabilities) ? capabilities : [])]
    .map((entry) => ({
      id: String(entry?.id ?? "").trim().toLowerCase(),
      status: String(entry?.status ?? "UNKNOWN").trim().toUpperCase(),
    }))
    .filter((entry) => entry.id)
    .sort((left, right) => left.id.localeCompare(right.id)));
}

const integer = (value, fallback = 0) => Number.isSafeInteger(Number(value))
  ? Number(value)
  : fallback;

const normalizeTarget = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("Duplicate recipe candidate must be an object");
  }
  for (const field of ["targetId", "setId", "challengeId", "requirementsFingerprint", "capabilityFingerprint"]) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
      throw new TypeError(`Duplicate recipe ${field} is required`);
    }
  }
  const list = (field, max = 100) => {
    if (!Array.isArray(candidate[field]) || candidate[field].length > max) {
      throw new TypeError(`Duplicate recipe ${field} is invalid`);
    }
    const values = candidate[field].map(String);
    if (new Set(values).size !== values.length) throw new TypeError(`Duplicate recipe ${field} contains duplicates`);
    return values;
  };
  return freeze({
    targetId: candidate.targetId,
    name: String(candidate.name ?? candidate.targetId),
    setId: candidate.setId,
    challengeId: candidate.challengeId,
    evidenceState: candidate.evidenceState,
    requirementsKnown: candidate.requirementsKnown === true,
    repeatable: candidate.repeatable === true,
    acceptedItemIds: list("acceptedItemIds"),
    completeSolutionItemIds: list("completeSolutionItemIds", 11),
    hardProtectionViolations: integer(candidate.hardProtectionViolations, 1),
    projectDamage: Math.max(0, Number(candidate.projectDamage) || 0),
    extraFodderCost: Math.max(0, Number(candidate.extraFodderCost) || 0),
    replacementCost: Math.max(0, Number(candidate.replacementCost) || 0),
    rewardUtility: Math.max(0, Number(candidate.rewardUtility) || 0),
    storageImpact: Number(candidate.storageImpact) || 0,
    inventoryGeneration: integer(candidate.inventoryGeneration, -1),
    projectGeneration: integer(candidate.projectGeneration, -1),
    protectionFingerprint: String(candidate.protectionFingerprint ?? ""),
    requirementsFingerprint: candidate.requirementsFingerprint,
    capabilityFingerprint: candidate.capabilityFingerprint,
  });
};

const tupleFor = (candidate, blockingIds) => {
  const accepted = new Set(candidate.acceptedItemIds);
  const relieved = blockingIds.filter((itemId) => accepted.has(itemId)).length;
  return Object.freeze([
    candidate.evidenceState === "verified" && candidate.requirementsKnown ? 0 : 1,
    candidate.hardProtectionViolations,
    blockingIds.length - relieved,
    -relieved,
    candidate.projectDamage,
    candidate.extraFodderCost,
    candidate.replacementCost,
    -candidate.rewardUtility,
    candidate.repeatable ? 0 : 1,
  ]);
};

const compareTuple = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

export function scoreDuplicateRecycleTargets({ blockingItemIds = [], candidates = [] } = {}) {
  const blockingIds = [...new Set(blockingItemIds.map(String))].sort();
  return Object.freeze(candidates.map(normalizeTarget)
    .map((candidate) => Object.freeze({ candidate, objectiveTuple: tupleFor(candidate, blockingIds) }))
    .sort((left, right) =>
      compareTuple(left.objectiveTuple, right.objectiveTuple) ||
      left.candidate.targetId.localeCompare(right.candidate.targetId),
    ));
}

export function buildDuplicateRecyclePreview({
  inventorySnapshot,
  projectSnapshot,
  blockingItemIds = [],
  candidates = [],
  protectedItemIds = [],
  activityGuard = { state: "NORMAL" },
} = {}) {
  if (!inventorySnapshot || !Array.isArray(inventorySnapshot.items) || !Number.isSafeInteger(inventorySnapshot.generation)) {
    return freeze({ status: DuplicateRecycleStatus.STALE, reason: DuplicateRecycleReason.STALE_INVENTORY, canCompile: false });
  }
  if (!projectSnapshot || !Number.isSafeInteger(projectSnapshot.generation)) {
    return freeze({ status: DuplicateRecycleStatus.STALE, reason: DuplicateRecycleReason.STALE_PROJECT, canCompile: false });
  }
  const blockingIds = [...new Set(blockingItemIds.map(String))].sort();
  if (!blockingIds.length) {
    return freeze({ status: DuplicateRecycleStatus.EMPTY, reason: DuplicateRecycleReason.NO_BLOCKING_DUPLICATES, canCompile: false });
  }
  if (String(activityGuard.state).toUpperCase() !== "NORMAL") {
    return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.ACTIVITY_GUARD_NOT_NORMAL, canCompile: false });
  }
  const byId = new Map(inventorySnapshot.items.map((item) => [String(item.itemId), item]));
  const protectedIds = new Set(protectedItemIds.map(String));
  for (const itemId of blockingIds) {
    const item = byId.get(itemId);
    if (!item) return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.INVALID_SOLUTION_REFERENCE, canCompile: false });
    if (protectedIds.has(itemId)) return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.PROTECTED_ITEM_USAGE, canCompile: false });
    if ([
      "hasTradabilityEvidence", "hasLockedEvidence", "hasProtectedEvidence",
      "hasStartingSquadEvidence", "hasSpecialEvidence",
    ].some((field) => item[field] !== true)) {
      return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.ITEM_EVIDENCE_UNVERIFIED, canCompile: false });
    }
  }

  const scored = scoreDuplicateRecycleTargets({ blockingItemIds: blockingIds, candidates });
  const selected = scored.find(({ candidate, objectiveTuple }) =>
    objectiveTuple[0] === 0 && objectiveTuple[1] === 0 && objectiveTuple[2] === 0 &&
    candidate.inventoryGeneration === inventorySnapshot.generation &&
    candidate.projectGeneration === projectSnapshot.generation,
  );
  if (!selected) {
    return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.NO_VERIFIED_RECIPE, canCompile: false, scored });
  }
  const solutionIds = selected.candidate.completeSolutionItemIds;
  if (solutionIds.some((itemId) => !byId.has(itemId))) {
    return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.INVALID_SOLUTION_REFERENCE, canCompile: false });
  }
  if (solutionIds.some((itemId) => protectedIds.has(itemId))) {
    return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.PROTECTED_ITEM_USAGE, canCompile: false });
  }
  if (solutionIds.some((itemId) => [
    "hasTradabilityEvidence", "hasLockedEvidence", "hasProtectedEvidence",
    "hasStartingSquadEvidence", "hasSpecialEvidence",
  ].some((field) => byId.get(itemId)?.[field] !== true))) {
    return freeze({ status: DuplicateRecycleStatus.BLOCKED, reason: DuplicateRecycleReason.ITEM_EVIDENCE_UNVERIFIED, canCompile: false });
  }
  return freeze({
    schemaVersion: 1,
    kind: "DUPLICATE_RECYCLE_PREVIEW_V1",
    status: DuplicateRecycleStatus.READY,
    canCompile: true,
    readOnly: true,
    inventoryGeneration: inventorySnapshot.generation,
    inventoryFingerprint: fingerprintDuplicateRecycleInventory(inventorySnapshot),
    projectGeneration: projectSnapshot.generation,
    projectFingerprint: projectSnapshot.fingerprint ?? fingerprintDuplicateRecycleProjects(projectSnapshot.projects ?? []),
    blockingItemIds: blockingIds,
    target: selected.candidate,
    objectiveTuple: selected.objectiveTuple,
    explanation: {
      relievedDuplicates: blockingIds.length,
      extraFodderItems: Math.max(0, solutionIds.length - blockingIds.length),
      projectDamage: selected.candidate.projectDamage,
      preservedProtectedItems: protectedIds.size,
    },
  });
}

export function compileDuplicateRecycleWorkflow(preview) {
  if (preview?.status !== DuplicateRecycleStatus.READY || preview.canCompile !== true) {
    throw new TypeError("A ready duplicate recycle preview is required");
  }
  return freeze({
    id: `duplicate-recycle-${preview.target.targetId}`,
    name: "Recycle duplicates",
    version: 1,
    metadata: { source: "fut-magic-duplicate-recipe", safetyModel: "fail-closed" },
    steps: [{
      id: "recycle-approved-duplicates",
      type: "ORGANIZE_ITEMS",
      config: {
        approvedRecycle: {
          target: {
            targetId: preview.target.targetId,
            setId: preview.target.setId,
            challengeId: preview.target.challengeId,
          },
          requiredItemIds: preview.blockingItemIds,
          exactSolutionItemIds: preview.target.completeSolutionItemIds,
          inventoryGeneration: preview.inventoryGeneration,
          inventoryFingerprint: preview.inventoryFingerprint,
          projectGeneration: preview.projectGeneration,
          projectFingerprint: preview.projectFingerprint,
          protectionFingerprint: preview.target.protectionFingerprint,
          requirementsFingerprint: preview.target.requirementsFingerprint,
          capabilityFingerprint: preview.target.capabilityFingerprint,
        },
      },
      timeoutMs: 180_000,
      retryPolicy: { maxAttempts: 1 },
      onFailure: "PAUSE",
    }],
  });
}
