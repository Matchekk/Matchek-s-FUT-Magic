import test from "node:test";
import assert from "node:assert/strict";

import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import {
  buildDuplicateRecyclePreview,
  DuplicateRecycleStatus,
  fingerprintDuplicateRecycleCapabilities,
  fingerprintDuplicateRecycleProjects,
  fingerprintDuplicateRecycleRequirement,
} from "../src/recipes/index.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

const withEvidence = (value) => ({
  ...value,
  isLocked: false,
  isProtected: false,
  isInStartingSquad: false,
  isSpecial: false,
});

const createRuntime = async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  adapter.club = adapter.club.map(withEvidence);
  adapter.unassigned = [withEvidence({
    id: "blocking-duplicate",
    itemId: "blocking-duplicate",
    resourceId: "blocking-resource",
    basePlayerId: "blocking-player",
    rating: 82,
    isUntradeable: true,
    isDuplicate: true,
    cardType: "base",
  })];
  const runtime = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();
  return { adapter, runtime };
};

const previewFor = async (runtime) => {
  const snapshot = runtime.inventory.getSnapshot();
  const fillerIds = snapshot.club.items
    .filter((item) => item.rating < 94)
    .slice(0, 10)
    .map((item) => item.itemId);
  const projectFingerprint = fingerprintDuplicateRecycleProjects(runtime.targets.list());
  const currentSet = await runtime.adapter.readCurrentSbcProject();
  const currentChallenge = currentSet.challenges.find((entry) => entry.id === "challenge-1");
  const requirementsFingerprint = fingerprintDuplicateRecycleRequirement({
    setId: currentSet.setId,
    challenge: currentChallenge,
  });
  const capabilityFingerprint = fingerprintDuplicateRecycleCapabilities(
    await runtime.adapter.getCapabilityHealth(),
  );
  return buildDuplicateRecyclePreview({
    inventorySnapshot: snapshot,
    projectSnapshot: { generation: 0, fingerprint: projectFingerprint, projects: runtime.targets.list() },
    blockingItemIds: ["blocking-duplicate"],
    protectedItemIds: runtime.createFodderPolicy().analyze(snapshot.items).protectedItemIds,
    activityGuard: { state: "NORMAL" },
    candidates: [{
      targetId: "fake-recipe",
      name: "Fake duplicate recipe",
      setId: "fake-set-26",
      challengeId: "challenge-1",
      evidenceState: "verified",
      requirementsKnown: true,
      repeatable: true,
      acceptedItemIds: ["blocking-duplicate"],
      completeSolutionItemIds: ["blocking-duplicate", ...fillerIds],
      hardProtectionViolations: 0,
      projectDamage: 0,
      extraFodderCost: 10,
      replacementCost: 10,
      rewardUtility: 1,
      inventoryGeneration: snapshot.generation,
      projectGeneration: 0,
      protectionFingerprint: "fixture-protection",
      requirementsFingerprint,
      capabilityFingerprint,
    }],
  });
};

test("approved duplicate recycle consumes only the exact reviewed squad through WorkflowEngine", async () => {
  const { adapter, runtime } = await createRuntime();
  const preview = await previewFor(runtime);
  assert.equal(preview.status, DuplicateRecycleStatus.READY);

  const run = await runtime.startApprovedDuplicateRecycle(preview);
  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.organize, 1);
  assert.equal(run.nodes[0].intent.approvedRecycle, true);
  assert.deepEqual(run.nodes[0].intent.requiredItemIds, preview.target.completeSolutionItemIds);
  assert.equal(adapter.unassigned.length, 0);
});

test("an approved duplicate recycle fails before dispatch when inventory changes", async () => {
  const { adapter, runtime } = await createRuntime();
  const preview = await previewFor(runtime);
  adapter.club.push(withEvidence({
    id: "late-item",
    itemId: "late-item",
    resourceId: "late-resource",
    basePlayerId: "late-player",
    rating: 75,
    isUntradeable: true,
    isDuplicate: false,
    cardType: "base",
  }));

  const run = await runtime.startApprovedDuplicateRecycle(preview);
  assert.equal(run.status, "paused");
  assert.equal(run.pauseReason.code, "STEP_FAILED");
  assert.equal(run.nodes[0].error.code, "DUPLICATE_RECIPE_EVIDENCE_CHANGED");
  assert.equal(adapter.calls.organize, 0);
});
