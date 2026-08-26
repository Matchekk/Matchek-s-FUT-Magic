import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const bridgeSource = fs.readFileSync(
  path.join(testDirectory, "..", "page", "ea-data-bridge.js"),
  "utf8",
);
const contentScriptSource = fs.readFileSync(
  path.join(testDirectory, "..", "content-script.js"),
  "utf8",
);
const backgroundSource = fs.readFileSync(
  path.join(testDirectory, "..", "background.js"),
  "utf8",
);
const solverSource = fs.readFileSync(
  path.join(testDirectory, "..", "solver", "solver.js"),
  "utf8",
);

test("organizer canonicalizes serialized set IDs before challenge lookup", () => {
  assert.match(
    bridgeSource,
    /String\(s\?\.id \?\? ""\) === String\(setId \?\? ""\)/,
  );
});

test("every SBC submit refreshes and blocks active-squad definitions", () => {
  assert.match(bridgeSource, /getActiveSquadPlayerIds\(\{ force: true \}\)/);
  assert.match(bridgeSource, /EA_SUBMIT_ACTIVE_SQUAD_PROTECTED/);
  assert.match(bridgeSource, /strictExcludeActiveSquad: options\?\.strictExcludeActiveSquad \?\? true/);
});

test("Exclude Special is opt-in instead of silently enabled", () => {
  assert.match(
    bridgeSource,
    /excludeSpecial: false,\s*\/\/|excludeSpecial: false,/,
  );
});

test("solver preferences have concrete Chrome local-storage wrappers", () => {
  assert.match(contentScriptSource, /const storageLocalGet = \(key\) =>/);
  assert.match(contentScriptSource, /chrome\.storage\.local\.get\(\[key\]/);
  assert.match(contentScriptSource, /const storageLocalSet = \(key, value\) =>/);
  assert.match(contentScriptSource, /chrome\.storage\.local\.set\(\{ \[key\]: value \}/);
});

test("background solver import cache key tracks the current live fix", () => {
  assert.match(backgroundSource, /solver\/solver\.js\?v=2026-08-25a/);
  assert.match(solverSource, /constraint-compiler\.js\?v=2026-08-25a/);
});

test("organizer required cards reach every solver attempt", () => {
  const wrapperStart = bridgeSource.indexOf("const solveWithConceptFallback = async ({");
  const wrapperEnd = bridgeSource.indexOf("const LEAGUE_CONFLICT_GENERIC_TYPE_TOKENS", wrapperStart);
  const wrapperSource = bridgeSource.slice(wrapperStart, wrapperEnd);

  assert.ok(wrapperStart >= 0);
  assert.match(wrapperSource, /requiredItemIds = \[\]/);
  assert.equal(
    [...wrapperSource.matchAll(/requiredItemIds,/g)].length,
    2,
    "the owned solve and concept retry must both preserve requiredItemIds",
  );
});

test("organizer apply preserves exact unassigned item IDs", () => {
  assert.match(
    bridgeSource,
    /forceDefaultApply: true,\s*preserveExistingValid: false,\s*preserveExactItemIds: Array\.from\(requiredIds\)/,
  );
  assert.match(bridgeSource, /preserveExactItemIds\.has\(String\(id\)\)/);
  assert.match(bridgeSource, /missingAppliedIds/);
  assert.match(bridgeSource, /filter\(\(id\) => Boolean\(id\) && id !== "0"\)/);
});

test("Recycle Cards always hands unresolved leftovers to Organizer", () => {
  const runtimeSource = readFileSync(
    new URL("../src/grindpilot-main.js", import.meta.url),
    "utf8",
  );
  assert.match(runtimeSource, /allowPartial: true,\s*allowUnresolved: true/);
  assert.match(runtimeSource, /id: "organize-remaining-items"/);
  assert.doesNotMatch(
    runtimeSource,
    /plan\.requiresUserAction\s*\?\s*\[\{\s*id: "organize-remaining-items"/,
  );
});
import { readFileSync } from "node:fs";

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

test("Solve Squad does not inherit EA's disabled action state", () => {
  const bridgeSource = readFileSync(
    new URL("../page/ea-data-bridge.js", import.meta.url),
    "utf8",
  );
  const classCopy = bridgeSource.indexOf(
    "button.className = `${referenceButton.className} ea-data-solve-button`;",
  );
  const disabledRemoval = bridgeSource.indexOf(
    'button.classList.remove("disabled");',
    classCopy,
  );

  assert.ok(classCopy >= 0);
  assert.ok(disabledRemoval > classCopy);
  assert.ok(disabledRemoval - classCopy < 1_000);
});

test("single-solve failures expose the concrete failing requirements", () => {
  assert.match(bridgeSource, /result\?\.failingRequirements/);
  assert.match(bridgeSource, /Not possible with current player pool \(\$\{details\.join\(", "\)\}\)/);
  assert.match(bridgeSource, /title: "Solver Error",\s*message: error\?\.message/);
});

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

test("isolated-world state client uses AutoSBC direct storage for local GrindPilot state", async () => {
  const memory = {};
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback({ ok: true, data: null });
    },
  };
  const directStorage = {
    get(keys, callback) {
      callback(Object.fromEntries(
        keys.filter((key) => Object.hasOwn(memory, key)).map((key) => [key, structuredClone(memory[key])]),
      ));
    },
    set(entries, callback) {
      Object.assign(memory, structuredClone(entries));
      callback();
    },
    remove(keys, callback) {
      for (const key of keys) delete memory[key];
      callback();
    },
  };
  const storage = new PageStorageArea({ runtime, storage: directStorage, timeoutMs: 100 });

  await storage.saveActivity([{ level: "info", action: "Solve" }]);
  await storage.saveSettings({ mode: "REVIEW" });
  const bootstrap = await storage.loadBootstrap();

  assert.deepEqual(bootstrap.activity, [{ level: "info", action: "Solve" }]);
  assert.deepEqual(bootstrap.settings, { mode: "REVIEW" });
  assert.deepEqual(bootstrap.projects, []);
  assert.equal(messages.length, 0);

  await storage.loadActiveRun("owner-1");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, "RUN_LOAD_ACTIVE");
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
