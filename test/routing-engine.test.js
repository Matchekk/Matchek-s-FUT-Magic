import test from "node:test";
import assert from "node:assert/strict";

import { InventoryService } from "../src/inventory/index.js";
import {
  RoutingDestination,
  RoutingEngine,
  RoutingReason,
  validateRoutingPlan,
} from "../src/routing/index.js";

const evidenced = (itemId, resourceId, extra = {}) => ({
  itemId,
  resourceId,
  definitionId: resourceId,
  assetId: resourceId,
  rating: 85,
  isTradable: false,
  isMovable: true,
  isStorable: true,
  isLocked: false,
  isProtected: false,
  isInStartingSquad: false,
  isSpecial: false,
  ...extra,
});

const snapshot = ({ club = [], storage = [], unassigned = [], capacity = 100 } = {}) => {
  const inventory = new InventoryService();
  return inventory.synchronize({ club, storage, unassigned, storageCapacity: capacity });
};

const ruleset = (rules = []) => ({ schemaVersion: 1, id: "test", rules });

test("default routing preserves current safe Club and Storage behavior", () => {
  const state = snapshot({
    club: [evidenced("club-copy", "duplicate-version")],
    unassigned: [
      evidenced("new-card", "new-version"),
      evidenced("duplicate", "duplicate-version", { isDuplicate: true }),
    ],
  });
  const plan = new RoutingEngine().plan({ inventorySnapshot: state, ruleset: ruleset() });
  assert.deepEqual(plan.decisions.map(({ itemRef, destination }) => [itemRef.itemId, destination]), [
    ["duplicate", RoutingDestination.SBC_STORAGE],
    ["new-card", RoutingDestination.CLUB],
  ]);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.canExecute, false);
  assert.equal(plan.decisions.every(({ explanation }) => explanation.length > 0), true);
});

test("rule priority is deterministic regardless of input order", () => {
  const state = snapshot({
    unassigned: [evidenced("card", "version")],
  });
  const rules = [
    { id: "keep", priority: 20, destination: RoutingDestination.KEEP_UNASSIGNED, criteria: {} },
    { id: "club", priority: 10, destination: RoutingDestination.CLUB, criteria: {} },
  ];
  const engine = new RoutingEngine();
  const first = engine.plan({ inventorySnapshot: state, ruleset: ruleset(rules) });
  const second = engine.plan({ inventorySnapshot: state, ruleset: ruleset([...rules].reverse()) });
  assert.equal(first.decisions[0].ruleId, "club");
  assert.deepEqual(first, second);
});

test("protection overrides a consuming recipe rule", () => {
  const state = snapshot({
    club: [evidenced("club-copy", "version")],
    unassigned: [evidenced("duplicate", "version", { isDuplicate: true })],
  });
  const plan = new RoutingEngine().plan({
    inventorySnapshot: state,
    ruleset: ruleset([{
      id: "recipe",
      priority: 1,
      destination: RoutingDestination.ACTIVE_RECIPE,
      criteria: { duplicate: true },
    }]),
    protectionAnalysis: { protectedItemIds: ["duplicate"] },
    recipeCandidates: [{ verified: true, acceptedItemIds: ["duplicate"] }],
  });
  assert.equal(plan.decisions[0].destination, RoutingDestination.ASK_USER);
  assert.deepEqual(plan.decisions[0].reasonCodes, [RoutingReason.PROTECTED_FROM_CONSUMPTION]);
});

test("missing evidence cannot become a consuming or storage route", () => {
  const state = snapshot({
    club: [evidenced("club-copy", "version")],
    unassigned: [{
      itemId: "unknown",
      resourceId: "version",
      definitionId: "version",
      rating: 85,
      isDuplicate: true,
    }],
  });
  const plan = new RoutingEngine().plan({ inventorySnapshot: state, ruleset: ruleset() });
  assert.equal(plan.decisions[0].destination, RoutingDestination.ASK_USER);
  assert.equal(plan.decisions[0].reasonCodes[0], RoutingReason.TRADEABILITY_UNVERIFIED);
});

test("full storage preserves a tradeable duplicate and asks for an untradeable one", () => {
  const state = snapshot({
    club: [evidenced("club-a", "a"), evidenced("club-b", "b")],
    storage: [evidenced("storage", "storage")],
    unassigned: [
      evidenced("a-copy", "a", { isDuplicate: true, isTradable: true }),
      evidenced("b-copy", "b", { isDuplicate: true }),
    ],
    capacity: 1,
  });
  const plan = new RoutingEngine().plan({ inventorySnapshot: state, ruleset: ruleset() });
  assert.deepEqual(plan.decisions.map(({ destination }) => destination), [
    RoutingDestination.KEEP_UNASSIGNED,
    RoutingDestination.ASK_USER,
  ]);
});

test("Activity Guard and stale evidence fail closed", () => {
  const state = snapshot({ unassigned: [evidenced("card", "version")] });
  const plan = new RoutingEngine().plan({
    inventorySnapshot: state,
    ruleset: ruleset(),
    activityGuard: { state: "CAUTION" },
  });
  assert.equal(plan.decisions[0].destination, RoutingDestination.ASK_USER);
  assert.equal(plan.decisions[0].reasonCodes[0], RoutingReason.ACTIVITY_GUARD_BLOCKED);
  assert.deepEqual(validateRoutingPlan(plan, {
    inventoryGeneration: state.generation + 1,
    inventoryFingerprint: plan.inventoryFingerprint,
    rulesetFingerprint: plan.rulesetFingerprint,
  }), {
    valid: false,
    blockers: ["STALE_INVENTORY_GENERATION"],
  });
});
