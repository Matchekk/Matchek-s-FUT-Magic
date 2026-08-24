import { getDuplicateKey } from "./duplicate-service.js";

export const INVENTORY_RESOLUTION_ACTIONS = Object.freeze({
  SEND_TO_CLUB: "SEND_TO_CLUB",
  MOVE_TO_SBC_STORAGE: "MOVE_TO_SBC_STORAGE",
  SAFE_HOLD: "SAFE_HOLD",
  PAUSE: "PAUSE",
});

export const DEFAULT_DUPLICATE_POLICY = Object.freeze({
  preferSbcStorage: true,
  tradableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD,
  untradeableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.PAUSE,
});

const validateFallbackAction = (action, policyName) => {
  if (
    action !== INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD &&
    action !== INVENTORY_RESOLUTION_ACTIONS.PAUSE
  ) {
    throw new TypeError(`${policyName} must be SAFE_HOLD or PAUSE`);
  }
  return action;
};

const createAction = (item, type, reason) =>
  Object.freeze({
    itemId: item.itemId,
    type,
    reason,
    from: item.location,
    to:
      type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB
        ? "club"
        : type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE
          ? "sbc_storage"
          : item.location,
  });

/**
 * Produces a side-effect-free plan. The caller must execute and verify every
 * action before updating the snapshot; planning never assumes an EA mutation
 * succeeded and deliberately has no implicit quicksell path.
 */
export const planUnassignedResolution = (snapshot, policy = {}) => {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("An inventory snapshot is required");
  }
  const effectivePolicy = {
    ...DEFAULT_DUPLICATE_POLICY,
    ...(policy && typeof policy === "object" ? policy : {}),
  };
  effectivePolicy.tradableWhenStorageUnavailable = validateFallbackAction(
    effectivePolicy.tradableWhenStorageUnavailable,
    "tradableWhenStorageUnavailable",
  );
  effectivePolicy.untradeableWhenStorageUnavailable = validateFallbackAction(
    effectivePolicy.untradeableWhenStorageUnavailable,
    "untradeableWhenStorageUnavailable",
  );

  const capacity = snapshot.storageCapacity;
  let storageFreeSlots =
    capacity == null
      ? 0
      : Math.max(0, Number(capacity) - (snapshot.storage?.items?.length ?? 0));
  const occupiedVersions = new Set();
  for (const item of [
    ...(snapshot.club?.items ?? []),
    ...(snapshot.storage?.items ?? []),
  ]) {
    const key = getDuplicateKey(item);
    if (key) occupiedVersions.add(key);
  }

  const actions = [];
  let paused = false;
  for (const item of snapshot.unassigned?.items ?? []) {
    const duplicateKey = getDuplicateKey(item);
    const duplicate = Boolean(
      item.isDuplicate || (duplicateKey && occupiedVersions.has(duplicateKey)),
    );

    if (!duplicate) {
      actions.push(
        createAction(
          item,
          INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB,
          "not_duplicate",
        ),
      );
      if (duplicateKey) occupiedVersions.add(duplicateKey);
      continue;
    }

    if (!duplicateKey) {
      actions.push(
        createAction(
          item,
          INVENTORY_RESOLUTION_ACTIONS.PAUSE,
          "duplicate_identity_ambiguous",
        ),
      );
      paused = true;
      break;
    }

    if (effectivePolicy.preferSbcStorage && storageFreeSlots > 0) {
      actions.push(
        createAction(
          item,
          INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE,
          "duplicate_storage_available",
        ),
      );
      storageFreeSlots -= 1;
      occupiedVersions.add(duplicateKey);
      continue;
    }

    const fallback = item.isTradable
      ? effectivePolicy.tradableWhenStorageUnavailable
      : effectivePolicy.untradeableWhenStorageUnavailable;
    actions.push(
      createAction(
        item,
        fallback,
        item.isTradable
          ? "tradable_duplicate_storage_unavailable"
          : "untradeable_duplicate_storage_unavailable",
      ),
    );
    if (fallback === INVENTORY_RESOLUTION_ACTIONS.PAUSE) {
      paused = true;
      break;
    }
  }

  const requiresUserAction = actions.some(
    (action) =>
      action.type === INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD ||
      action.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE,
  );
  return Object.freeze({
    generation: snapshot.generation,
    actions: Object.freeze(actions),
    paused,
    requiresUserAction,
    canContinueWorkflow: !requiresUserAction,
    projectedStorageFreeSlots: storageFreeSlots,
  });
};

