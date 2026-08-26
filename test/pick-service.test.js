import test from "node:test";
import assert from "node:assert/strict";

import { PlayerPickService } from "../src/picks/player-pick-service.js";

test("player-pick service previews intent without selecting", async () => {
  let selections = 0;
  const service = new PlayerPickService({
    adapter: {
      getPlayerPick: async () => ({ pickIdentity: "pick", pending: true, offers: [{ itemId: "85", resourceId: "r85", rating: 85 }, { itemId: "90", resourceId: "r90", rating: 90 }] }),
      selectPlayerPick: async () => { selections += 1; },
    },
  });
  const result = await service.handle({ pickId: "pick", policy: { type: "HIGHEST_RATING" } });
  assert.equal(result.selectedItemId, "90");
  assert.equal(result.status, "selected");
  assert.equal(selections, 0);
});

test("player-pick execution requires approval and verifies selected item", async () => {
  let selections = 0;
  const service = new PlayerPickService({
    adapter: {
      getPlayerPick: async () => ({ pickIdentity: "pick", pending: true, offers: [{ itemId: "85", resourceId: "r85", rating: 85 }, { itemId: "90", resourceId: "r90", rating: 90 }] }),
      selectPlayerPick: async ({ itemId }) => {
        selections += 1;
        return { success: true, selectedItemId: itemId };
      },
    },
  });
  assert.equal((await service.handle({ pickId: "pick", policy: { type: "HIGHEST_RATING" }, execute: true })).reason, "DESTRUCTIVE_APPROVAL_REQUIRED");
  const result = await service.handle({ pickId: "pick", policy: { type: "HIGHEST_RATING" }, execute: true, approved: true });
  assert.equal(result.status, "completed");
  assert.equal(selections, 1);
});

test("player-pick recovery requires a positive owned-instance delta", async () => {
  const service = new PlayerPickService({
    adapter: {
      getPlayerPick: async () => ({ resolved: true, pending: false, offers: [] }),
      selectPlayerPick: async () => ({ success: true }),
    },
  });
  const intent = {
    pickIdentity: "pick",
    selectedItemId: "offer-90",
    selectedResourceId: "resource-90",
    inventoryItemIdsBefore: ["existing-copy"],
    selectedResourceCountBefore: 1,
  };
  const ambiguous = await service.recover(intent, {
    inventoryItems: [{ itemId: "existing-copy", resourceId: "resource-90" }],
  });
  assert.equal(ambiguous.status, "ambiguous");
  const completed = await service.recover(intent, {
    inventoryItems: [
      { itemId: "existing-copy", resourceId: "resource-90" },
      { itemId: "new-copy", resourceId: "resource-90" },
    ],
  });
  assert.equal(completed.status, "completed");
});
