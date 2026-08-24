import test from "node:test";
import assert from "node:assert/strict";

import { ExistingAutoPilotSolver } from "../src/sbc/solver/existing-autopilot-solver.js";

const ratings = [88, 88, 87, 87, 86, 86, 85, 84, 84, 83, 83];
const player = (index, rating, overrides = {}) => ({
  id: String(index + 1),
  itemId: String(index + 1),
  definitionId: 1000 + index,
  resourceId: String(1000 + index),
  assetId: 2000 + index,
  basePlayerId: String(2000 + index),
  rating,
  teamId: 10 + index,
  leagueId: 20 + index,
  nationId: 30 + index,
  preferredPositionName: "CM",
  alternativePositionNames: ["CM"],
  ...overrides,
});

test("AutoPilot adapter builds a valid 86 squad without burning a protected 94", () => {
  const players = [
    ...ratings.map((rating, index) => player(index, rating)),
    player(11, 94, {
      cardType: "promo",
      isSpecial: true,
      marketPrice: 0,
    }),
  ];
  const solver = new ExistingAutoPilotSolver();
  const result = solver.solve({
    players,
    requirementsNormalized: [
      {
        type: "players_in_squad",
        count: 11,
        op: "exact",
        value: [11],
      },
      { type: "team_rating", count: 86, op: "min", value: [86] },
    ],
    requiredPlayers: 11,
    fodderPolicy: { protectRatingAtOrAbove: 94 },
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 100 },
  });
  assert.equal(result.stats.solved, true);
  assert.ok(!result.solutions[0].includes("12"));
  assert.deepEqual(result.policy.protectedItemIds, ["12"]);
  assert.equal(result.policy.objectiveTuple[1], 0);
});
