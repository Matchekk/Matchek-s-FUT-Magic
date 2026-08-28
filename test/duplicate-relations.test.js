import test from "node:test";
import assert from "node:assert/strict";

import { InventoryService } from "../src/inventory/index.js";

const item = (itemId, resourceId, extra = {}) => ({
  itemId,
  resourceId,
  definitionId: resourceId,
  assetId: extra.assetId ?? resourceId,
  rating: 85,
  ...extra,
});

test("duplicate relations keep exact owned copies bucketed by location", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: [item("storage-copy", "version-1")],
    unassigned: [item("blocking-copy", "version-1", { isDuplicate: true })],
    storageCapacity: 100,
  });

  const snapshot = inventory.getDuplicateRelations();
  assert.equal(snapshot.inventoryGeneration, 1);
  assert.equal(snapshot.transferSourceAvailable, false);
  assert.equal(snapshot.relations.length, 1);
  assert.deepEqual(snapshot.relations[0].copies, {
    club: [{ itemId: "club-copy", location: "club", resourceId: "version-1", definitionId: "version-1" }],
    sbcStorage: [{ itemId: "storage-copy", location: "sbc_storage", resourceId: "version-1", definitionId: "version-1" }],
    unassigned: [{ itemId: "blocking-copy", location: "unassigned", resourceId: "version-1", definitionId: "version-1" }],
    transfer: null,
  });
  assert.deepEqual(snapshot.relations[0].blockingUnassignedItemIds, ["blocking-copy"]);
  assert.equal(Object.isFrozen(snapshot.relations[0].copies), true);
});

test("base and promo versions sharing one footballer remain unrelated", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("base", "base-version", { assetId: "footballer" })],
    storage: [],
    unassigned: [item("promo", "promo-version", { assetId: "footballer" })],
  });
  assert.equal(inventory.getDuplicateRelations().relations.length, 0);
});

test("server duplicate without exact version identity stays ambiguous", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [],
    storage: [],
    unassigned: [{ itemId: "ambiguous", assetId: "footballer", isDuplicate: true }],
  });
  const relations = inventory.getDuplicateRelations();
  assert.equal(relations.relations.length, 0);
  assert.deepEqual(relations.ambiguousItemRefs.map(({ itemId }) => itemId), ["ambiguous"]);
});
