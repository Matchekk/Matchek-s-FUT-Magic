import test from "node:test";
import assert from "node:assert/strict";

import {
  compareObjectiveTuples,
  FodderPolicy,
} from "../src/policies/fodder-policy.js";

const card = (itemId, rating, overrides = {}) => ({
  itemId: String(itemId),
  resourceId: String(100000 + Number(itemId)),
  basePlayerId: String(200000 + Number(itemId)),
  rating,
  cardType: "base",
  isSpecial: false,
  isUntradeable: true,
  ...overrides,
});

test("hard protections are item-aware and allowed special types are configurable", () => {
  const items = [
    card(1, 89),
    card(2, 96, { cardType: "promo", isSpecial: true }),
    card(3, 84, { cardType: "totw", isSpecial: true }),
    card(4, 82, { resourceId: "locked-resource" }),
  ];
  const policy = new FodderPolicy({
    protectRatingAtOrAbove: 94,
    allowedSpecialTypes: ["totw"],
    protectedResourceIds: ["locked-resource"],
  });
  const analysis = policy.analyze(items);
  assert.deepEqual(analysis.protectedItemIds.sort(), ["2", "4"]);
  assert.match(analysis.reasonsByItemId["2"].join(" "), /protected-rating/);
  assert.equal(analysis.reasonsByItemId["3"], undefined);
});

test("minimum reserves remain soft while duplicates receive the better objective", () => {
  const policy = new FodderPolicy({ minimumReserveByRating: { 89: 2 } });
  const analysis = policy.analyze([
    card(1, 89, { isTradable: true, isUntradeable: false, marketPrice: 30000 }),
    card(2, 89, { marketPrice: 20000 }),
    card(3, 89, { isDuplicate: true, isStorage: true, marketPrice: 10000 }),
  ]);
  assert.deepEqual(analysis.protectedItemIds, []);
  assert.deepEqual(analysis.eligibleItems.map((item) => item.itemId), ["1", "2", "3"]);
  const duplicateTuple = policy.getSquadObjectiveTuple([analysis.items[2]], {
    allItems: analysis.items,
  });
  const scarceTradableTuple = policy.getSquadObjectiveTuple([analysis.items[0]], {
    allItems: analysis.items,
  });
  assert.ok(compareObjectiveTuples(duplicateTuple, scarceTradableTuple) < 0);
});

test("objective tuples compare lexicographically and protected use dominates price", () => {
  const protectedCard = card(1, 94, { marketPrice: 0 });
  const expendable = card(2, 86, {
    marketPrice: 100000,
    isDuplicate: true,
    isStorage: true,
  });
  const policy = new FodderPolicy({
    protectRatingAtOrAbove: 94,
    preferredFodderRange: [80, 88],
  });
  const allItems = [protectedCard, expendable];
  const protectedTuple = policy.getSquadObjectiveTuple([protectedCard], {
    allItems,
  });
  const expendableTuple = policy.getSquadObjectiveTuple([expendable], {
    allItems,
  });
  assert.equal(protectedTuple[1], 1);
  assert.equal(expendableTuple[1], 0);
  assert.ok(compareObjectiveTuples(expendableTuple, protectedTuple) < 0);
});
