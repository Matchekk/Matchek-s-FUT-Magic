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

test("compiler recovers EA team-rating targets from labels when count and value are sentinels", () => {
  const compiled = compileConstraintSet([
    {
      type: "team_rating",
      keyName: "TEAM_RATING",
      count: -1,
      derivedCount: -1,
      value: [-1],
      scopeName: "MIN",
      label: "Team Rating: Min. 91",
    },
  ]);

  assert.equal(compiled.constraints[0].count, 91);
  assert.equal(compiled.constraints[0].target, 91);
});

test("solver treats organizer item IDs as mandatory squad members", () => {
  const players = makePlayers(18);
  players[15].rating = 88;
  players[16].rating = 89;
  const requiredItemIds = [players[15].id, players[16].id];
  const result = solveSquad(buildSolverContext({
    players,
    requirementsNormalized: [squadSizeRule(11)],
    requiredPlayers: 11,
    requiredItemIds,
    optimize: {
      refineSolvedSquad: false,
      conserveSolvedSquad: false,
      solverTimeBudgetMs: 100,
    },
  }));

  assert.equal(result.stats.solved, true);
  assert.ok(requiredItemIds.every((id) => result.solutions[0].map(String).includes(id)));
});

test("numeric organizer item IDs stay locked through rating optimization", () => {
  const players = makePlayers(22).map((player, index) => ({
    ...player,
    id: index + 1,
    rating: index === 0 ? 60 : index < 12 ? 75 : 88,
  }));
  const requiredItemId = String(players[0].id);
  const result = solveSquad(buildSolverContext({
    players,
    requirementsNormalized: [
      squadSizeRule(11),
      {
        type: "team_rating",
        keyName: "TEAM_RATING",
        count: 84,
        target: 84,
        op: "min",
        scopeName: "MIN",
        value: [84],
      },
    ],
    requiredPlayers: 11,
    requiredItemIds: [requiredItemId],
    optimize: {
      refineSolvedSquad: false,
      conserveSolvedSquad: false,
      solverTimeBudgetMs: 150,
    },
  }));

  assert.equal(result.stats.solved, true);
  assert.ok(result.solutions[0].map(String).includes(requiredItemId));
});

test("solver fails closed when a mandatory organizer card is unavailable", () => {
  const result = solveSquad(buildSolverContext({
    players: makePlayers(14),
    requirementsNormalized: [squadSizeRule(11)],
    requiredPlayers: 11,
    requiredItemIds: ["missing-organizer-item"],
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 50 },
  }));

  assert.equal(result.stats.solved, false);
  assert.ok(result.failingRequirements.some(
    (rule) => rule.type === "required_item" && rule.itemId === "missing-organizer-item",
  ));
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

test("required FUTTIES rarity groups survive Exclude Special", () => {
  const basePlayers = makePlayers(10, {
    rating: 84,
    quality: "gold",
    isSpecial: false,
  });
  const futtiesPlayer = {
    ...makePlayers(1, {
      rating: 84,
      quality: "gold",
      isSpecial: true,
      isTotwOrTots: false,
      groups: [190],
    })[0],
    id: "required-futties",
    definitionId: 99001,
    assetId: 99001,
  };
  const result = solveSquad(buildSolverContext({
    players: [...basePlayers, futtiesPlayer],
    requirementsNormalized: [
      squadSizeRule(11),
      {
        type: "player_totw_or_tots",
        keyName: "PLAYER_TOTW_OR_TOTS",
        count: 1,
        op: "min",
        scopeName: "MIN",
        value: [43, 44, 190],
        label: "Any TOTW/TOTS/FOF/FUTTIES: Min. 1 Players",
      },
    ],
    requiredPlayers: 11,
    filters: { excludeSpecial: true, useTotwPlayers: true },
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 100 },
  }));

  assert.equal(result.stats.solved, true);
  assert.ok(result.solutions[0].includes("required-futties"));
});

test("live solver never selects base and promo versions of the same footballer", () => {
  const sameFootballer = [
    {
      id: "owned-base",
      definitionId: 240001,
      resourceId: 240001,
      assetId: 240001,
      basePlayerId: 240001,
      rating: 75,
      preferredPositionName: "CM",
      alternativePositionNames: ["CM"],
    },
    {
      id: "owned-promo",
      definitionId: 50571649,
      resourceId: 50571649,
      assetId: 240001,
      basePlayerId: 240001,
      rating: 75,
      preferredPositionName: "CM",
      alternativePositionNames: ["CM"],
    },
  ];
  const alternatives = makePlayers(10).map((player, index) => ({
    ...player,
    id: `alternative-${index}`,
    definitionId: 4000 + index,
    resourceId: 4000 + index,
    assetId: 5000 + index,
    basePlayerId: 5000 + index,
  }));
  const context = buildSolverContext({
    players: [...sameFootballer, ...alternatives],
    requirementsNormalized: [squadSizeRule(11)],
    requiredPlayers: 11,
    optimize: { refineSolvedSquad: false, solverTimeBudgetMs: 100 },
  });
  const result = solveSquad(context);
  assert.equal(result.stats.solved, true);
  assert.equal(result.solutions[0].length, 11);
  assert.equal(
    result.solutions[0].includes("owned-base") && result.solutions[0].includes("owned-promo"),
    false,
  );
});
