import test from "node:test";
import assert from "node:assert/strict";

import { applyPlayerValuePolicy } from "../solver/player-policy.js";

test("preferred player IDs are assigned zero replacement value", () => {
  const result = applyPlayerValuePolicy(
    [
      { id: "normal", rating: 75, price: 100 },
      { id: "preferred", rating: 90, price: 100000 },
    ],
    { preferredPlayerIds: ["preferred"] },
  );
  assert.equal(result[0].id, "preferred");
  assert.equal(result[0].selectionPolicy.effectiveValue, 0);
});
test("duplicate and untradeable discounts compose deterministically", () => {
  const [result] = applyPlayerValuePolicy(
    [{ id: "1", rating: 80, price: 1000, isDuplicate: true, isUntradeable: true }],
    { duplicateValuePercent: 50, untradeableValuePercent: 80 },
  );
  assert.equal(result.selectionPolicy.effectiveValue, 400);
});

test("policy does not mutate caller-owned player objects", () => {
  const player = { id: "1", rating: 80, price: 1000 };
  applyPlayerValuePolicy([player], {});
  assert.equal(Object.hasOwn(player, "selectionPolicy"), false);
});
