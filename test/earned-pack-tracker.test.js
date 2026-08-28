import test from "node:test";
import assert from "node:assert/strict";

import { EarnedPackTracker } from "../src/packs/earned-pack-tracker.js";

const pack = (packId, count = 1, extra = {}) => ({
  packId,
  packType: "gold-reward",
  count,
  owned: true,
  source: "reward",
  ...extra,
});

const correlate = (before, after, claimEvidence = {}) => EarnedPackTracker.correlate({
  before,
  after,
  claimEvidence,
  operationId: "claim:one",
  sourceChallenge: "challenge:one",
  inventoryGeneration: 7,
  correlatedAt: 100,
});

test("tracks one newly earned owned instance and binds its operation", () => {
  const result = correlate([], [pack("earned")], { packId: "earned" });
  assert.equal(result.binding.operationId, "claim:one");
  assert.equal(result.binding.packRef.packId, "earned");
  assert.equal(result.binding.identityKind, "owned_instance");
  assert.equal(result.binding.quantityDelta, 1);
  assert.equal(result.binding.inventoryGeneration, 7);
  assert.equal(Object.isFrozen(result.binding), true);
  assert.equal(EarnedPackTracker.resolve(result.binding, [pack("earned")]).packId, "earned");
});

test("tracks exactly one unit added to an existing homogeneous stack", () => {
  const result = correlate([pack("stack", 3)], [pack("stack", 4)]);
  assert.equal(result.binding.identityKind, "verified_fungible_stack");
  assert.equal(result.binding.quantityDelta, 1);
});

test("rejects plus two, no delta, multiple positive IDs and explicit mismatch", () => {
  for (const [before, after, claim] of [
    [[pack("stack", 1)], [pack("stack", 3)], {}],
    [[pack("stack", 1)], [pack("stack", 1)], {}],
    [[], [pack("a"), pack("b")], {}],
    [[], [pack("a")], { packId: "b" }],
  ]) {
    assert.throws(
      () => correlate(before, after, claim),
      { code: "AMBIGUOUS_REWARD_PACK" },
    );
  }
});

test("rejects multiple rows with one shared ID and non-homogeneous stacks", () => {
  assert.throws(
    () => correlate([], [pack("same"), pack("same", 0)]),
    { code: "AMBIGUOUS_REWARD_PACK" },
  );
  assert.throws(
    () => correlate(
      [pack("stack", 1, { packType: "gold" })],
      [pack("stack", 2, { packType: "silver" })],
    ),
    { code: "AMBIGUOUS_REWARD_PACK" },
  );
});

test("a binding cannot resolve a same-name different pack or duplicated rows", () => {
  const { binding } = correlate([], [pack("earned")]);
  assert.throws(
    () => EarnedPackTracker.resolve(binding, [pack("different", 1, { name: "Same visible name" })]),
    { code: "REWARD_PACK_AMBIGUOUS" },
  );
  assert.throws(
    () => EarnedPackTracker.resolve(binding, [pack("earned"), pack("earned", 0)]),
    { code: "REWARD_PACK_AMBIGUOUS" },
  );
});

test("malformed counts and purchasable packs fail before correlation", () => {
  assert.throws(() => correlate([], [pack("bad", -1)]), { code: "INVALID_PACKS" });
  assert.throws(
    () => correlate([], [pack("store", 1, { owned: false, source: "store", coinCost: 7500 })]),
    { code: "PURCHASE_FORBIDDEN" },
  );
});
