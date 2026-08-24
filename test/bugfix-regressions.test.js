import test from "node:test";
import assert from "node:assert/strict";

import { requireVerifiedEaResult } from "../src/ea/controller-adapter.js";
import { PageStorageArea } from "../src/ea/page-storage-area.js";
import { PageWorkflowRepository } from "../src/ea/workflow-storage-repository.js";
import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { FodderPolicy } from "../src/policies/fodder-policy.js";
import { identifyClaimedRewardPack } from "../src/packs/reward-service.js";
import { GrindPanel } from "../src/ui/grind-panel.js";
import {
  MemoryWorkflowRepository,
  WorkflowEngine,
  createAutoApproval,
} from "../src/workflow/index.js";

const destructiveWorkflow = {
  id: "ownership-regression",
  name: "Ownership regression",
  version: 1,
  steps: [{ id: "submit", type: "SUBMIT_SBC", config: {} }],
};

test("verified EA not_applied results are explicitly safe to retry", () => {
  assert.throws(
    () => requireVerifiedEaResult({ status: "not_applied", reason: "Eligibility rejected" }, "submit"),
    (error) =>
      error?.code === "EA_OPERATION_NOT_APPLIED" &&
      error.notApplied === true &&
      error.safeToRetry === true,
  );
});

test("locked and upstream-protected owned cards are never solver eligible", () => {
  const policy = new FodderPolicy({ protectRatingAtOrAbove: 99 });
  const analysis = policy.analyze([
    { itemId: "locked", resourceId: "r1", basePlayerId: "p1", rating: 70, cardType: "base", isLocked: true },
    { itemId: "protected", resourceId: "r2", basePlayerId: "p2", rating: 71, cardType: "base", isProtected: true },
    { itemId: "eligible", resourceId: "r3", basePlayerId: "p3", rating: 72, cardType: "base" },
  ]);
  assert.deepEqual(analysis.protectedItemIds.sort(), ["locked", "protected"]);
  assert.deepEqual(analysis.eligibleItems.map((item) => item.itemId), ["eligible"]);
});

test("isolated-world state client exposes typed commands instead of raw storage primitives", async () => {
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback({ ok: true, data: { accepted: true } });
    },
  };
  const storage = new PageStorageArea({ runtime, timeoutMs: 100 });
  await storage.saveSettings({ mode: "REVIEW" });
  assert.equal(messages[0].type, "GRINDPILOT_STATE_COMMAND_V2");
  assert.equal(messages[0].action, "SETTINGS_SAVE");
  assert.deepEqual(messages[0].payload, { value: { mode: "REVIEW" } });
  assert.equal(storage.get, undefined);
  assert.equal(storage.set, undefined);
  assert.equal(storage.remove, undefined);
});

test("workflow repository forwards one private owner identity to every run mutation", async () => {
  const calls = [];
  const area = {
    loadActiveRun: async (ownerId) => { calls.push(["load", ownerId]); return null; },
    loadRun: async (runId, ownerId) => { calls.push(["loadRun", runId, ownerId]); return null; },
    createRun: async (run, ownerId) => { calls.push(["create", ownerId]); return run; },
    saveRun: async (run, revision, ownerId) => { calls.push(["save", revision, ownerId]); return run; },
    assertRunOwnership: async (runId, ownerId) => { calls.push(["assert", runId, ownerId]); return true; },
    clearActiveRun: async (runId, ownerId) => { calls.push(["clear", runId, ownerId]); },
  };
  const repository = new PageWorkflowRepository(area);
  const run = { runId: "run-1", revision: 0 };
  await repository.loadActiveRun();
  await repository.createRun(run);
  await repository.saveRun(run, { expectedRevision: 0 });
  await repository.assertOwnership(run.runId);
  await repository.clearActiveRun(run.runId);
  const ownerIds = [calls[0][1], calls[1][1], calls[2][2], calls[3][2], calls[4][2]];
  assert.equal(new Set(ownerIds).size, 1);
  assert.match(ownerIds[0], /\S+/);
});

test("workflow engine rechecks centralized ownership immediately before destructive execution", async () => {
  const events = [];
  class OwnedRepository extends MemoryWorkflowRepository {
    async assertOwnership(runId) { events.push(["owner", runId]); return true; }
  }
  const repository = new OwnedRepository();
  const engine = new WorkflowEngine({
    repository,
    handlers: { SUBMIT_SBC: () => { events.push(["execute"]); return { result: { submitted: true } }; } },
  });
  await engine.start(destructiveWorkflow, {
    mode: "AUTO",
    approval: createAutoApproval(destructiveWorkflow),
  });
  await engine.runUntilBlocked();
  assert.equal(events[0][0], "owner");
  assert.equal(events[1][0], "execute");
});

