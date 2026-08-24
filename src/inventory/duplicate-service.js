import { normalizeIdentifier } from "./item-model.js";

/**
 * Duplicate identity is card-version identity, never footballer identity.
 * Base and promo versions commonly share an assetId but are not duplicates.
 */
export const getDuplicateKey = (item) => {
  const resourceId = normalizeIdentifier(item?.resourceId, { name: "resourceId" });
  if (resourceId) return `resource:${resourceId}`;
  const definitionId = normalizeIdentifier(item?.definitionId, {
    name: "definitionId",
  });
  return definitionId ? `definition:${definitionId}` : null;
};

export const buildDuplicateGroups = (items) => {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = getDuplicateKey(item);
    if (!key) continue;
    const group = byKey.get(key) ?? [];
    group.push(item);
    byKey.set(key, group);
  }

  return Object.freeze(
    Array.from(byKey.entries())
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) =>
        Object.freeze({
          key,
          resourceId: group[0]?.resourceId ?? null,
          definitionId: group[0]?.definitionId ?? null,
          assetId: group[0]?.assetId ?? null,
          itemIds: Object.freeze(group.map((item) => item.itemId)),
          items: Object.freeze(group.slice()),
        }),
      ),
  );
};

export class DuplicateService {
  getKey(item) {
    return getDuplicateKey(item);
  }

  group(items) {
    return buildDuplicateGroups(items);
  }

  isDuplicate(item, items) {
    const key = getDuplicateKey(item);
    if (!key) return Boolean(item?.isDuplicate);
    let matches = 0;
    for (const candidate of Array.isArray(items) ? items : []) {
      if (getDuplicateKey(candidate) === key) matches += 1;
      if (matches > 1) return true;
    }
    return Boolean(item?.isDuplicate);
  }
}

