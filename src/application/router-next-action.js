import { getDuplicateKey } from "../inventory/duplicate-service.js";
import { INVENTORY_RESOLUTION_ACTIONS } from "../inventory/resolution-policy.js";
import { cloneAndFreeze, stableFingerprint, stableStringify } from "./immutable.js";

export const ROUTER_NEXT_ACTION_KIND = "ROUTER_NEXT_ACTION_V1";
export const ROUTER_NEXT_ACTION_SCHEMA_VERSION = 1;
export const ROUTER_NEXT_ACTION_SAFETY_BOUNDARY = "READ_ONLY_ONE_RECOMMENDATION";

export const ROUTER_NEXT_ACTION_LIMITS = Object.freeze({
  maxItems: 5_000,
  maxUnassignedItems: 100,
  maxStorageItems: 100,
});

export const RouterNextActionState = Object.freeze({
  READY: "READY",
  ATTENTION: "ATTENTION",
  CLEAR: "CLEAR",
  BLOCKED: "BLOCKED",
});

// These are recommendation kinds, not InventoryResolutionAction or WorkflowStepType.
export const RouterNextActionKind = Object.freeze({
  KEEP: "KEEP",
  MOVE_TO_CLUB: "MOVE_TO_CLUB",
  MOVE_TO_SBC_STORAGE: "MOVE_TO_SBC_STORAGE",
  RESERVE: "RESERVE",
  PAUSE: "PAUSE",
  ASK_USER: "ASK_USER",
});

export const RouterActivityGuardState = Object.freeze({
  IDLE: "IDLE",
  NON_IDLE: "NON_IDLE",
  UNKNOWN: "UNKNOWN",
});

export const RouterNextActionReason = Object.freeze({
  UNASSIGNED_CLEAR: "UNASSIGNED_CLEAR",
  EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED: "EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED",
  UNIQUE_CLUB_MOVE_VERIFIED: "UNIQUE_CLUB_MOVE_VERIFIED",
  TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE: "TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE",
  UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION: "UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION",
  DUPLICATE_IDENTITY_UNVERIFIED: "DUPLICATE_IDENTITY_UNVERIFIED",
  CLUB_MOVE_EVIDENCE_UNVERIFIED: "CLUB_MOVE_EVIDENCE_UNVERIFIED",
  STORAGE_MOVE_EVIDENCE_UNVERIFIED: "STORAGE_MOVE_EVIDENCE_UNVERIFIED",
  TRADABILITY_EVIDENCE_UNVERIFIED: "TRADABILITY_EVIDENCE_UNVERIFIED",
  STORAGE_CAPACITY_UNVERIFIED: "STORAGE_CAPACITY_UNVERIFIED",
  ITEM_EXPLICITLY_NOT_MOVABLE: "ITEM_EXPLICITLY_NOT_MOVABLE",
  ROUTE_EVIDENCE_MISSING: "ROUTE_EVIDENCE_MISSING",
  ROUTE_EVIDENCE_CONFLICT: "ROUTE_EVIDENCE_CONFLICT",
  INVENTORY_SNAPSHOT_INVALID: "INVENTORY_SNAPSHOT_INVALID",
  INPUT_LIMIT_EXCEEDED: "INPUT_LIMIT_EXCEEDED",
  GAME_CONTEXT_UNVERIFIED: "GAME_CONTEXT_UNVERIFIED",
  READ_CAPABILITY_UNAVAILABLE: "READ_CAPABILITY_UNAVAILABLE",
  MOVE_CAPABILITY_UNAVAILABLE: "MOVE_CAPABILITY_UNAVAILABLE",
  ACTIVITY_GUARD_NOT_IDLE: "ACTIVITY_GUARD_NOT_IDLE",
  ACTIVITY_GUARD_UNVERIFIED: "ACTIVITY_GUARD_UNVERIFIED",
});

export const ROUTER_NEXT_ACTION_CAPABILITIES = Object.freeze([
  "ea.inventory.read",
  "ea.unassigned.read",
  "ea.items.move",
]);

