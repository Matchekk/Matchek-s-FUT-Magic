import test from "node:test";
import assert from "node:assert/strict";

import { decidePlayerPick } from "../src/picks/pick-policy.js";

const offers = [
  { itemId: "base-owned", resourceId: "same-player", rating: 89, estimatedValue: 20000, cardType: "BASE" },
  { itemId: "promo-owned", resourceId: "same-player", rating: 96, estimatedValue: 500000, cardType: "PROMO" },
];

test("player picks pause for the user by default", () => {
  const decision = decidePlayerPick(offers);
  assert.equal(decision.status, "paused");
  assert.equal(decision.reason, "USER_SELECTION_REQUIRED");
});

test("same player card versions remain separate owned pick options", () => {
  const decision = decidePlayerPick(offers, { type: "HIGHEST_RATING" });
  assert.equal(decision.status, "selected");
  assert.equal(decision.selectedItemId, "promo-owned");
  assert.equal(decision.offers.length, 2);
});

test("rating and value ties pause instead of silently selecting", () => {
  const tied = [
    { itemId: "a", rating: 90, estimatedValue: 10000 },
    { itemId: "b", rating: 90, estimatedValue: 10000 },
  ];
  assert.equal(decidePlayerPick(tied, { type: "HIGHEST_RATING" }).reason, "AMBIGUOUS_PICK");
  assert.equal(decidePlayerPick(tied, { type: "HIGHEST_VALUE" }).reason, "AMBIGUOUS_PICK");
});

test("highest-value policy falls back to rating value when prices are missing", () => {
  const decision = decidePlayerPick(
    [
      { itemId: "low", rating: 86 },
      { itemId: "high", rating: 91 },
    ],
    { type: "HIGHEST_VALUE" },
  );
  assert.equal(decision.status, "selected");
  assert.equal(decision.selectedItemId, "high");
});

test("typed custom priority resolves lexicographically", () => {
  const decision = decidePlayerPick([
    { itemId: "duplicate-95", rating: 95, isDuplicate: true, cardType: "BASE" },
    { itemId: "new-92", rating: 92, isDuplicate: false, cardType: "BASE" },
  ], {
    type: "CUSTOM_PRIORITY",
    criteria: ["NON_DUPLICATE", "RATING"],
  });
  assert.equal(decision.selectedItemId, "new-92");
});

test("required-special policy pauses when multiple required options remain", () => {
  const decision = decidePlayerPick([
    { itemId: "special-a", rating: 90, cardType: "TOTW" },
    { itemId: "special-b", rating: 91, cardType: "TOTW" },
  ], { type: "PREFER_REQUIRED_SPECIAL", requiredSpecialTypes: ["TOTW"] });
  assert.equal(decision.status, "paused");
  assert.equal(decision.reason, "AMBIGUOUS_PICK");
});
