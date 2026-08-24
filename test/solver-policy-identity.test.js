import test from "node:test";
import assert from "node:assert/strict";

import {
  hasSameFootballer,
  normalizeOwnedItems,
} from "../src/sbc/solver/item-identity.js";
import { FodderPolicy } from "../src/policies/fodder-policy.js";

test("base and promo versions remain separate owned items", () => {
  const [base, promo] = normalizeOwnedItems([
    {
      itemId: 9001,
      resourceId: 240001,
      basePlayerId: 240001,
      rating: 89,
      cardType: "base",
    },
    {
      itemId: 9002,
      resourceId: 50571649,
      basePlayerId: 240001,
      rating: 96,
      cardType: "promo",
    },
  ]);
  assert.equal(base.itemId, "9001");
  assert.equal(promo.itemId, "9002");
  assert.notEqual(base.resourceId, promo.resourceId);
  assert.equal(hasSameFootballer(base, promo), true);
});

test("duplicate owned copies are keyed by item ID, never resource ID", () => {
  const items = normalizeOwnedItems([
    { itemId: 9001, resourceId: 240001, basePlayerId: 240001 },
    { itemId: 9003, resourceId: 240001, basePlayerId: 240001, isDuplicate: true },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.itemId), ["9001", "9003"]);
});

test("resource protection can target one version while player protection targets all versions", () => {
  const items = [
    {
      itemId: 9001,
      resourceId: 240001,
      basePlayerId: 240001,
      rating: 89,
      cardType: "base",
    },
    {
      itemId: 9002,
      resourceId: 50571649,
      basePlayerId: 240001,
      rating: 96,
      cardType: "promo",
      isSpecial: true,
    },
  ];
  assert.deepEqual(
    new FodderPolicy({ protectedResourceIds: [50571649] }).getProtectedItemIds(items),
    ["9002"],
  );
  assert.deepEqual(
    new FodderPolicy({ protectedPlayerIds: [240001] }).getProtectedItemIds(items),
    ["9001", "9002"],
  );
});