export const ROUTER_NEXT_ACTION_OBJECTIVE_FIELDS = Object.freeze([
  "protected_item_violations",
  "unresolved_blocking_duplicates",
  "active_project_damage",
  "scarce_special_consumption",
  "tradable_opportunity_cost",
  "replacement_value",
  "future_flexibility_loss",
  "unassigned_items_after",
  "interaction_friction",
  "action_rank",
  "exact_identity_key",
  "owned_item_id",
]);

const ROUTER_VERSION = 1;
const TIE_RULE_VERSION = 1;

const compareText = (left, right) => {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
};

const compareTuples = (left, right) => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b
      : compareText(a, b);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => canonicalValue(entry))
      .sort((left, right) => compareText(stableStringify(left), stableStringify(right)));
  }
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(
    Object.keys(value).sort(compareText).map((key) => [key, canonicalValue(value[key])]),
  );
};

const sourceItems = (snapshot, sourceName) => {
  const source = snapshot?.[sourceName];
  return Array.isArray(source?.items) ? source.items : null;
};

const allSnapshotItems = (snapshot) => {
  const club = sourceItems(snapshot, "club");
  const storage = sourceItems(snapshot, "storage");
  const unassigned = sourceItems(snapshot, "unassigned");
  if (!club || !storage || !unassigned) return null;
  return { club, storage, unassigned, all: [...club, ...storage, ...unassigned] };
};

const canonicalItem = (item = {}) => ({
  itemId: String(item.itemId ?? item.id ?? ""),
  resourceId: item.resourceId == null ? null : String(item.resourceId),
  definitionId: item.definitionId == null ? null : String(item.definitionId),
  assetId: item.assetId == null ? null : String(item.assetId),
  baseId: item.baseId == null ? null : String(item.baseId),
  location: item.location == null ? null : String(item.location),
  rating: Number(item.rating || 0),
  name: item.name == null ? null : String(item.name),
  cardType: item.cardType == null ? null : String(item.cardType),
  rarityId: item.rarityId == null ? null : String(item.rarityId),
  rarityName: item.rarityName == null ? null : String(item.rarityName),
  specialGroups: [...(Array.isArray(item.specialGroups) ? item.specialGroups : [])]
    .map(String).sort(compareText),
  isSpecial: item.isSpecial ?? null,
  isTradable: item.isTradable ?? item.isTradeable ?? null,
  isDuplicate: item.isDuplicate ?? null,
  isMovable: item.isMovable ?? null,
  isStorable: item.isStorable ?? null,
  isLocked: item.isLocked ?? item.locked ?? null,
  isProtected: item.isProtected ?? null,
  isFavorite: item.isFavorite ?? item.isFavourite ?? null,
  isInStartingSquad: item.isInStartingSquad ?? item.isInActive11 ?? null,
  hasMovableEvidence: item.hasMovableEvidence ?? null,
  hasStorableEvidence: item.hasStorableEvidence ?? null,
  hasTradabilityEvidence: item.hasTradabilityEvidence ?? null,
  hasLockedEvidence: item.hasLockedEvidence ?? null,
  hasProtectedEvidence: item.hasProtectedEvidence ?? null,
  hasFavoriteEvidence: item.hasFavoriteEvidence ?? null,
  hasStartingSquadEvidence: item.hasStartingSquadEvidence ?? null,
  hasSpecialEvidence: item.hasSpecialEvidence ?? null,
});

const canonicalInventory = (snapshot, sources) => ({
  storageCapacity: snapshot?.storageCapacity ?? null,
  items: sources.all.map(canonicalItem).sort((left, right) => compareText(left.itemId, right.itemId)),
});

const canonicalRouteAction = (action = {}) => ({
  itemId: String(action.itemId ?? ""),
  type: String(action.type ?? ""),
  from: String(action.from ?? ""),
  to: String(action.to ?? ""),
  reason: String(action.reason ?? ""),
});

const canonicalRouteEvidence = (routeSummary) => ({
  actions: (Array.isArray(routeSummary?.routeActions) ? routeSummary.routeActions : [])
    .map(canonicalRouteAction)
    .sort((left, right) =>
      compareText(left.itemId, right.itemId) ||
      compareText(left.type, right.type) ||
      compareText(left.to, right.to)),
});

