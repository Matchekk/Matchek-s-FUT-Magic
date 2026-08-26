import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSbcPlanFingerprints,
  compareSbcPlanFingerprints,
} from "../src/application/index.js";
import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

const waitFor = async (predicate, message, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
};

const createRuntime = (adapter = new FakeEaAdapter({ iterations: 1 })) => ({
  adapter,
  runtime: new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  }),
});

test("SBC evidence fingerprints ignore refresh generations but detect content changes", () => {
  const base = {
    gameContext: { gameVersion: "fc26", state: "verified", setId: "s1", challengeId: "c1" },
    inventorySnapshot: {
      generation: 1,
      storageCapacity: 100,
      items: [
        { itemId: "b", rating: 84, location: "club", isSpecial: false },
        { itemId: "a", rating: 83, location: "club", isSpecial: false },
      ],
    },
    project: { id: "p1", sourceSetId: "s1", sourceChallengeIds: ["c1"] },
    policySnapshot: { protectedItemIds: ["premium"] },
    capabilitySnapshot: { capabilities: [
      { id: "ea.sbc.solve.preview", state: "available" },
      { id: "ea.inventory.read", state: "available" },
      { id: "ea.sbc.read", state: "available" },
    ] },
  };
  const first = buildSbcPlanFingerprints(base);
  const refreshed = buildSbcPlanFingerprints({
    ...base,
    inventorySnapshot: {
      ...base.inventorySnapshot,
      generation: 99,
      items: [...base.inventorySnapshot.items].reverse(),
    },
  });
  assert.equal(compareSbcPlanFingerprints(first, refreshed).ok, true);
  assert.notEqual(first.inventoryGeneration, refreshed.inventoryGeneration);

  const changed = buildSbcPlanFingerprints({
    ...base,
    inventorySnapshot: {
      ...base.inventorySnapshot,
      generation: 2,
      items: base.inventorySnapshot.items.map((item) =>
        item.itemId === "a" ? { ...item, rating: 85 } : item),
    },
  });
  assert.deepEqual(compareSbcPlanFingerprints(first, changed), {
    ok: false,
    changed: ["inventory"],
  });
});

test("project preview is read-only, bounded, and excludes protected cards", async () => {
  const { adapter, runtime } = createRuntime();
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const before = adapter.club.length;
  const plan = await runtime.previewSbcProject(project.id);

  assert.equal(plan.state, "ready");
  assert.equal(plan.preview.selectedCount, 11);
  assert.equal(adapter.calls.solve, 1);
  assert.equal(adapter.calls.submit, 0);
  assert.equal(adapter.club.length, before);
  assert.equal(adapter.pendingSolution, null);
  assert.equal(adapter.lastSolveOptions.previewOnly, true);
  assert.ok(adapter.lastSolveOptions.protectedItemIds.length >= 6);

  const view = runtime.getProductShellViewModel().projects[0].preview;
  assert.equal(view.canApprove, true);
  assert.equal(view.selectedProtectedCount, 0);
  assert.equal(view.cards.length, 11);
  assert.equal(JSON.stringify(view).includes("solutionIds"), false);
  assert.equal(JSON.stringify(view).includes("club-"), false);
});

test("fresh approval re-solves and submits exactly one squad", async () => {
  const { adapter, runtime } = createRuntime();
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);
  const result = await runtime.approveSbcPlan(project.id, plan.id);
  assert.equal(result.started, true);

  await waitFor(
    () => runtime.engine.getSnapshot()?.status === "completed",
    "Approved SBC workflow did not complete",
  );
  assert.equal(adapter.calls.solve, 2);
  assert.equal(adapter.calls.submit, 1);
  assert.equal(adapter.completedChallenges.size, 1);
  assert.equal(runtime.getState().projects[0].completionProgress, 1);
});

test("approval rejects stale Club evidence without solving or submitting again", async () => {
  const { adapter, runtime } = createRuntime();
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);
  adapter.club.push({
    itemId: "new-club-card",
    resourceId: "new-resource",
    basePlayerId: "new-player",
    rating: 82,
    cardType: "base",
    isUntradeable: true,
  });

  const result = await runtime.approveSbcPlan(project.id, plan.id);
  assert.equal(result.started, false);
  assert.equal(result.stale, true);
  assert.deepEqual(result.changed, ["inventory"]);
  assert.equal(adapter.calls.solve, 1);
  assert.equal(adapter.calls.submit, 0);
  const projectView = runtime.getProductShellViewModel().projects[0];
  assert.equal(projectView.preview, null);
  assert.match(projectView.planNotice, /preview again/i);
});

test("unknown challenge requirements fail closed before invoking the solver", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  const read = adapter.readCurrentSbcProject.bind(adapter);
  adapter.readCurrentSbcProject = async () => {
    const snapshot = await read();
    snapshot.challenges[0].unknownRequirements = ["Minimum chemistry: 31"];
    return snapshot;
  };
  const { runtime } = createRuntime(adapter);
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);
  assert.equal(plan.state, "blocked");
  assert.equal(plan.blockers[0].code, "UNKNOWN_REQUIREMENTS");
  assert.equal(adapter.calls.solve, 0);
  assert.equal(adapter.calls.submit, 0);
});

test("malicious solver output containing a protected card is never approvable", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  adapter.solveCurrentSbc = async function solveIgnoringProtection(options = {}) {
    this.calls.solve += 1;
    this.lastSolveOptions = structuredClone(options);
    return {
      solved: true,
      submitReady: true,
      setId: this.setId,
      challengeId: "challenge-1",
      solutionIds: this.club.slice(0, 11).map((item) => item.itemId),
      stats: { conservationObjectiveTuple: [1] },
    };
  };
  const { runtime } = createRuntime(adapter);
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);
  assert.equal(plan.state, "blocked");
  assert.equal(plan.blockers.some((blocker) => blocker.code === "PROTECTED_ITEM_SELECTED"), true);
  assert.equal(adapter.calls.submit, 0);
});

test("a challenge change reported after approval pauses before submission", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  const solve = adapter.solveCurrentSbc.bind(adapter);
  adapter.solveCurrentSbc = async (options = {}) => {
    const result = await solve(options);
    return options.previewOnly === true
      ? result
      : { ...result, challengeId: "different-challenge" };
  };
  const { runtime } = createRuntime(adapter);
  await runtime.initialize();
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);
  await runtime.approveSbcPlan(project.id, plan.id);
  const run = await waitFor(
    () => runtime.engine.getSnapshot()?.status === "paused" && runtime.engine.getSnapshot(),
    "Changed target did not pause the approved workflow",
  );
  assert.equal(run.lastError.code, "SBC_TARGET_CHANGED_DURING_SOLVE");
  assert.equal(adapter.calls.submit, 0);
});