test("workflow draft editing preserves hidden protection and profile fields", () => {
  const panel = Object.create(GrindPanel.prototype);
  panel.state = { draft: {
    mode: "AUTO",
    protectedItemIds: ["owned-94"],
    protectedPlayerIds: ["player-1"],
    minimumReserveByRating: { 89: 3 },
    workflow: destructiveWorkflow,
    runLimits: { maxIterations: 7, maxPacksOpened: 1 },
  } };
  const values = {
    mode: "ASSISTED",
    maxIterations: "5",
    storageCapacity: "100",
    protectRatingAtOrAbove: "94",
    protectedCardTypes: "FOF, ICON",
    packMode: "OPEN_CURRENT_REWARD",
    maxPacks: "1",
    pickMode: "PAUSE_FOR_USER",
  };
  const draft = panel.readDraft({
    querySelector(selector) {
      const name = selector.match(/data-field="([^"]+)"/)?.[1];
      return name && Object.hasOwn(values, name) ? { value: values[name] } : null;
    },
  });
  assert.equal(draft.mode, "ASSISTED");
  assert.deepEqual(draft.protectedItemIds, ["owned-94"]);
  assert.deepEqual(draft.protectedPlayerIds, ["player-1"]);
  assert.deepEqual(draft.minimumReserveByRating, { 89: 3 });
  assert.equal(draft.workflow.steps[0].type, "SUBMIT_SBC");
  assert.equal(draft.runLimits.maxPacksOpened, 1);
});

test("ordinary runtime Resume cannot acknowledge ambiguous destructive recovery", async () => {
  const runtime = Object.create(GrindPilotRuntime.prototype);
  let resumed = false;
  runtime.engine = {
    getSnapshot: () => ({ status: "recovery_required", nodes: [], cursor: 0 }),
    resume: async () => { resumed = true; },
  };
  await assert.rejects(() => runtime.resume(), { code: "RECOVERY_RECONCILIATION_REQUIRED" });
  assert.equal(resumed, false);
});

test("concurrent inventory refreshes share one in-flight EA snapshot", async () => {
  const runtime = Object.create(GrindPilotRuntime.prototype);
  let resolveRead;
  let reads = 0;
  let publishes = 0;
  runtime.inventoryRefreshPromise = null;
  runtime.state = { storageCapacity: 100 };
  runtime.emit = () => {};
  runtime.adapter = {
    readInventory: () => {
      reads += 1;
      return new Promise((resolve) => { resolveRead = resolve; });
    },
  };
  runtime.inventory = {
    synchronize: (snapshot) => { publishes += 1; return snapshot; },
    getStatus: () => ({ storageCount: 0, unassignedCount: 0 }),
  };
  const first = runtime.refreshInventory();
  const second = runtime.refreshInventory();
  assert.equal(reads, 1);
  resolveRead({ club: [], storage: [], unassigned: [] });
  await Promise.all([first, second]);
  assert.equal(publishes, 1);
  assert.equal(runtime.inventoryRefreshPromise, null);
});

test("explicit reward IDs cannot bypass an independent positive pack-count delta", () => {
  const saved = { id: "saved-pack", count: 1, owned: true, costsCoins: false, costsPoints: false };
  assert.throws(() => identifyClaimedRewardPack({
    claim: { packId: "saved-pack" },
    packsBefore: [saved],
    packsAfter: [saved],
  }), { code: "REWARD_PACK_AMBIGUOUS" });

  const correlated = identifyClaimedRewardPack({
    claim: { packId: "saved-pack" },
    packsBefore: [saved],
    packsAfter: [{ ...saved, count: 2 }],
  });
  assert.equal(correlated.id, "saved-pack");

  assert.throws(() => identifyClaimedRewardPack({
    claim: { packId: "saved-pack" },
    packsBefore: [saved],
    packsAfter: [
      { ...saved, count: 2 },
      { id: "another-reward", count: 1, owned: true, costsCoins: false, costsPoints: false },
    ],
  }), { code: "REWARD_PACK_AMBIGUOUS" });
});

test("required-special stop conditions use the current normalized inventory", () => {
  const runtime = Object.create(GrindPilotRuntime.prototype);
  runtime.inventoryAvailable = true;
  runtime.inventory = {
    getStatus: () => ({ storageFreeSlots: 10, unassignedCount: 0 }),
    getSnapshot: () => ({
      updatedAt: "2026-08-24T20:00:00.000Z",
      items: [
        { itemId: "special-1", isSpecial: true, cardType: "TOTW", rarityName: "Team of the Week", specialGroups: [] },
        { itemId: "base-1", isSpecial: false, cardType: "BASE", specialGroups: [] },
      ],
    }),
  };
  const context = runtime.conditionContext({ counters: { loopIterations: 0 } });
  assert.equal(context.requiredSpecialCount, 1);
  assert.equal(runtime.stopConditionTriggered({ type: "REQUIRED_SPECIAL_MISSING" }, context), false);
  assert.equal(runtime.stopConditionTriggered({
    type: "REQUIRED_SPECIAL_MISSING",
    requiredSpecialTypes: ["totw"],
  }, context), false);
  assert.equal(runtime.stopConditionTriggered({
    type: "REQUIRED_SPECIAL_MISSING",
    requiredSpecialTypes: ["icon"],
  }, context), true);

  runtime.inventoryAvailable = false;
  const unavailable = runtime.conditionContext({ counters: {} });
  assert.throws(
    () => runtime.stopConditionTriggered({ type: "REQUIRED_SPECIAL_MISSING" }, unavailable),
    /inventory is unavailable/i,
  );
});