const canonicalCapabilities = (snapshot = {}) => ({
  capabilities: ROUTER_NEXT_ACTION_CAPABILITIES.map((id) => {
    const record = (snapshot.capabilities || []).find((entry) => entry?.id === id);
    return {
      id,
      state: record?.state ?? "unverified",
      evidence: canonicalValue(record?.evidence ?? null),
    };
  }),
});

const canonicalContext = (context = {}) => ({
  gameVersion: String(context.gameVersion ?? "unknown").toLowerCase(),
  state: String(context.state ?? "unverified").toLowerCase(),
  route: context.route == null ? null : String(context.route),
  evidence: canonicalValue(context.evidence ?? null),
});

const normalizedGuard = (guard) => {
  const state = String(guard?.state ?? RouterActivityGuardState.UNKNOWN).toUpperCase();
  if (state === RouterActivityGuardState.IDLE) {
    return { state: RouterActivityGuardState.IDLE, evidence: canonicalValue(guard?.evidence ?? null) };
  }
  if (state === RouterActivityGuardState.UNKNOWN) {
    return { state: RouterActivityGuardState.UNKNOWN, evidence: canonicalValue(guard?.evidence ?? null) };
  }
  return { state: RouterActivityGuardState.NON_IDLE, evidence: canonicalValue(guard?.evidence ?? null) };
};

const capabilityState = (snapshot, id) =>
  (snapshot?.capabilities || []).find((entry) => entry?.id === id)?.state ?? "unverified";

const displayItem = (item = {}) => ({
  name: item.name == null ? null : String(item.name),
  rating: Number(item.rating || 0),
  isSpecial: Boolean(item.isSpecial),
  isTradable: item.hasTradabilityEvidence === true ? Boolean(item.isTradable) : null,
  location: "unassigned",
});

const makeFingerprints = ({
  inventory = null,
  routeEvidence = null,
  capabilities,
  context,
  guard,
  protectionAnalysis,
  conservationPolicy,
  duplicatePolicy,
  failure = null,
}) => {
  const components = {
    inventory: stableFingerprint(inventory ?? { unavailable: true }),
    routeEvidence: stableFingerprint(routeEvidence ?? { unavailable: true }),
    capabilities: stableFingerprint(capabilities),
    gameContext: stableFingerprint(context),
    activityGuard: stableFingerprint(guard),
    protection: stableFingerprint({
      analysis: canonicalValue(protectionAnalysis ?? null),
      conservationPolicy: canonicalValue(conservationPolicy ?? null),
    }),
    policy: stableFingerprint(canonicalValue(duplicatePolicy ?? null)),
    version: stableFingerprint({
      kind: ROUTER_NEXT_ACTION_KIND,
      schemaVersion: ROUTER_NEXT_ACTION_SCHEMA_VERSION,
      routerVersion: ROUTER_VERSION,
      tieRuleVersion: TIE_RULE_VERSION,
    }),
    failure: stableFingerprint(failure),
  };
  return {
    ...components,
    input: stableFingerprint(components),
  };
};

const outcomeFor = ({ kind, reasonCode, item = null, duplicateKey = null, destination = null, tuple = [] }) => ({
  kind,
  reasonCode,
  destination,
  display: item ? displayItem(item) : null,
  binding: item ? {
    itemId: String(item.itemId),
    expectedFrom: "unassigned",
    exactDuplicateKey: duplicateKey,
  } : null,
  objectiveTuple: [...tuple],
});

const finalize = ({ state, outcome, fingerprints, observedAt, counts }) => {
  const decisionFingerprint = stableFingerprint({
    input: fingerprints.input,
    kind: outcome.kind,
    reasonCode: outcome.reasonCode,
    destination: outcome.destination,
    binding: outcome.binding,
    objectiveTuple: outcome.objectiveTuple,
  });
  return cloneAndFreeze({
    kind: ROUTER_NEXT_ACTION_KIND,
    schemaVersion: ROUTER_NEXT_ACTION_SCHEMA_VERSION,
    state,
    safetyBoundary: ROUTER_NEXT_ACTION_SAFETY_BOUNDARY,
    readOnly: true,
    canExecute: false,
    outcome,
    counts,
    observedAt,
    fingerprints: { ...fingerprints, decision: decisionFingerprint },
  });
};

