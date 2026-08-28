import test from "node:test";
import assert from "node:assert/strict";

import {
  SolutionConflictCode,
  validateProjectPlan,
  validateSolutionCandidate,
} from "../src/sbc/planning/index.js";

const inventory = {
  generation: 4,
  fingerprint: "inventory-four",
  items: [
    { itemId: "copy-a", resourceId: "same-version" },
    { itemId: "copy-b", resourceId: "same-version" },
    { itemId: "protected", resourceId: "other" },
  ],
};

const candidate = (id, challengeId, ownedItemIds, extra = {}) => ({
  candidateId: id,
  challengeId,
  projectId: "project",
  ownedItemIds,
  inventoryGeneration: 4,
  inventoryFingerprint: "inventory-four",
  hardRequirementsSatisfied: true,
  ...extra,
});

test("two physical copies of one card version remain independently valid", () => {
  const result = validateProjectPlan({
    plan: {
      projectId: "project",
      inventoryGeneration: 4,
      inventoryFingerprint: "inventory-four",
      projectGeneration: 2,
      projectFingerprint: "project-two",
      allocations: [
        candidate("a", "a", ["copy-a"]),
        candidate("b", "b", ["copy-b"]),
      ],
    },
    inventorySnapshot: inventory,
    projectSnapshot: { projectId: "project", generation: 2, fingerprint: "project-two" },
  });
  assert.equal(result.valid, true);
});

test("same owned item across challenges is rejected", () => {
  const result = validateProjectPlan({
    plan: {
      projectId: "project",
      inventoryGeneration: 4,
      inventoryFingerprint: "inventory-four",
      projectGeneration: 2,
      projectFingerprint: "project-two",
      allocations: [
        candidate("a", "a", ["copy-a"]),
        candidate("b", "b", ["copy-a"]),
      ],
    },
    inventorySnapshot: inventory,
    projectSnapshot: { projectId: "project", generation: 2, fingerprint: "project-two" },
  });
  assert.equal(result.valid, false);
  assert.equal(result.codes.includes(SolutionConflictCode.OWNED_ITEM_REUSED), true);
});

test("unknown, protected, reserved, stale and hard-invalid candidates report closed codes", () => {
  const result = validateSolutionCandidate({
    candidate: candidate("candidate", "challenge", ["unknown", "protected", "copy-a"], {
      inventoryGeneration: 3,
      hardRequirementsSatisfied: false,
    }),
    inventorySnapshot: inventory,
    protectionSnapshot: { protectedItemIds: ["protected"] },
    reservationSnapshot: {
      reservations: [{
        itemRef: { kind: "owned", itemId: "copy-a" },
        candidateId: "other",
        challengeId: "other",
      }],
    },
  });
  assert.deepEqual(new Set(result.codes), new Set([
    SolutionConflictCode.STALE_INVENTORY_REFERENCE,
    SolutionConflictCode.INVALID_ITEM_REFERENCE,
    SolutionConflictCode.PROTECTED_ITEM_USAGE,
    SolutionConflictCode.CONFLICTING_RESERVATION,
    SolutionConflictCode.HARD_REQUIREMENT_FAILED,
  ]));
});

test("project and inventory generation changes invalidate a plan", () => {
  const result = validateProjectPlan({
    plan: {
      inventoryGeneration: 3,
      projectGeneration: 1,
      allocations: [],
    },
    inventorySnapshot: inventory,
    projectSnapshot: { generation: 2 },
  });
  assert.deepEqual(new Set(result.codes), new Set([
    SolutionConflictCode.STALE_INVENTORY_REFERENCE,
    SolutionConflictCode.STALE_PROJECT_REFERENCE,
  ]));
});

test("project identity and every current fingerprint are mandatory", () => {
  const basePlan = {
    projectId: "project-a",
    inventoryGeneration: 4,
    inventoryFingerprint: "inventory-four",
    projectGeneration: 2,
    projectFingerprint: "project-two",
    allocations: [],
  };
  const wrongProject = validateProjectPlan({
    plan: basePlan,
    inventorySnapshot: inventory,
    projectSnapshot: { projectId: "project-b", generation: 2, fingerprint: "project-two" },
  });
  assert.equal(wrongProject.codes.includes(SolutionConflictCode.STALE_PROJECT_REFERENCE), true);

  const missingCurrentFingerprints = validateProjectPlan({
    plan: basePlan,
    inventorySnapshot: { ...inventory, fingerprint: null },
    projectSnapshot: { projectId: "project-a", generation: 2, fingerprint: null },
  });
  assert.deepEqual(new Set(missingCurrentFingerprints.codes), new Set([
    SolutionConflictCode.STALE_INVENTORY_REFERENCE,
    SolutionConflictCode.STALE_PROJECT_REFERENCE,
  ]));
});
