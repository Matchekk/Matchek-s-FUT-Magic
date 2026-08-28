import test from "node:test";
import assert from "node:assert/strict";

import {
  PACK_OPEN_MODES,
  PackPolicyError,
  assertNoUnassigned,
  normalizePackPolicy,
  selectPacksForPolicy,
} from "../src/packs/pack-policy.js";
import { identifyClaimedRewardPack } from "../src/packs/reward-service.js";

test("pack policy rejects every purchase intent", () => {
  for (const forbidden of ["allowPurchases", "allowStorePacks", "spendCoins", "spendPoints", "useFcPoints"]) {
    assert.throws(() => normalizePackPolicy({ [forbidden]: true }), (error) => {
      assert.equal(error.code, "PURCHASE_FORBIDDEN");
      return true;
    });
  }
});

test("current reward mode opens only the uniquely identified free owned pack", () => {
  const selected = selectPacksForPolicy({
    packs: [
      { packId: "reward-1", packType: "gold", owned: true, source: "reward" },
      { packId: "other", packType: "gold", owned: true, source: "reward" },
      { packId: "store", packType: "gold", source: "store", coinCost: 7500 },
    ],
    policy: { mode: PACK_OPEN_MODES.CURRENT_REWARD },
    currentReward: { packId: "reward-1" },
  });
  assert.deepEqual(selected.map((pack) => pack.packId), ["reward-1"]);
});

test("unresolved unassigned items block pack opening", () => {
  assert.throws(() => assertNoUnassigned({ unassigned: [{ itemId: "owned-1" }] }), (error) => {
    assert.equal(error.code, "UNASSIGNED_BLOCKING");
    return true;
  });
});

test("missing unassigned state is ambiguous and blocks pack opening", () => {
  assert.throws(() => assertNoUnassigned({}), { code: "INVENTORY_STATE_UNVERIFIED" });
});

test("reward identification refuses ambiguous pack snapshot changes", () => {
  assert.throws(() => identifyClaimedRewardPack({
    claim: { success: true },
    packsBefore: [],
    packsAfter: [
      { packId: "a", owned: true, source: "reward" },
      { packId: "b", owned: true, source: "reward" },
    ],
  }), (error) => error instanceof PackPolicyError && error.code === "REWARD_PACK_AMBIGUOUS");
});

test("reward identification refuses a plus-two delta on one pack ID", () => {
  assert.throws(() => identifyClaimedRewardPack({
    claim: { success: true },
    packsBefore: [{ packId: "a", count: 1, owned: true, source: "reward" }],
    packsAfter: [{ packId: "a", count: 3, owned: true, source: "reward" }],
  }), (error) => error instanceof PackPolicyError && error.code === "REWARD_PACK_AMBIGUOUS");
});
