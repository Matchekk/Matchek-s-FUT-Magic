import test from "node:test";
import assert from "node:assert/strict";

import {
  recommendRouterNextAction,
  RouterActivityGuardState,
  RouterNextActionKind,
  RouterNextActionReason,
  RouterNextActionState,
} from "../src/application/index.js";
import { InventoryService } from "../src/inventory/index.js";
import { summarizeDuplicateRoute } from "../src/application/duplicate-route-preview.js";

const item = (itemId, resourceId, overrides = {}) => ({
  itemId,
  resourceId,
  definitionId: resourceId,
  rating: 84,
  name: `Card ${itemId}`,
  isDuplicate: false,
  isTradeable: false,
  isMovable: true,
  isStorable: false,
  ...overrides,
});

const capabilities = (overrides = {}) => ({
  capabilities: [
    { id: "ea.inventory.read", state: overrides.inventory || "available", evidence: { source: "test" } },
    { id: "ea.unassigned.read", state: overrides.unassigned || "available", evidence: { source: "test" } },
    { id: "ea.items.move", state: overrides.move || "available", evidence: { source: "test" } },
  ],
});

const makeEvidence = ({
  club = [],
  storage = [],
  unassigned = [],
  storageCapacity = 100,
  capabilitySnapshot = capabilities(),
  gameContext = { gameVersion: "fc26", state: "verified", evidence: { fixture: "fc26" } },
  activityGuard = { state: RouterActivityGuardState.IDLE, evidence: { run: "idle" } },
  routeSummary: suppliedRouteSummary = null,
  ...extra
} = {}) => {
  const inventory = new InventoryService();
  const inventorySnapshot = inventory.synchronize({ club, storage, unassigned, storageCapacity });
  const routeSummary = suppliedRouteSummary || summarizeDuplicateRoute({
    plan: inventory.planUnassignedResolution(),
    inventorySnapshot,
  });
  return {
    inventorySnapshot,
    routeSummary,
    capabilitySnapshot,
    gameContext,
    activityGuard,
    observedAt: inventorySnapshot.updatedAt,
    ...extra,
  };
};

const forbiddenExecutionKeys = new Set([
  "steps", "commands", "command", "routeActions", "approvedActions",
  "actionSetFingerprint", "expectedUnassignedItemIdsBefore", "expectedRemainingItemIdsAfter",
]);

const assertNoExecutionFields = (value) => {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(forbiddenExecutionKeys.has(key), false, `unexpected execution field ${key}`);
    assertNoExecutionFields(entry);
  }
};

test("recommends exactly one verified Club move without producing executable data", () => {
  const result = recommendRouterNextAction(makeEvidence({
    unassigned: [item("unique", "version-1")],
  }));

  assert.equal(result.state, RouterNextActionState.READY);
  assert.equal(result.readOnly, true);
  assert.equal(result.canExecute, false);
  assert.equal(result.outcome.kind, RouterNextActionKind.MOVE_TO_CLUB);
  assert.equal(result.outcome.reasonCode, RouterNextActionReason.UNIQUE_CLUB_MOVE_VERIFIED);
  assert.equal(result.outcome.binding.itemId, "unique");
  assert.equal(result.outcome.destination, "club");
  assertNoExecutionFields(result);
});

test("an exact duplicate with verified evidence recommends SBC Storage", () => {
  const result = recommendRouterNextAction(makeEvidence({
    club: [item("owned", "same-version")],
    unassigned: [item("duplicate", "same-version", {
      isDuplicate: true,
      isMovable: false,
      isStorable: true,
    })],
  }));

  assert.equal(result.state, RouterNextActionState.READY);
  assert.equal(result.outcome.kind, RouterNextActionKind.MOVE_TO_SBC_STORAGE);
  assert.equal(result.outcome.reasonCode, RouterNextActionReason.EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED);
  assert.equal(result.outcome.binding.exactDuplicateKey, "resource:same-version");
});

test("canonical selection and fingerprints are invariant to input and route-action order", () => {
  const evidence = makeEvidence({
    club: [item("owned-b", "version-b"), item("owned-a", "version-a")],
    unassigned: [
      item("dup-b", "version-b", { isDuplicate: true, isMovable: false, isStorable: true }),
      item("dup-a", "version-a", { isDuplicate: true, isMovable: false, isStorable: true }),
    ],
  });
  const first = recommendRouterNextAction(evidence);
  const permuted = {
    ...evidence,
    inventorySnapshot: {
      ...evidence.inventorySnapshot,
      club: { ...evidence.inventorySnapshot.club, items: [...evidence.inventorySnapshot.club.items].reverse() },
      storage: { ...evidence.inventorySnapshot.storage, items: [...evidence.inventorySnapshot.storage.items].reverse() },
      unassigned: { ...evidence.inventorySnapshot.unassigned, items: [...evidence.inventorySnapshot.unassigned.items].reverse() },
      items: [...evidence.inventorySnapshot.items].reverse(),
    },
    routeSummary: {
      ...evidence.routeSummary,
      routeActions: [...evidence.routeSummary.routeActions].reverse(),
    },
    capabilitySnapshot: {
      ...evidence.capabilitySnapshot,
      capabilities: [...evidence.capabilitySnapshot.capabilities].reverse(),
    },
  };
  const second = recommendRouterNextAction(permuted);

  assert.equal(first.outcome.binding.itemId, "dup-a");
  assert.deepEqual(second.outcome, first.outcome);
  assert.equal(second.fingerprints.input, first.fingerprints.input);
  assert.equal(second.fingerprints.decision, first.fingerprints.decision);
});

