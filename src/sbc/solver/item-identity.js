const firstDefined = (...values) =>
  values.find((value) => value !== null && value !== undefined && value !== "");

const optionalId = (...values) => {
  const value = firstDefined(...values);
  return value == null ? null : String(value);
};

/** The unique identifier of one card owned by the current account. */
export const getOwnedItemId = (item) => optionalId(item?.itemId, item?.id);

/** The identifier of a particular card version, not of an owned copy. */
export const getResourceId = (item) =>
  optionalId(item?.resourceId, item?.resourceID);

/** The footballer identity shared by base and promo versions when available. */
export const getBasePlayerId = (item) =>
  optionalId(
    item?.basePlayerId,
    item?.baseId,
    item?.baseID,
    item?.assetId,
    item?.assetID,
    item?.asset_id,
  );

export const normalizeSolverItem = (item) => {
  if (!item || typeof item !== "object") {
    throw new TypeError("solver item must be an object");
  }
  const itemId = getOwnedItemId(item);
  if (itemId == null) {
    throw new TypeError("solver item requires an owned itemId/id");
  }
  return {
    ...item,
    itemId,
    resourceId: getResourceId(item),
    basePlayerId: getBasePlayerId(item),
  };
};

/**
 * Preserve every owned copy. This deliberately keys by itemId rather than by
 * resourceId, since two owned cards may share a resource and base/promo cards
 * of one footballer have different resources.
 */
export const normalizeOwnedItems = (items) => {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.map(normalizeSolverItem).filter((item) => {
    if (seen.has(item.itemId)) return false;
    seen.add(item.itemId);
    return true;
  });
};

export const hasSameFootballer = (left, right) => {
  const leftBase = getBasePlayerId(left);
  const rightBase = getBasePlayerId(right);
  return leftBase != null && rightBase != null && leftBase === rightBase;
};