const blocked = ({ reasonCode, fingerprints, observedAt, counts }) => finalize({
  state: RouterNextActionState.BLOCKED,
  outcome: outcomeFor({ kind: RouterNextActionKind.PAUSE, reasonCode }),
  fingerprints,
  observedAt,
  counts,
});

const routeMapFor = (routeEvidence, unassignedIds) => {
  const map = new Map();
  let conflict = false;
  for (const action of routeEvidence.actions) {
    if (!unassignedIds.has(action.itemId) || map.has(action.itemId)) {
      conflict = true;
      continue;
    }
    map.set(action.itemId, action);
  }
  if (map.size !== unassignedIds.size) conflict = true;
  return { map, conflict };
};

const attentionReason = (item, action, duplicateKey, exactDuplicate, capacityKnown) => {
  if ((item.isDuplicate === true || action?.reason === "duplicate_identity_ambiguous") && !duplicateKey) {
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.DUPLICATE_IDENTITY_UNVERIFIED, severity: 0 };
  }
  if (action?.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE &&
      action.reason === "unassigned_item_not_movable") {
    return {
      kind: RouterNextActionKind.PAUSE,
      reasonCode: item.hasMovableEvidence === true
        ? RouterNextActionReason.ITEM_EXPLICITLY_NOT_MOVABLE
        : RouterNextActionReason.CLUB_MOVE_EVIDENCE_UNVERIFIED,
      severity: 1,
    };
  }
  if (action?.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB) {
    if (exactDuplicate) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 0 };
    }
    if (item.hasMovableEvidence !== true) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.CLUB_MOVE_EVIDENCE_UNVERIFIED, severity: 1 };
    }
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ITEM_EXPLICITLY_NOT_MOVABLE, severity: 2 };
  }
  if (action?.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE) {
    if (!exactDuplicate) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 0 };
    }
    if (!capacityKnown) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_CAPACITY_UNVERIFIED, severity: 1 };
    }
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_MOVE_EVIDENCE_UNVERIFIED, severity: 1 };
  }
  if (exactDuplicate && !capacityKnown) {
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_CAPACITY_UNVERIFIED, severity: 1 };
  }
  if (exactDuplicate && item.hasTradabilityEvidence !== true) {
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.TRADABILITY_EVIDENCE_UNVERIFIED, severity: 3 };
  }
  if (exactDuplicate && item.isTradable === true) {
    return { kind: RouterNextActionKind.ASK_USER, reasonCode: RouterNextActionReason.TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE, severity: 5 };
  }
  if (exactDuplicate) {
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION, severity: 2 };
  }
  return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 1 };
};

/**
 * Returns one deterministic, read-only recommendation. It never compiles or
 * executes a workflow, and its owned-item binding is for later UI redaction.
 */