test("duplicate pressure precedes a unique Club move and storage ties preserve tradable options", () => {
  const evidence = makeEvidence({
    club: [item("owned-u", "version-u"), item("owned-t", "version-t")],
    unassigned: [
      item("tradable", "version-t", {
        isDuplicate: true, isTradeable: true, isMovable: false, isStorable: true,
      }),
      item("unique", "version-new"),
      item("untradeable", "version-u", {
        isDuplicate: true, isTradeable: false, isMovable: false, isStorable: true,
      }),
    ],
    routeSummary: { routeActions: [
      { itemId: "tradable", type: "MOVE_TO_SBC_STORAGE", from: "unassigned", to: "sbc_storage", reason: "duplicate_storage_available" },
      { itemId: "unique", type: "SEND_TO_CLUB", from: "unassigned", to: "club", reason: "not_duplicate" },
      { itemId: "untradeable", type: "MOVE_TO_SBC_STORAGE", from: "unassigned", to: "sbc_storage", reason: "duplicate_storage_available" },
    ] },
  });
  const result = recommendRouterNextAction(evidence);

  assert.equal(result.outcome.kind, RouterNextActionKind.MOVE_TO_SBC_STORAGE);
  assert.equal(result.outcome.binding.itemId, "untradeable");
});

test("non-idle and unknown Activity Guard states dominate every other gate", () => {
  const oversized = Array.from({ length: 5_001 }, (_, index) => ({ itemId: `raw-${index}` }));
  for (const [state, reasonCode] of [
    [RouterActivityGuardState.NON_IDLE, RouterNextActionReason.ACTIVITY_GUARD_NOT_IDLE],
    [RouterActivityGuardState.UNKNOWN, RouterNextActionReason.ACTIVITY_GUARD_UNVERIFIED],
  ]) {
    const result = recommendRouterNextAction({
      activityGuard: { state },
      inventorySnapshot: { club: { items: oversized }, storage: { items: [] }, unassigned: { items: [] } },
      gameContext: { gameVersion: "fc27", state: "unverified" },
      capabilitySnapshot: capabilities({ inventory: "unavailable" }),
    });
    assert.equal(result.state, RouterNextActionState.BLOCKED);
    assert.equal(result.outcome.kind, RouterNextActionKind.PAUSE);
    assert.equal(result.outcome.reasonCode, reasonCode);
  }
});

test("bounds fail closed without truncating to a partial recommendation", () => {
  const result = recommendRouterNextAction(makeEvidence({
    unassigned: Array.from({ length: 101 }, (_, index) => item(`item-${index}`, `version-${index}`)),
  }));

  assert.equal(result.state, RouterNextActionState.BLOCKED);
  assert.equal(result.outcome.reasonCode, RouterNextActionReason.INPUT_LIMIT_EXCEEDED);
  assert.equal(result.counts.unassignedItems, 101);
  assert.equal(result.outcome.binding, null);
});

test("game, read, move, route, and per-item evidence gates fail conservatively", () => {
  const base = makeEvidence({ unassigned: [item("unique", "version-1")] });
  const cases = [
    [{ ...base, gameContext: { gameVersion: "fc27", state: "unverified" } }, RouterNextActionState.BLOCKED, RouterNextActionReason.GAME_CONTEXT_UNVERIFIED],
    [{ ...base, capabilitySnapshot: capabilities({ inventory: "unavailable" }) }, RouterNextActionState.BLOCKED, RouterNextActionReason.READ_CAPABILITY_UNAVAILABLE],
    [{ ...base, capabilitySnapshot: capabilities({ move: "degraded" }) }, RouterNextActionState.BLOCKED, RouterNextActionReason.MOVE_CAPABILITY_UNAVAILABLE],
    [{ ...base, routeSummary: { routeActions: [] } }, RouterNextActionState.BLOCKED, RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT],
  ];
  for (const [input, state, reasonCode] of cases) {
    const result = recommendRouterNextAction(input);
    assert.equal(result.state, state);
    assert.equal(result.outcome.reasonCode, reasonCode);
  }

  const missingMoveEvidence = makeEvidence({
    unassigned: [{
      itemId: "legacy", resourceId: "legacy-version", definitionId: "legacy-version",
      rating: 80, isTradeable: false,
    }],
    routeSummary: { routeActions: [{
      itemId: "legacy",
      type: "SEND_TO_CLUB",
      from: "unassigned",
      to: "club",
      reason: "not_duplicate",
    }] },
  });
  const attention = recommendRouterNextAction(missingMoveEvidence);
  assert.equal(attention.state, RouterNextActionState.ATTENTION);
  assert.equal(attention.outcome.kind, RouterNextActionKind.PAUSE);
  assert.equal(attention.outcome.reasonCode, RouterNextActionReason.CLUB_MOVE_EVIDENCE_UNVERIFIED);
});

