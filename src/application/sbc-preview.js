import { CapabilityRegistry, CapabilityState } from "./capability-registry.js";
import { cloneAndFreeze, stableFingerprint } from "./immutable.js";

export const SBC_PREVIEW_CAPABILITIES = Object.freeze([
  "ea.inventory.read",
  "ea.sbc.read",
  "ea.sbc.solve.preview",
]);

const CAPABILITY_ALIASES = Object.freeze({
  "inventory": ["ea.inventory.read"],
  "inventory read": ["ea.inventory.read"],
  "current sbc read": ["ea.sbc.read"],
  "sbc project import": ["ea.sbc.read"],
  "solve": ["ea.sbc.solve.preview"],
  "unassigned": ["ea.unassigned.read"],
  "resolve": ["ea.unassigned.read", "ea.items.move"],
  "sbc storage move": ["ea.items.move"],
});

const STATUS_ALIASES = Object.freeze({
  AVAILABLE: CapabilityState.AVAILABLE,
  DEGRADED: CapabilityState.DEGRADED,
  UNAVAILABLE: CapabilityState.UNAVAILABLE,
  UNVERIFIED: CapabilityState.UNVERIFIED,
});

export const buildRuntimeCapabilityRegistry = (health = []) => {
  const registry = new CapabilityRegistry();
  for (const entry of Array.isArray(health) ? health : []) {
    const sourceId = String(entry?.id || "").trim().toLowerCase();
    const ids = CAPABILITY_ALIASES[sourceId];
    if (!ids) continue;
    const state = STATUS_ALIASES[String(entry?.status || "").toUpperCase()]
      || CapabilityState.UNVERIFIED;
    for (const id of ids) {
      const existing = registry.get(id);
      const rank = {
        [CapabilityState.UNAVAILABLE]: 0,
        [CapabilityState.UNVERIFIED]: 1,
        [CapabilityState.DEGRADED]: 2,
        [CapabilityState.AVAILABLE]: 3,
      };
      if (existing.revision && rank[existing.state] >= rank[state]) continue;
      registry.declare(id, {
        state,
        reason: state === CapabilityState.AVAILABLE
          ? null
          : `${entry.id || id} is ${state}`,
        evidence: entry?.evidence || null,
      });
    }
  }
  return registry;
};

const canonicalContext = (context = {}) => ({
  gameVersion: context.gameVersion,
  state: context.state,
  route: context.route || null,
  setId: context.setId || null,
  challengeId: context.challengeId || null,
});

const canonicalInventory = (snapshot = {}) => ({
  storageCapacity: snapshot.storageCapacity ?? null,
  items: [...(snapshot.items || [])]
    .map((item) => ({
      itemId: item.itemId,
      resourceId: item.resourceId,
      definitionId: item.definitionId,
      assetId: item.assetId,
      baseId: item.baseId,
      location: item.location,
      rating: item.rating,
      cardType: item.cardType,
      rarityId: item.rarityId,
      specialGroups: item.specialGroups,
      isSpecial: item.isSpecial,
      isTradable: item.isTradable,
      isDuplicate: item.isDuplicate,
      isLocked: item.isLocked,
      isFavorite: item.isFavorite,
      isInStartingSquad: item.isInStartingSquad,
      isMovable: item.isMovable,
      isStorable: item.isStorable,
      hasMovableEvidence: item.hasMovableEvidence,
      hasStorableEvidence: item.hasStorableEvidence,
    }))
    .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId))),
});

const canonicalCapabilities = (snapshot = {}, requiredCapabilities = SBC_PREVIEW_CAPABILITIES) => ({
  capabilities: (snapshot.capabilities || [])
    .filter((entry) => requiredCapabilities.includes(entry.id))
    .map((entry) => ({ id: entry.id, state: entry.state, evidence: entry.evidence || null }))
    .sort((left, right) => left.id.localeCompare(right.id)),
});

export const buildPlanningFingerprints = ({
  gameContext,
  inventorySnapshot,
  capabilitySnapshot,
  requiredCapabilities,
  bindings = {},
}) => {
  const components = {
    gameContext: stableFingerprint(canonicalContext(gameContext)),
    inventory: stableFingerprint(canonicalInventory(inventorySnapshot)),
    capabilities: stableFingerprint(
      canonicalCapabilities(capabilitySnapshot, requiredCapabilities),
    ),
    bindings: stableFingerprint(bindings),
  };
  return cloneAndFreeze({
    ...components,
    combined: stableFingerprint(components),
    inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0)),
  });
};

export const comparePlanningFingerprints = (expected, current) => {
  const keys = ["gameContext", "inventory", "capabilities", "bindings"];
  const changed = keys.filter((key) => expected?.[key] !== current?.[key]);
  return cloneAndFreeze({ ok: changed.length === 0, changed });
};

export const buildSbcPlanFingerprints = ({
  gameContext,
  inventorySnapshot,
  project,
  policySnapshot,
  capabilitySnapshot,
}) => {
  const components = {
    gameContext: stableFingerprint(canonicalContext(gameContext)),
    inventory: stableFingerprint(canonicalInventory(inventorySnapshot)),
    project: stableFingerprint(project),
    policy: stableFingerprint(policySnapshot),
    capabilities: stableFingerprint(canonicalCapabilities(capabilitySnapshot)),
  };
  return cloneAndFreeze({
    ...components,
    combined: stableFingerprint(components),
    inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0)),
  });
};

export const compareSbcPlanFingerprints = (expected, current) => {
  const keys = ["gameContext", "inventory", "project", "policy", "capabilities"];
  const changed = keys.filter((key) => expected?.[key] !== current?.[key]);
  return cloneAndFreeze({ ok: changed.length === 0, changed });
};

export const projectChallengeForContext = (project, context) =>
  (project?.sourceChallenges || []).find((challenge) =>
    String(challenge.id) === String(context?.challengeId || "")) || null;

export const summarizeSbcSolution = ({ solution, inventorySnapshot, protectedItemIds = [] }) => {
  const byId = new Map((inventorySnapshot?.items || []).map((item) => [String(item.itemId), item]));
  const protectedIds = new Set((protectedItemIds || []).map(String));
  const selectedIds = (solution?.solutionIds || []).map(String);
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);
  const unobservedItemIds = selectedIds.filter((id) => !byId.has(id));
  const protectedViolations = selectedIds.filter((id) => protectedIds.has(id));
  const ratings = selected.map((item) => Number(item.rating || 0));
  return cloneAndFreeze({
    solved: solution?.solved === true && solution?.submitReady === true,
    selectedCount: selectedIds.length,
    cards: selected.map((item) => ({
      name: item.name || null,
      rating: Number(item.rating || 0),
      location: item.location,
      isSpecial: Boolean(item.isSpecial),
      isDuplicate: Boolean(item.isDuplicate),
      isTradable: Boolean(item.isTradable),
    })).sort((left, right) => right.rating - left.rating || String(left.name || "").localeCompare(String(right.name || ""))),
    ratingRange: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
    specialCount: selected.filter((item) => item.isSpecial).length,
    duplicateCount: selected.filter((item) => item.isDuplicate).length,
    storageCount: selected.filter((item) => item.location === "sbc_storage").length,
    selectedProtectedCount: protectedViolations.length,
    protectedViolations,
    unobservedItemIds,
    objectiveTuple: solution?.stats?.conservationObjectiveTuple || null,
  });
};
