import test from "node:test";
import assert from "node:assert/strict";

import { PlayerPickService } from "../src/picks/player-pick-service.js";

test("player-pick service previews intent without selecting", async () => {
  let selections = 0;
  const service = new PlayerPickService({
    adapter: {
      getPlayerPick: async () => ({ offers: [{ itemId: "85", rating: 85 }, { itemId: "90", rating: 90 }] }),
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
      getPlayerPick: async () => ({ offers: [{ itemId: "85", rating: 85 }, { itemId: "90", rating: 90 }] }),
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
