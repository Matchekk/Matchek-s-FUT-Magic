import test from "node:test";
import assert from "node:assert/strict";

import { compileConstraintSet } from "../solver/constraint-compiler.js";
import { buildSolverContext, solveSquad } from "../solver/solver.js";

const makePlayers = (count, overrides = {}) =>
  Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    definitionId: 1000 + index,
    assetId: 2000 + index,
    rating: 75,
    teamId: 10 + (index % 3),
    leagueId: 20 + (index % 2),
    nationId: 30 + (index % 4),
    preferredPositionName: "CM",
    alternativePositionNames: ["CM"],
    ...overrides,
  }));

const squadSizeRule = (count = 11) => ({
  type: "players_in_squad",
  keyName: "PLAYERS_IN_SQUAD",
  count,
  op: "exact",
  scopeName: "EXACT",
  value: [count],
  label: `Players in the Squad: ${count}`,
});

test("compiler rejects unknown requirement types", () => {
  const compiled = compileConstraintSet([
    { type: "future_new_rule", count: 1, op: "min", value: [1] },
  ]);
  assert.equal(compiled.constraints.length, 0);
  assert.equal(compiled.unsupportedRules.length, 1);
  assert.equal(compiled.summary.unsupportedCount, 1);
});

test("compiler keeps zero as a valid max/exact target", () => {
  const compiled = compileConstraintSet([
    {
      type: "loan_players",
      keyName: "LOAN_PLAYERS",
      count: 0,
      op: "max",
      scopeName: "MAX",
      value: [],
    },
  ]);
  assert.equal(compiled.constraints.length, 1);
  assert.equal(compiled.constraints[0].target, 0);
});

test("solver fails closed when the candidate pool is smaller than the requested squad", () => {
  const context = buildSolverContext({
    players: makePlayers(10),
    requirementsNormalized: [squadSizeRule(11)],
    requiredPlayers: 11,
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 50 },
  });
  const result = solveSquad(context);
  assert.equal(result.stats.solved, false);
  assert.equal(result.stats.squadSize, 11);
  assert.ok(
    result.failingRequirements.some(
      (rule) => rule?.reason === "insufficient_player_pool",
    ),
  );
});

test("solver fails closed when a challenge contains an unsupported requirement", () => {
  const context = buildSolverContext({
    players: makePlayers(11),
    requirementsNormalized: [
      squadSizeRule(11),
      { type: "future_new_rule", count: 1, op: "min", value: [1] },
    ],
    requiredPlayers: 11,
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 50 },
  });
  const result = solveSquad(context);
  assert.equal(result.stats.solved, false);
  assert.ok(
    result.failingRequirements.some(
      (rule) => rule?.reason === "unsupported_requirement",
    ),
  );
});

test("max zero loan players is enforced", () => {
  const context = buildSolverContext({
    players: [
      ...makePlayers(11, { isLoan: true }),
      ...makePlayers(11, { isLoan: false }).map((player, index) => ({
        ...player,
        id: String(index + 21),
        definitionId: 3000 + index,
        assetId: 4000 + index,
      })),
    ],
    requirementsNormalized: [
      squadSizeRule(11),
      {
        type: "loan_players",
        keyName: "LOAN_PLAYERS",
        count: 0,
        op: "max",
        scopeName: "MAX",
        value: [],
        label: "Loan players: Max. 0",
      },
    ],
    requiredPlayers: 11,
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 50 },
  });
  const result = solveSquad(context);
  assert.equal(result.stats.solved, true);
  assert.deepEqual(
    result.solutions[0],
    Array.from({ length: 11 }, (_, index) => String(index + 21)),
  );
});
