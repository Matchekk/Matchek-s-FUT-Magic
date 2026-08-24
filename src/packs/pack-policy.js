export const PACK_OPEN_MODES = Object.freeze({
  CURRENT_REWARD: "OPEN_CURRENT_REWARD",
  MATCHING_PACKS: "OPEN_MATCHING_PACKS",
  ALL_ALLOWED_PACKS: "OPEN_ALL_ALLOWED_PACKS",
});

const VALID_MODES = new Set(Object.values(PACK_OPEN_MODES));

export class PackPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PackPolicyError";
    this.code = code;
    this.details = details;
  }
}

function stringSet(values, field) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new PackPolicyError("INVALID_PACK_POLICY", `${field} must be an array of non-empty strings`);
  }
  return [...new Set(values.map((value) => value.trim()))];
}

/**
 * Normalizes only ownership-based opening rules. Purchasing is intentionally
 * not representable by the returned policy.
 */
export function normalizePackPolicy(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new PackPolicyError("INVALID_PACK_POLICY", "Pack policy must be an object");
  }

  for (const forbidden of ["allowPurchases", "allowStorePacks", "spendCoins", "spendPoints", "useFcPoints"]) {
    if (input[forbidden] === true) {
      throw new PackPolicyError(
        "PURCHASE_FORBIDDEN",
        "GrindPilot never buys packs or spends coins or FC Points",
        { field: forbidden },
      );
    }
  }

  const mode = input.mode ?? PACK_OPEN_MODES.CURRENT_REWARD;
  if (!VALID_MODES.has(mode)) {
    throw new PackPolicyError("INVALID_PACK_MODE", `Unsupported pack mode: ${String(mode)}`);
  }

  const maxPacks = input.maxPacks ?? (mode === PACK_OPEN_MODES.CURRENT_REWARD ? 1 : 25);
  if (!Number.isSafeInteger(maxPacks) || maxPacks < 1 || maxPacks > 100) {
    throw new PackPolicyError("INVALID_PACK_POLICY", "maxPacks must be an integer from 1 to 100");
  }

  return Object.freeze({
    mode,
    maxPacks,
    allowedPackIds: stringSet(input.allowedPackIds, "allowedPackIds"),
    allowedPackTypes: stringSet(input.allowedPackTypes, "allowedPackTypes"),
    excludedPackIds: stringSet(input.excludedPackIds, "excludedPackIds"),
  });
}

function packId(pack) {
  return String(pack?.packId ?? pack?.id ?? "");
}

function packType(pack) {
  return String(pack?.packType ?? pack?.type ?? "");
}

function numericCost(pack, keys) {
  for (const key of keys) {
    const value = pack?.[key] ?? pack?.cost?.[key];
    if (value != null && Number(value) > 0) return Number(value);
  }
  return 0;
}

export function assertOwnedFreePack(pack) {
  const id = packId(pack);
  if (!id) throw new PackPolicyError("INVALID_PACK", "Pack has no stable identifier");

  const coinCost = numericCost(pack, ["coins", "coinCost", "coinsCost"]);
  const pointsCost = numericCost(pack, ["points", "pointCost", "fcPoints", "fcPointsCost"]);
  const requiresPurchase = pack.purchaseRequired === true || pack.owned === false;
  const storeOnly = pack.source === "store" && pack.owned !== true && pack.isReward !== true;

  if (coinCost > 0 || pointsCost > 0 || requiresPurchase || storeOnly) {
    throw new PackPolicyError("PURCHASE_FORBIDDEN", "Pack is not proven to be owned and free to open", {
      packId: id,
      coinCost,
      pointsCost,
    });
  }

  if (pack.owned !== true && pack.isReward !== true && pack.source !== "reward") {
    throw new PackPolicyError("OWNERSHIP_UNVERIFIED", "Pack ownership could not be verified", { packId: id });
  }
  return true;
}

export function getUnassignedCount(inventoryState = {}) {
  let unresolved;
  if (Array.isArray(inventoryState.unassigned)) {
    unresolved = inventoryState.unassigned.length;
  } else if (Object.hasOwn(inventoryState, "unassignedCount")) {
    unresolved = Number(inventoryState.unassignedCount);
  } else if (Object.hasOwn(inventoryState, "unresolvedUnassigned")) {
    unresolved = Number(inventoryState.unresolvedUnassigned);
  } else {
    throw new PackPolicyError("INVENTORY_STATE_UNVERIFIED", "Unassigned state is missing");
  }
  if (!Number.isFinite(unresolved) || unresolved < 0) {
    throw new PackPolicyError("INVALID_INVENTORY_STATE", "Unassigned count is invalid");
  }
  return unresolved;
}

export function assertNoUnassigned(inventoryState = {}) {
  const unresolved = getUnassignedCount(inventoryState);
  if (unresolved > 0) {
    throw new PackPolicyError("UNASSIGNED_BLOCKING", "Resolve unassigned items before opening another pack", {
      unresolved,
    });
  }
  return true;
}

function matchesFilters(pack, policy) {
  const id = packId(pack);
  const type = packType(pack);
  if (policy.excludedPackIds.includes(id)) return false;
  if (policy.allowedPackIds.length && !policy.allowedPackIds.includes(id)) return false;
  if (policy.allowedPackTypes.length && !policy.allowedPackTypes.includes(type)) return false;
  return true;
}

/** Selects only packs already proven to be owned rewards. */
export function selectPacksForPolicy({ packs = [], policy: rawPolicy = {}, currentReward = null } = {}) {
  if (!Array.isArray(packs)) throw new PackPolicyError("INVALID_PACKS", "packs must be an array");
  const policy = normalizePackPolicy(rawPolicy);
  const safe = packs.filter((pack) => {
    try {
      assertOwnedFreePack(pack);
      return matchesFilters(pack, policy);
    } catch {
      return false;
    }
  });

  let selected;
  if (policy.mode === PACK_OPEN_MODES.CURRENT_REWARD) {
    const expectedId = String(currentReward?.packId ?? currentReward?.identifiedPackId ?? "");
    if (!expectedId) {
      throw new PackPolicyError("REWARD_PACK_UNIDENTIFIED", "The current reward has no verified pack identifier");
    }
    selected = safe.filter((pack) => packId(pack) === expectedId);
    if (selected.length !== 1) {
      throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "The current reward pack was not uniquely identified", {
        expectedId,
        matches: selected.length,
      });
    }
  } else if (policy.mode === PACK_OPEN_MODES.MATCHING_PACKS) {
    const rewardType = String(currentReward?.packType ?? currentReward?.type ?? "");
    if (!rewardType) {
      throw new PackPolicyError("REWARD_PACK_UNIDENTIFIED", "A pack type is required for matching-pack mode");
    }
    selected = safe.filter((pack) => packType(pack) === rewardType);
  } else {
    selected = safe;
  }

  return selected.slice(0, policy.maxPacks);
}
