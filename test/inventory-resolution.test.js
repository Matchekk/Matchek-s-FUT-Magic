import test from "node:test";
import assert from "node:assert/strict";

import {
  INVENTORY_RESOLUTION_ACTIONS as ACTION,
  InventoryService,
} from "../src/inventory/index.js";

const item = (itemId, resourceId, overrides = {}) => ({
  itemId,
  resourceId,
  definitionId: resourceId,
  assetId: `asset-${resourceId}`,
  rating: 84,
  isTradeable: false,
  isMovable: true,
  isStorable: true,
  ...overrides,
});

test("normal unassigned item goes to Club and its next copy goes to Storage", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [],
    storage: [],
    unassigned: [item("first", "version-1"), item("second", "version-1")],
    storageCapacity: 1,
  });

  const plan = inventory.planUnassignedResolution();
  assert.deepEqual(
    plan.actions.map(({ itemId, type }) => ({ itemId, type })),
    [
      { itemId: "first", type: ACTION.SEND_TO_CLUB },
      { itemId: "second", type: ACTION.MOVE_TO_SBC_STORAGE },
    ],
  );
  assert.equal(plan.canContinueWorkflow, true);
  assert.equal(plan.projectedStorageFreeSlots, 0);
});

test("untradeable Club duplicate uses an available SBC Storage slot", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: [],
    unassigned: [item("new-copy", "version-1")],
    storageCapacity: 1,
  });

  const plan = inventory.planUnassignedResolution();
  assert.equal(plan.actions[0].type, ACTION.MOVE_TO_SBC_STORAGE);
  assert.equal(plan.actions[0].reason, "duplicate_storage_available");
  assert.equal(plan.paused, false);
});

test("untradeable duplicate pauses safely when SBC Storage is full", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: [item("stored-other", "version-2")],
    unassigned: [item("new-copy", "version-1")],
    storageCapacity: 1,
  });

  const plan = inventory.planUnassignedResolution();
  assert.equal(plan.actions[0].type, ACTION.PAUSE);
  assert.equal(
    plan.actions[0].reason,
    "untradeable_duplicate_storage_unavailable",
  );
  assert.equal(plan.paused, true);
  assert.equal(plan.canContinueWorkflow, false);
  assert.doesNotMatch(JSON.stringify(plan), /quicksell/i);
});

test("tradable duplicate is held safely when Storage is full", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: [item("stored-other", "version-2")],
    unassigned: [
      item("tradable-copy", "version-1", {
        isTradeable: true,
        isUntradeable: false,
      }),
    ],
    storageCapacity: 1,
  });

  const plan = inventory.planUnassignedResolution();
  assert.equal(plan.actions[0].type, ACTION.SAFE_HOLD);
  assert.equal(plan.paused, false);
  assert.equal(plan.requiresUserAction, true);
  assert.equal(plan.canContinueWorkflow, false);
});

test("a server-marked duplicate without version identity pauses instead of guessing", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [],
    storage: [],
    unassigned: [{ itemId: "ambiguous", rating: 90, isDuplicate: true }],
    storageCapacity: 10,
  });

  const plan = inventory.planUnassignedResolution();
  assert.equal(plan.actions[0].type, ACTION.PAUSE);
  assert.equal(plan.actions[0].reason, "duplicate_identity_ambiguous");
});

test("EA-unstorable duplicate goes to organizer policy even with a free slot", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: [],
    unassigned: [item("new-copy", "version-1", { isStorable: false })],
    storageCapacity: 1,
  });

  const plan = inventory.planUnassignedResolution();
  assert.equal(plan.actions[0].type, ACTION.PAUSE);
  assert.equal(plan.actions[0].reason, "untradeable_duplicate_storage_unavailable");
  assert.equal(plan.requiresUserAction, true);
});

test("a paused duplicate does not prevent later safe cards from being planned", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")], storage: [item("stored", "version-2")],
    unassigned: [item("blocked", "version-1"), item("safe-a", "version-3"), item("safe-b", "version-4")], storageCapacity: 1,
  });
  const plan = inventory.planUnassignedResolution();
  assert.deepEqual(plan.actions.map(({ itemId, type }) => [itemId, type]), [
    ["blocked", ACTION.PAUSE], ["safe-a", ACTION.SEND_TO_CLUB], ["safe-b", ACTION.SEND_TO_CLUB],
  ]);
});

test("FC 26 SBC Storage never plans beyond its authoritative 100 slots", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [item("club-copy", "version-1")],
    storage: Array.from({ length: 100 }, (_, index) => item(`stored-${index}`, `stored-version-${index}`)),
    unassigned: [item("blocked", "version-1")], storageCapacity: 120,
  });
  assert.equal(inventory.planUnassignedResolution().actions[0].type, ACTION.PAUSE);
});

test("resolution policy rejects any implicit quicksell fallback", () => {
  const inventory = new InventoryService();
  inventory.synchronize({ club: [], storage: [], unassigned: [] });
  assert.throws(
    () =>
      inventory.planUnassignedResolution({
        untradeableWhenStorageUnavailable: "QUICKSELL",
      }),
    /SAFE_HOLD or PAUSE/,
  );
});

test("missing movement evidence blocks before any automatic route", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [],
    storage: [],
    unassigned: [{
      itemId: "unknown-move",
      resourceId: "version",
      definitionId: "version",
      isTradable: false,
    }],
    storageCapacity: 10,
  });
  const [action] = inventory.planUnassignedResolution().actions;
  assert.equal(action.type, ACTION.PAUSE);
  assert.equal(action.reason, "unassigned_move_evidence_unverified");
});

