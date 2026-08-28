import test from "node:test";
import assert from "node:assert/strict";

import { ExistingSolverCandidateGenerator } from "../src/sbc/planning/index.js";

const base = {
  challengeSnapshot: {
    challengeId: "challenge",
    evidenceState: "verified",
    requirementsKnown: true,
    requiredPlayers: 11,
    fingerprint: "challenge:fingerprint",
    requirementsNormalized: [{ type: "TEAM_RATING", value: 80 }],
  },
  inventorySnapshot: {
    generation: 2,
    items: Array.from({ length: 12 }, (_, index) => ({
      itemId: index === 0 ? "one" : `player-${index}`,
      resourceId: index === 0 ? "one" : `player-${index}`,
    })),
  },
  projectSnapshot: { projectId: "project" },
  maxCandidates: 1,
};

test("existing solver generator forwards reservations as hard exclusions", async () => {
  let request;
  const solution = base.inventorySnapshot.items.slice(1).map(({ itemId }) => itemId);
  const generator = new ExistingSolverCandidateGenerator({
    solver: {
      solve(input) {
        request = input;
        return {
          stats: { solved: true, submitReady: true },
          solutions: [solution],
          failingRequirements: [],
          policy: { objectiveFields: ["cost"], objectiveTuple: [1] },
        };
      },
    },
  });
  const [candidate] = await generator.generate({ ...base, excludedOwnedItemIds: ["one"] });
  assert.deepEqual(request.filters.excludedPlayerIds, ["one"]);
  assert.deepEqual(candidate.ownedItemIds, solution);
  assert.equal(candidate.hardRequirementsSatisfied, true);
});

test("unsolved output is empty and a returned reserved item is rejected", async () => {
  const unsolved = new ExistingSolverCandidateGenerator({
    solver: { solve: () => ({ stats: { solved: false }, solutions: [] }) },
  });
  assert.deepEqual(await unsolved.generate(base), []);

  const invalid = new ExistingSolverCandidateGenerator({
    solver: { solve: () => ({
      stats: { solved: true, submitReady: true },
      solutions: [["one", ...base.inventorySnapshot.items.slice(1, 11).map(({ itemId }) => itemId)]],
      failingRequirements: [],
    }) },
  });
  await assert.rejects(
    invalid.generate({ ...base, excludedOwnedItemIds: ["one"] }),
    /previously reserved/,
  );
});

test("partial or non-submit-ready solver output is rejected", async () => {
  const partial = new ExistingSolverCandidateGenerator({
    solver: { solve: () => ({ stats: { solved: true, submitReady: true }, solutions: [["one"]], failingRequirements: [] }) },
  });
  assert.deepEqual(await partial.generate(base), []);

  const unready = new ExistingSolverCandidateGenerator({
    solver: { solve: () => ({
      stats: { solved: true, submitReady: false },
      solutions: [base.inventorySnapshot.items.slice(0, 11).map(({ itemId }) => itemId)],
      failingRequirements: [],
    }) },
  });
  assert.deepEqual(await unready.generate(base), []);
});

test("unknown challenge evidence blocks before solver invocation", async () => {
  let calls = 0;
  const generator = new ExistingSolverCandidateGenerator({
    solver: { solve: () => { calls += 1; return {}; } },
  });
  await assert.rejects(
    generator.generate({
      ...base,
      challengeSnapshot: { ...base.challengeSnapshot, requirementsKnown: false },
    }),
    /verified challenge snapshot/,
  );
  assert.equal(calls, 0);
});
