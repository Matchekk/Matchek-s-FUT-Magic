import test from "node:test";
import assert from "node:assert/strict";

import { PackService } from "../src/packs/pack-service.js";

test("pack service never calls adapter while unassigned items exist", async () => {
  let openCalls = 0;
  const service = new PackService({
    adapter: {
      listOwnedPacks: async () => [{ packId: "reward", owned: true, source: "reward" }],
      openOwnedPack: async () => { openCalls += 1; },
    },
    inventoryService: {
      getState: async () => ({ unassignedCount: 1 }),
      refresh: async () => ({}),
    },
  });

  await assert.rejects(() => service.open({ currentReward: { packId: "reward" } }), { code: "UNASSIGNED_BLOCKING" });
  assert.equal(openCalls, 0);
});

test("pack service stops safely after an opened pack creates unassigned items", async () => {
  const calls = [];
  const service = new PackService({
    adapter: {
      listOwnedPacks: async () => [
        { packId: "one", packType: "upgrade", owned: true, source: "reward" },
        { packId: "two", packType: "upgrade", owned: true, source: "reward" },
      ],
      openOwnedPack: async ({ packId }) => {
        calls.push(packId);
        return { opened: true, items: [{ itemId: `item-${packId}` }] };
      },
    },
    inventoryService: {
      getState: async () => ({ unassignedCount: 0 }),
      refresh: async () => ({ unassignedCount: 1 }),
    },
  });

  const result = await service.open({
    policy: { mode: "OPEN_MATCHING_PACKS" },
    currentReward: { packType: "upgrade" },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "UNASSIGNED_BLOCKING");
  assert.deepEqual(calls, ["one"]);
});

test("pack service rejects unverifiable open responses", async () => {
  const service = new PackService({
    adapter: {
      listOwnedPacks: async () => [{ packId: "reward", owned: true, source: "reward" }],
      openOwnedPack: async () => ({ success: true }),
    },
    inventoryService: {
      getState: async () => ({ unassignedCount: 0 }),
      refresh: async () => ({ unassignedCount: 0 }),
    },
  });
  await assert.rejects(() => service.open({ currentReward: { packId: "reward" } }), { code: "PACK_OPEN_UNVERIFIED" });
});