export const recommendRouterNextAction = (input = {}) => {
  const observedAt = input.observedAt ?? input.inventorySnapshot?.updatedAt ?? null;
  const guard = normalizedGuard(input.activityGuard);
  const capabilities = canonicalCapabilities(input.capabilitySnapshot);
  const context = canonicalContext(input.gameContext);
  const initialCounts = { totalItems: 0, unassignedItems: 0, safeCandidates: 0, attentionCandidates: 0 };
  const earlyFingerprints = (failure) => makeFingerprints({
    capabilities,
    context,
    guard,
    protectionAnalysis: input.protectionAnalysis,
    conservationPolicy: input.conservationPolicy,
    duplicatePolicy: input.duplicatePolicy,
    failure,
  });

  if (guard.state !== RouterActivityGuardState.IDLE) {
    const reasonCode = guard.state === RouterActivityGuardState.UNKNOWN
      ? RouterNextActionReason.ACTIVITY_GUARD_UNVERIFIED
      : RouterNextActionReason.ACTIVITY_GUARD_NOT_IDLE;
    return blocked({
      reasonCode,
      fingerprints: earlyFingerprints({ reasonCode }),
      observedAt,
      counts: initialCounts,
    });
  }

  const sources = allSnapshotItems(input.inventorySnapshot);
  const totalCount = sources?.all.length ?? 0;
  const unassignedCount = sources?.unassigned.length ?? 0;
  const counts = { ...initialCounts, totalItems: totalCount, unassignedItems: unassignedCount };
  if (!sources) {
    const reasonCode = RouterNextActionReason.INVENTORY_SNAPSHOT_INVALID;
    return blocked({ reasonCode, fingerprints: earlyFingerprints({ reasonCode }), observedAt, counts });
  }
  if (totalCount > ROUTER_NEXT_ACTION_LIMITS.maxItems ||
      unassignedCount > ROUTER_NEXT_ACTION_LIMITS.maxUnassignedItems ||
      sources.storage.length > ROUTER_NEXT_ACTION_LIMITS.maxStorageItems) {
    const reasonCode = RouterNextActionReason.INPUT_LIMIT_EXCEEDED;
    return blocked({
      reasonCode,
      fingerprints: earlyFingerprints({ reasonCode, totalCount, unassignedCount, storageCount: sources.storage.length }),
      observedAt,
      counts,
    });
  }

  const expectedLocations = [
    [sources.club, "club"],
    [sources.storage, "sbc_storage"],
    [sources.unassigned, "unassigned"],
  ];
  const ids = new Set();
  let invalidInventory = false;
  for (const [items, location] of expectedLocations) {
    for (const item of items) {
      const itemId = String(item?.itemId ?? "");
      if (!itemId || ids.has(itemId) || String(item?.location ?? "") !== location) {
        invalidInventory = true;
      }
      ids.add(itemId);
    }
  }
  if (Array.isArray(input.inventorySnapshot?.items)) {
    const aggregateIds = input.inventorySnapshot.items.map((item) => String(item?.itemId ?? "")).sort(compareText);
    const sourceIds = [...ids].sort(compareText);
    if (stableStringify(aggregateIds) !== stableStringify(sourceIds)) invalidInventory = true;
  }

  const inventory = canonicalInventory(input.inventorySnapshot, sources);
  const routeEvidence = canonicalRouteEvidence(input.routeSummary);
  const fingerprints = makeFingerprints({
    inventory,
    routeEvidence,
    capabilities,
    context,
    guard,
    protectionAnalysis: input.protectionAnalysis,
    conservationPolicy: input.conservationPolicy,
    duplicatePolicy: input.duplicatePolicy,
  });

  if (invalidInventory) {
    return blocked({
      reasonCode: RouterNextActionReason.INVENTORY_SNAPSHOT_INVALID,
      fingerprints,
      observedAt,
      counts,
    });
  }
  if (context.gameVersion !== "fc26" || context.state !== "verified") {
    return blocked({
      reasonCode: RouterNextActionReason.GAME_CONTEXT_UNVERIFIED,
      fingerprints,
      observedAt,
      counts,
    });
  }
  if (capabilityState(input.capabilitySnapshot, "ea.inventory.read") !== "available" ||
      capabilityState(input.capabilitySnapshot, "ea.unassigned.read") !== "available") {
    return blocked({
      reasonCode: RouterNextActionReason.READ_CAPABILITY_UNAVAILABLE,
      fingerprints,
      observedAt,
      counts,
    });
  }

  if (unassignedCount === 0) {
    return finalize({
      state: RouterNextActionState.CLEAR,
      outcome: outcomeFor({
        kind: RouterNextActionKind.KEEP,
        reasonCode: RouterNextActionReason.UNASSIGNED_CLEAR,
      }),
      fingerprints,
      observedAt,
      counts,
    });
  }

  const unassignedIds = new Set(sources.unassigned.map((item) => String(item.itemId)));
  const { map: routeByItemId, conflict: routeConflict } = routeMapFor(routeEvidence, unassignedIds);
  if (!Array.isArray(input.routeSummary?.routeActions)) {
    return blocked({
      reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_MISSING,
      fingerprints,
      observedAt,
      counts,
    });
  }
  if (routeConflict) {
    return blocked({
      reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT,
      fingerprints,
      observedAt,
      counts,
    });
  }

  const capacity = input.inventorySnapshot.storageCapacity;
  const capacityKnown = Number.isInteger(capacity) && capacity >= 0 && capacity <= 100;
  const hasStorageSlot = capacityKnown && sources.storage.length < capacity;
  const occupiedKeys = new Set(
    [...sources.club, ...sources.storage].map(getDuplicateKey).filter(Boolean),
  );
  const blockingDuplicateCount = sources.unassigned.reduce((count, item) => {
    const key = getDuplicateKey(item);
    return count + Number(Boolean(key && occupiedKeys.has(key)));
  }, 0);
  const safeCandidates = [];
  const attentionCandidates = [];

  for (const item of sources.unassigned) {
    const itemId = String(item.itemId);
    const action = routeByItemId.get(itemId);
    const duplicateKey = getDuplicateKey(item);
    const exactDuplicate = Boolean(duplicateKey && occupiedKeys.has(duplicateKey));
    let safe = null;

    if (action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB &&
        action.from === "unassigned" && action.to === "club" && action.reason === "not_duplicate" &&
        !exactDuplicate && item.hasMovableEvidence === true && item.isMovable === true) {
      safe = {
        item,
        duplicateKey,
        kind: RouterNextActionKind.MOVE_TO_CLUB,
        reasonCode: RouterNextActionReason.UNIQUE_CLUB_MOVE_VERIFIED,
        destination: "club",
        tuple: [0, blockingDuplicateCount, 0, 0, 0, 0, 0, Math.max(0, unassignedCount - 1), 1, 1, duplicateKey ?? "", itemId],
      };
    }
    if (action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE &&
        action.from === "unassigned" && action.to === "sbc_storage" &&
        action.reason === "duplicate_storage_available" && exactDuplicate && hasStorageSlot &&
        item.hasMovableEvidence === true && item.isMovable === false &&
        item.hasStorableEvidence === true && item.isStorable === true) {
      const tradableRank = item.hasTradabilityEvidence === true
        ? (item.isTradable === true ? 1 : 0)
        : 2;
      safe = {
        item,
        duplicateKey,
        kind: RouterNextActionKind.MOVE_TO_SBC_STORAGE,
        reasonCode: RouterNextActionReason.EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED,
        destination: "sbc_storage",
        tuple: [0, Math.max(0, blockingDuplicateCount - 1), 0, 0, tradableRank, 0, 1, Math.max(0, unassignedCount - 1), 1, 0, duplicateKey, itemId],
      };
    }

    if (safe) {
      safeCandidates.push(safe);
      continue;
    }
    const attention = attentionReason(item, action, duplicateKey, exactDuplicate, capacityKnown);
    attentionCandidates.push({
      item,
      duplicateKey,
      ...attention,
      tuple: [attention.severity, duplicateKey ?? "", itemId],
    });
  }

  const resultCounts = {
    ...counts,
    safeCandidates: safeCandidates.length,
    attentionCandidates: attentionCandidates.length,
  };
  if (safeCandidates.length > 0) {
    if (capabilityState(input.capabilitySnapshot, "ea.items.move") !== "available") {
      return blocked({
        reasonCode: RouterNextActionReason.MOVE_CAPABILITY_UNAVAILABLE,
        fingerprints,
        observedAt,
        counts: resultCounts,
      });
    }
    const selected = safeCandidates.sort((left, right) => compareTuples(left.tuple, right.tuple))[0];
    return finalize({
      state: RouterNextActionState.READY,
      outcome: outcomeFor(selected),
      fingerprints,
      observedAt,
      counts: resultCounts,
    });
  }

  const selected = attentionCandidates.sort((left, right) => compareTuples(left.tuple, right.tuple))[0];
  return finalize({
    state: RouterNextActionState.ATTENTION,
    outcome: outcomeFor(selected),
    fingerprints,
    observedAt,
    counts: resultCounts,
  });
};
