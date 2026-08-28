import test from "node:test";
import assert from "node:assert/strict";

import {
  DuplicateRecycleReason,
  DuplicateRecycleStatus,
  buildDuplicateRecyclePreview,
  compileDuplicateRecycleWorkflow,
  fingerprintDuplicateRecycleInventory,
  fingerprintDuplicateRecycleProjects,
  scoreDuplicateRecycleTargets,
} from "../src/recipes/index.js";

const item = (itemId, extra = {}) => ({
  itemId,
  resourceId: itemId,
  location: "unassigned",
  hasTradabilityEvidence: true,
  hasLockedEvidence: true,
  hasProtectedEvidence: true,
  hasStartingSquadEvidence: true,
  hasSpecialEvidence: true,
  ...extra,
});
const inventory = {
  generation: 4,
  fingerprint: "inventory-four",
  items: [item("duplicate"), item("fodder")],
};
const project = { generation: 2, fingerprint: "project-two" };
const candidate = (extra = {}) => ({
  targetId: "85x10",
  name: "85x10 Upgrade",
  setId: "set",
  challengeId: "challenge",
  evidenceState: "verified",
  requirementsKnown: true,
  repeatable: true,
  acceptedItemIds: ["duplicate"],
  completeSolutionItemIds: ["duplicate", "fodder"],
  hardProtectionViolations: 0,
  projectDamage: 0,
  extraFodderCost: 1,
  replacementCost: 1,
  rewardUtility: 5,
  inventoryGeneration: 4,
  projectGeneration: 2,
  protectionFingerprint: "protection",
  requirementsFingerprint: "requirements",
  capabilityFingerprint: "capability",
  ...extra,
});

test("target scoring is lexicographic, explainable and deterministic", () => {
  const candidates = [
    candidate({ targetId: "worse", projectDamage: 2 }),
    candidate({ targetId: "best", projectDamage: 0 }),
  ];
  const first = scoreDuplicateRecycleTargets({ blockingItemIds: ["duplicate"], candidates });
  const second = scoreDuplicateRecycleTargets({ blockingItemIds: ["duplicate"], candidates: [...candidates].reverse() });
  assert.deepEqual(first, second);
  assert.equal(first[0].candidate.targetId, "best");
  assert.deepEqual(first[0].objectiveTuple.slice(0, 4), [0, 0, 0, -1]);
});

test("ready preview binds exact target, duplicates, full solution and fingerprints", () => {
  const preview = buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate()],
    activityGuard: { state: "NORMAL" },
  });
  assert.equal(preview.status, DuplicateRecycleStatus.READY);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.explanation.relievedDuplicates, 1);
  const workflow = compileDuplicateRecycleWorkflow(preview);
  const approved = workflow.steps[0].config.approvedRecycle;
  assert.deepEqual(approved.requiredItemIds, ["duplicate"]);
  assert.deepEqual(approved.exactSolutionItemIds, ["duplicate", "fodder"]);
  assert.equal(approved.inventoryFingerprint, fingerprintDuplicateRecycleInventory(inventory));
});

test("missing duplicate evidence, protection, activity and stale generations block", () => {
  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: { ...inventory, items: [item("duplicate", { hasTradabilityEvidence: false }), item("fodder")] },
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate()],
  }).reason, DuplicateRecycleReason.ITEM_EVIDENCE_UNVERIFIED);

  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate()],
    protectedItemIds: ["duplicate"],
  }).reason, DuplicateRecycleReason.PROTECTED_ITEM_USAGE);

  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate()],
    activityGuard: { state: "CAUTION" },
  }).reason, DuplicateRecycleReason.ACTIVITY_GUARD_NOT_NORMAL);

  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate({ inventoryGeneration: 3 })],
  }).reason, DuplicateRecycleReason.NO_VERIFIED_RECIPE);
});

test("a target omitting a blocking duplicate or using a protected solution is rejected", () => {
  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate({ acceptedItemIds: [] })],
  }).reason, DuplicateRecycleReason.NO_VERIFIED_RECIPE);

  assert.equal(buildDuplicateRecyclePreview({
    inventorySnapshot: inventory,
    projectSnapshot: project,
    blockingItemIds: ["duplicate"],
    candidates: [candidate()],
    protectedItemIds: ["fodder"],
  }).reason, DuplicateRecycleReason.PROTECTED_ITEM_USAGE);
});

test("project fingerprints bind demand and remain order independent", () => {
  const first = fingerprintDuplicateRecycleProjects([{
    id: "project",
    ratingRequirements: [{ rating: 89, count: 2, completed: 0 }],
    protectedPlayerIds: ["b", "a"],
  }]);
  const reordered = fingerprintDuplicateRecycleProjects([{
    id: "project",
    ratingRequirements: [{ completed: 0, count: 2, rating: 89 }],
    protectedPlayerIds: ["a", "b"],
  }]);
  const changed = fingerprintDuplicateRecycleProjects([{
    id: "project",
    ratingRequirements: [{ rating: 89, count: 3, completed: 0 }],
    protectedPlayerIds: ["a", "b"],
  }]);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});
