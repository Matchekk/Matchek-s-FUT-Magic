import { getDuplicateKey } from "./duplicate-service.js";

const LOCATION_BUCKET = Object.freeze({
  club: "club",
  sbc_storage: "sbcStorage",
  unassigned: "unassigned",
});

const freezeRef = (item) => Object.freeze({
  itemId: String(item.itemId),
  location: String(item.location),
  resourceId: item.resourceId == null ? null : String(item.resourceId),
  definitionId: item.definitionId == null ? null : String(item.definitionId),
});

const byItemId = (left, right) => left.itemId.localeCompare(right.itemId);

/**
 * Builds deterministic exact-card-version relationships without collapsing
 * concrete owned instances. Transfer remains unavailable until it is part of
 * one verified atomic inventory snapshot.
 */
export function buildDuplicateRelations(snapshot = {}) {
  const items = Array.isArray(snapshot.items)
    ? snapshot.items
    : [
        ...(snapshot.club?.items ?? []),
        ...(snapshot.storage?.items ?? []),
        ...(snapshot.unassigned?.items ?? []),
      ];
  const groups = new Map();
  const ambiguousItemRefs = [];

  for (const item of items) {
    if (!item?.itemId) continue;
    const key = getDuplicateKey(item);
    if (!key) {
      if (item.isDuplicate === true) ambiguousItemRefs.push(freezeRef(item));
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const relations = [];
  for (const [relationKey, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const shouldInclude = group.length > 1 || group.some(
      (item) => item.location === "unassigned" && item.isDuplicate === true,
    );
    if (!shouldInclude) continue;
    const copies = { club: [], sbcStorage: [], unassigned: [] };
    for (const item of group) {
      const bucket = LOCATION_BUCKET[item.location];
      if (bucket) copies[bucket].push(freezeRef(item));
    }
    for (const bucket of Object.values(copies)) bucket.sort(byItemId);
    const unassigned = copies.unassigned;
    relations.push(Object.freeze({
      relationKey,
      resourceId: group[0]?.resourceId == null ? null : String(group[0].resourceId),
      definitionId: group[0]?.definitionId == null ? null : String(group[0].definitionId),
      copies: Object.freeze({
        club: Object.freeze(copies.club),
        sbcStorage: Object.freeze(copies.sbcStorage),
        unassigned: Object.freeze(unassigned),
        transfer: null,
      }),
      blockingUnassignedItemIds: Object.freeze(unassigned.map(({ itemId }) => itemId)),
      evidenceState: group.length > 1 ? "verified" : "reported_only",
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    inventoryGeneration: Number.isSafeInteger(snapshot.generation)
      ? snapshot.generation
      : null,
    relations: Object.freeze(relations),
    ambiguousItemRefs: Object.freeze(ambiguousItemRefs.sort(byItemId)),
    transferSourceAvailable: false,
  });
}
