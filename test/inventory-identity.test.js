import test from "node:test";
import assert from "node:assert/strict";

import {
  InventoryIdentityConflictError,
  InventoryService,
  normalizeInventoryItem,
} from "../src/inventory/index.js";

const base89 = {
  itemId: "owned-base-89",
  resourceId: 100158023,
  definitionId: 100158023,
  assetId: 158023,
  baseId: 158023,
  rating: 89,
  cardType: "BASE",
};

const promo96 = {
  itemId: "owned-promo-96",
  resourceId: 505158023,
  definitionId: 505158023,
  assetId: 158023,
  baseId: 158023,
  rating: 96,
  cardType: "PROMO",
  isSpecial: true,
};

test("owned item, card version, and footballer identifiers remain separate", () => {
  const item = normalizeInventoryItem(base89, { location: "club" });
  assert.equal(item.itemId, "owned-base-89");
  assert.equal(item.resourceId, "100158023");
  assert.equal(item.definitionId, "100158023");
  assert.equal(item.assetId, "158023");
  assert.equal(item.baseId, "158023");
  assert.equal(item.location, "club");
});

test("same footballer base and promo versions remain separate and are not duplicates", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [base89, promo96],
    storage: [],
    unassigned: [],
    storageCapacity: 100,
  });

  assert.equal(inventory.getItems().length, 2);
  assert.deepEqual(
    inventory.getItems().map((item) => item.itemId),
    ["owned-base-89", "owned-promo-96"],
  );
  assert.equal(inventory.getDuplicateGroups().length, 0);
});

test("two owned copies of the same card version form one duplicate group", () => {
  const inventory = new InventoryService();
  inventory.synchronize({
    club: [promo96],
    storage: [],
    unassigned: [{ ...promo96, itemId: "owned-promo-96-copy" }],
  });

  const [group] = inventory.getDuplicateGroups();
  assert.equal(group.key, "resource:505158023");
  assert.deepEqual(group.itemIds, ["owned-promo-96", "owned-promo-96-copy"]);
});

test("numeric and string item IDs canonicalize to the same owned identity", () => {
  const numeric = normalizeInventoryItem(
    { ...base89, itemId: 42 },
    { location: "club" },
  );
  const text = normalizeInventoryItem(
    { ...promo96, itemId: "42" },
    { location: "unassigned" },
  );
  assert.equal(numeric.itemId, "42");
  assert.equal(text.itemId, "42");

  const inventory = new InventoryService();
  assert.throws(
    () =>
      inventory.synchronize({
        club: [{ ...base89, itemId: 42 }],
        storage: [],
        unassigned: [{ ...promo96, itemId: "42" }],
      }),
    InventoryIdentityConflictError,
  );
});

