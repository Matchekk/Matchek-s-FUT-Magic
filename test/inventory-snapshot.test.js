import test from "node:test";
import assert from "node:assert/strict";

import {
  InventoryGenerationConflictError,
  InventoryIdentityConflictError,
  InventoryService,
  InventorySnapshotStore,
} from "../src/inventory/index.js";

const item = (itemId, resourceId) => ({
  itemId,
  resourceId,
  definitionId: resourceId,
  assetId: resourceId,
  rating: 80,
});

test("club, storage, and unassigned publish as one atomic generation", () => {
  const inventory = new InventoryService({
    snapshotStore: new InventorySnapshotStore({
      clock: () => "2026-08-24T12:00:00.000Z",
    }),
  });
  const snapshot = inventory.synchronize({
    club: [item(1, 101)],
    storage: [item(2, 102)],
    unassigned: [item(3, 103)],
    storageCapacity: 5,
  });

  assert.equal(snapshot.generation, 1);
  assert.equal(snapshot.club.generation, 1);
  assert.equal(snapshot.storage.generation, 1);
  assert.equal(snapshot.unassigned.generation, 1);
  assert.equal(snapshot.club.items[0].location, "club");
  assert.equal(snapshot.storage.items[0].location, "sbc_storage");
  assert.equal(snapshot.unassigned.items[0].location, "unassigned");
  assert.equal(snapshot.updatedAt, "2026-08-24T12:00:00.000Z");
  assert.deepEqual(inventory.getStatus(), {
    generation: 1,
    clubCount: 1,
    storageCount: 1,
    storageCapacity: 5,
    storageFreeSlots: 4,
    unassignedCount: 1,
    duplicateGroupCount: 0,
  });
});

test("stale generation writes fail without changing the current snapshot", () => {
  const inventory = new InventoryService();
  const current = inventory.synchronize({
    club: [item("club-1", "r-1")],
    storage: [],
    unassigned: [],
  });

  assert.throws(
    () =>
      inventory.synchronize(
        { club: [], storage: [], unassigned: [] },
        { expectedGeneration: 0 },
      ),
    InventoryGenerationConflictError,
  );
  assert.strictEqual(inventory.getSnapshot(), current);
});

test("invalid next generation cannot partially replace any source", () => {
  const inventory = new InventoryService();
  const current = inventory.synchronize({
    club: [item("original", "r-1")],
    storage: [],
    unassigned: [],
  });

  assert.throws(
    () =>
      inventory.synchronize(
        {
          club: [item(7, "base")],
          storage: [],
          unassigned: [item("7", "promo")],
        },
        { expectedGeneration: 1 },
      ),
    InventoryIdentityConflictError,
  );
  assert.strictEqual(inventory.getSnapshot(), current);
  assert.equal(inventory.findByItemId("original")?.resourceId, "r-1");
});

test("successful compare-and-swap advances every source generation once", () => {
  const inventory = new InventoryService();
  inventory.synchronize({ club: [], storage: [], unassigned: [] });
  const next = inventory.synchronize(
    {
      club: [item("c", "1")],
      storage: [item("s", "2")],
      unassigned: [item("u", "3")],
      storageCapacity: 2,
    },
    { expectedGeneration: 1 },
  );
  assert.equal(next.generation, 2);
  assert.deepEqual(
    [next.club.generation, next.storage.generation, next.unassigned.generation],
    [2, 2, 2],
  );
});

