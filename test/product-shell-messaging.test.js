import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFutMagicPanelCommand } from "../src/presentation/product-shell-protocol.js";

test("Side Panel command schema accepts only bounded allowlisted shapes", () => {
  assert.deepEqual(
    normalizeFutMagicPanelCommand({ type: "PREVIEW_CLEAR_DUPLICATES" }),
    { type: "PREVIEW_CLEAR_DUPLICATES" },
  );
  assert.deepEqual(
    normalizeFutMagicPanelCommand({ type: "PREVIEW_FODDER_REVIEW" }),
    { type: "PREVIEW_FODDER_REVIEW" },
  );
  assert.deepEqual(
    normalizeFutMagicPanelCommand({
      type: "APPROVE_CLEAR_DUPLICATES_PLAN",
      planId: "route-plan-1",
    }),
    { type: "APPROVE_CLEAR_DUPLICATES_PLAN", planId: "route-plan-1" },
  );
  assert.equal(normalizeFutMagicPanelCommand({
    type: "APPROVE_CLEAR_DUPLICATES_PLAN",
    planId: "route-plan-1",
    expectedActions: [{ itemId: "injected" }],
  }), null);
  assert.equal(normalizeFutMagicPanelCommand({
    type: "APPROVE_CLEAR_DUPLICATES_PLAN",
    planId: "x".repeat(129),
  }), null);
  assert.equal(normalizeFutMagicPanelCommand({
    type: "ORGANIZE_ITEMS",
  }), null);
  assert.equal(normalizeFutMagicPanelCommand(null), null);
});