test("unknown storage capacity and tradability never become guessed safe fallbacks", () => {
  const unknownCapacity = recommendRouterNextAction(makeEvidence({
    club: [item("owned", "same")],
    unassigned: [item("duplicate", "same", {
      isDuplicate: true, isMovable: false, isStorable: true,
    })],
    storageCapacity: null,
  }));
  assert.equal(unknownCapacity.state, RouterNextActionState.ATTENTION);
  assert.equal(unknownCapacity.outcome.reasonCode, RouterNextActionReason.STORAGE_CAPACITY_UNVERIFIED);

  const unknownTradability = recommendRouterNextAction(makeEvidence({
    club: [item("owned", "same")],
    storage: [item("stored", "other")],
    unassigned: [{
      itemId: "duplicate", resourceId: "same", definitionId: "same",
      rating: 84, isDuplicate: true, isMovable: false, isStorable: false,
    }],
    storageCapacity: 1,
  }));
  assert.equal(unknownTradability.outcome.reasonCode, RouterNextActionReason.TRADABILITY_EVIDENCE_UNVERIFIED);
});

test("full Storage asks about a verified tradable duplicate and pauses an untradeable one", () => {
  const build = (isTradeable) => recommendRouterNextAction(makeEvidence({
    club: [item("owned", "same")],
    storage: [item("stored", "other")],
    unassigned: [item("duplicate", "same", {
      isDuplicate: true, isTradeable, isMovable: false, isStorable: false,
    })],
    storageCapacity: 1,
  }));
  const tradable = build(true);
  const untradeable = build(false);

  assert.equal(tradable.state, RouterNextActionState.ATTENTION);
  assert.equal(tradable.outcome.kind, RouterNextActionKind.ASK_USER);
  assert.equal(tradable.outcome.reasonCode, RouterNextActionReason.TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE);
  assert.equal(untradeable.outcome.kind, RouterNextActionKind.PAUSE);
  assert.equal(untradeable.outcome.reasonCode, RouterNextActionReason.UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION);
});

test("hard protection and conservation stay bound but cannot turn ownership-preserving moves into consumption", () => {
  const base = makeEvidence({ unassigned: [item("protected", "version-1")] });
  const ordinary = recommendRouterNextAction(base);
  const protectedResult = recommendRouterNextAction({
    ...base,
    protectionAnalysis: {
      protectedItemIds: ["protected"],
      reasonsByItemId: { protected: ["protected-item-flag"] },
    },
    conservationPolicy: {
      minimumReserveByRating: { 84: 5 },
      specialReserveByCardType: { totw: 2 },
    },
  });

  assert.equal(ordinary.outcome.kind, RouterNextActionKind.MOVE_TO_CLUB);
  assert.equal(protectedResult.outcome.kind, RouterNextActionKind.MOVE_TO_CLUB);
  assert.equal(protectedResult.outcome.binding.itemId, ordinary.outcome.binding.itemId);
  assert.notEqual(protectedResult.fingerprints.protection, ordinary.fingerprints.protection);
  assert.notEqual(protectedResult.outcome.kind, RouterNextActionKind.RESERVE);
});

test("router fingerprints bind evidence flags omitted by the generic planning fingerprint", () => {
  const base = makeEvidence({ unassigned: [item("unique", "version-1")] });
  const first = recommendRouterNextAction(base);
  const changedSnapshot = structuredClone(base.inventorySnapshot);
  changedSnapshot.unassigned.items[0].hasTradabilityEvidence = false;
  changedSnapshot.items.find((entry) => entry.itemId === "unique").hasTradabilityEvidence = false;
  const second = recommendRouterNextAction({ ...base, inventorySnapshot: changedSnapshot });

  assert.equal(second.outcome.kind, first.outcome.kind);
  assert.notEqual(second.fingerprints.inventory, first.fingerprints.inventory);
  assert.notEqual(second.fingerprints.decision, first.fingerprints.decision);
});

test("empty Unassigned returns one non-executable KEEP outcome", () => {
  const result = recommendRouterNextAction(makeEvidence());
  assert.equal(result.state, RouterNextActionState.CLEAR);
  assert.equal(result.outcome.kind, RouterNextActionKind.KEEP);
  assert.equal(result.outcome.reasonCode, RouterNextActionReason.UNASSIGNED_CLEAR);
  assert.equal(result.outcome.binding, null);
  assertNoExecutionFields(result);
});
