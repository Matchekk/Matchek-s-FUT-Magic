import test from "node:test";
import assert from "node:assert/strict";

import {
  SequentialPlanStatus,
  SequentialSetPlanner,
} from "../src/sbc/planning/index.js";

const inventory = {
  generation: 7,
  items: ["one", "two", "three"].map((itemId) => ({ itemId, resourceId: itemId, location: "club" })),
};
const project = { projectId: "project", generation: 3, remaining: 2 };
const challenges = [
  { challengeId: "a", order: 1, evidenceState: "verified", requirementsKnown: true, requiredPlayers: 1, fingerprint: "challenge:a" },
  { challengeId: "b", order: 2, evidenceState: "verified", requirementsKnown: true, requiredPlayers: 1, fingerprint: "challenge:b" },
];

const generated = (candidateId, challengeId, ownedItemIds) => ({
  candidateId,
  challengeId,
  projectId: "project",
  ownedItemIds,
  submitReady: true,
  hardRequirementsSatisfied: true,
  challengeFingerprint: `challenge:${challengeId}`,
});

test("sequential planner excludes earlier reservations from every later solve", async () => {
  const calls = [];
  const generator = {
    async generate(request) {
      calls.push([...request.excludedOwnedItemIds]);
      return request.challengeSnapshot.challengeId === "a"
        ? [generated("candidate-a", "a", ["one"])]
        : [generated("candidate-b", "b", ["two"])];
    },
  };
  const plan = await new SequentialSetPlanner({ candidateGenerator: generator }).plan({
    projectSnapshot: project,
    inventorySnapshot: inventory,
    challengeSnapshots: challenges,
  });
  assert.equal(plan.status, SequentialPlanStatus.COMPLETE);
  assert.deepEqual(calls, [[], ["one"]]);
  assert.deepEqual(plan.allocations.map(({ ownedItemIds }) => ownedItemIds), [["one"], ["two"]]);
  assert.equal(plan.globallyOptimal, false);
  assert.equal(plan.canExecute, false);
  assert.equal(Object.isFrozen(plan), true);
});

test("later greedy dead end is incomplete, never globally infeasible", async () => {
  const generator = {
    async generate({ challengeSnapshot }) {
      return challengeSnapshot.challengeId === "a"
        ? [generated("candidate-a", "a", ["one"])]
        : [];
    },
  };
  const plan = await new SequentialSetPlanner({ candidateGenerator: generator }).plan({
    projectSnapshot: project,
    inventorySnapshot: inventory,
    challengeSnapshots: challenges,
  });
  assert.equal(plan.status, SequentialPlanStatus.INCOMPLETE);
  assert.equal(plan.reason, "SEQUENTIAL_SEARCH_EXHAUSTED");
  assert.equal(plan.allocations.length, 1);
  assert.equal(plan.globallyOptimal, false);
  assert.equal(plan.infeasible, undefined);
});

test("generator reuse, protected items and unknown requirements block safely", async (t) => {
  await t.test("reuse", async () => {
    const generator = {
      async generate({ challengeSnapshot }) {
        return [generated(`candidate-${challengeSnapshot.challengeId}`, challengeSnapshot.challengeId, ["one"])];
      },
    };
    const plan = await new SequentialSetPlanner({ candidateGenerator: generator }).plan({
      projectSnapshot: project,
      inventorySnapshot: inventory,
      challengeSnapshots: challenges,
    });
    assert.equal(plan.status, SequentialPlanStatus.BLOCKED);
    assert.equal(plan.reason, "CONFLICTING_RESERVATION");
  });

  await t.test("protected", async () => {
    const generator = { async generate() { return [generated("candidate", "a", ["one"])]; } };
    const plan = await new SequentialSetPlanner({ candidateGenerator: generator }).plan({
      projectSnapshot: project,
      inventorySnapshot: inventory,
      challengeSnapshots: [challenges[0]],
      protectionSnapshot: { protectedItemIds: ["one"] },
    });
    assert.equal(plan.status, SequentialPlanStatus.BLOCKED);
    assert.equal(plan.reason, "PROTECTED_ITEM_USAGE");
  });

  await t.test("unknown requirements", async () => {
    let calls = 0;
    const generator = { async generate() { calls += 1; return []; } };
    const plan = await new SequentialSetPlanner({ candidateGenerator: generator }).plan({
      projectSnapshot: project,
      inventorySnapshot: inventory,
      challengeSnapshots: [{ ...challenges[0], requirementsKnown: false }],
    });
    assert.equal(plan.status, SequentialPlanStatus.BLOCKED);
    assert.equal(plan.reason, "UNKNOWN_CHALLENGE_REQUIREMENTS");
    assert.equal(calls, 0);
  });
});

test("missing project or inventory generations are stale", async () => {
  const generator = { async generate() { return []; } };
  const planner = new SequentialSetPlanner({ candidateGenerator: generator });
  assert.equal((await planner.plan({
    projectSnapshot: { projectId: "project" },
    inventorySnapshot: inventory,
    challengeSnapshots: challenges,
  })).status, SequentialPlanStatus.STALE);
  assert.equal((await planner.plan({
    projectSnapshot: project,
    inventorySnapshot: { items: [] },
    challengeSnapshots: challenges,
  })).status, SequentialPlanStatus.STALE);
});

test("fallback inventory fingerprints include nested item identity", async () => {
  const generator = {
    async generate({ challengeSnapshot, inventorySnapshot }) {
      return [generated("candidate", challengeSnapshot.challengeId, [inventorySnapshot.items[0].itemId])];
    },
  };
  const planner = new SequentialSetPlanner({ candidateGenerator: generator });
  const first = await planner.plan({
    projectSnapshot: { ...project, remaining: 1 },
    inventorySnapshot: { generation: 7, items: [{ itemId: "one", resourceId: "r", location: "club" }] },
    challengeSnapshots: [challenges[0]],
  });
  const second = await planner.plan({
    projectSnapshot: { ...project, remaining: 1 },
    inventorySnapshot: { generation: 7, items: [{ itemId: "different", resourceId: "r", location: "club" }] },
    challengeSnapshots: [challenges[0]],
  });
  assert.notEqual(first.inventoryFingerprint, second.inventoryFingerprint);
});
