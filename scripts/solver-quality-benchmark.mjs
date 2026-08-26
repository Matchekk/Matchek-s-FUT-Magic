import { performance } from "node:perf_hooks";

import { FodderPolicy } from "../src/policies/fodder-policy.js";
import { calculateFc26SquadRating } from "../src/sbc/solver/rating.js";
import { buildSolverContext, solveSquad } from "../solver/solver.js";

const SQUAD_SIZE = 11;
const OBJECTIVE_WEIGHTS = Object.freeze([
  1_000_000_000,
  100_000_000,
  10_000_000,
  1_000_000,
  100_000,
  10_000,
  1_000,
  10,
  5,
  0.00001,
  100,
]);

const squadSizeRule = () => ({
  type: "players_in_squad",
  keyName: "PLAYERS_IN_SQUAD",
  count: SQUAD_SIZE,
  target: SQUAD_SIZE,
  op: "exact",
  scopeName: "EXACT",
  value: [SQUAD_SIZE],
  label: `Players in the Squad: ${SQUAD_SIZE}`,
});

const ratingRule = (rating) => ({
  type: "team_rating",
  keyName: "TEAM_RATING",
  count: rating,
  target: rating,
  op: "min",
  scopeName: "MIN",
  value: [rating],
  label: `Team Rating: Min. ${rating}`,
});

const totwRule = (count = 1) => ({
  type: "player_totw_or_tots",
  keyName: "PLAYER_TOTW_OR_TOTS",
  count,
  target: count,
  op: "min",
  scopeName: "MIN",
  value: [3, 11],
  label: `TOTW or TOTS Players: Min. ${count}`,
});

const chemistryRule = (count) => ({
  type: "chemistry_points",
  keyName: "CHEMISTRY_POINTS",
  count,
  target: count,
  op: "min",
  scopeName: "MIN",
  value: [count],
  label: `Total Chemistry: Min. ${count}`,
});

const makePlayer = (id, rating, overrides = {}) => ({
  id: String(id),
  itemId: String(id),
  definitionId: 100_000 + Number(id),
  resourceId: 100_000 + Number(id),
  assetId: 200_000 + Number(id),
  basePlayerId: 200_000 + Number(id),
  rating,
  quality: rating >= 75 ? "gold" : rating >= 65 ? "silver" : "bronze",
  teamId: 10 + (Number(id) % 6),
  leagueId: 20 + (Number(id) % 4),
  nationId: 30 + (Number(id) % 5),
  preferredPositionName: "CM",
  alternativePositionNames: ["CM"],
  isUntradeable: true,
  isTradable: false,
  isDuplicate: false,
  isStorage: false,
  isSpecial: false,
  cardType: "base",
  marketPrice: rating ** 3,
  ...overrides,
});

const buildRatingPool = (offset, ratings, decorate = () => ({})) =>
  ratings.map((rating, index) =>
    makePlayer(offset + index, rating, decorate({ rating, index })),
  );

const cases = [
  {
    name: "85x10-balanced-fodder",
    targetRating: 88,
    players: buildRatingPool(
      1,
      [95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78],
      ({ index, rating }) => ({
        isDuplicate: index % 4 === 0,
        isStorage: index % 3 === 0,
        isUntradeable: index % 5 !== 0,
        isTradable: index % 5 === 0,
        marketPrice: rating ** 3 + index * 100,
      }),
    ),
    requirements: [squadSizeRule(), ratingRule(88)],
    policy: {
      preferredFodderRange: [75, 91],
      minimumReserveByRating: { 93: 1, 94: 1 },
    },
  },
  {
    name: "required-special-conservation",
    targetRating: 87,
    players: buildRatingPool(
      101,
      [94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78],
      ({ index, rating }) => ({
        isDuplicate: index === 8 || index === 12,
        isStorage: index >= 7 && index <= 13,
        isSpecial: [1, 8, 14].includes(index),
        isTotwOrTots: [1, 8, 14].includes(index),
        isTotw: [1, 8, 14].includes(index),
        rarityId: [1, 8, 14].includes(index) ? 3 : 1,
        rarityName: [1, 8, 14].includes(index) ? "TOTW" : "Rare Gold",
        cardType: [1, 8, 14].includes(index) ? "totw" : "base",
        marketPrice: [1, 8, 14].includes(index) ? rating ** 3 * 3 : rating ** 3,
      }),
    ),
    requirements: [squadSizeRule(), ratingRule(87), totwRule(1)],
    policy: {
      preferredFodderRange: [75, 90],
      specialReserveByCardType: { totw: 1 },
    },
    minTotw: 1,
  },
  {
    name: "active-squad-and-project-protection",
    targetRating: 89,
    players: buildRatingPool(
      201,
      [96, 95, 94, 93, 92, 91, 90, 89, 89, 88, 88, 87, 87, 86, 85, 84, 83, 82],
      ({ index, rating }) => ({
        isDuplicate: index % 5 === 3,
        isStorage: index % 4 < 2,
        marketPrice: rating ** 3 + index * 250,
      }),
    ),
    requirements: [squadSizeRule(), ratingRule(89)],
    excludedItemIds: ["201", "202"],
    policy: {
      protectedItemIds: ["203"],
      preferredFodderRange: [75, 92],
      minimumReserveByRating: { 91: 2, 92: 1 },
      projectRatingDemand: [{ rating: 91, count: 2, priority: 3 }],
    },
  },
  {
    name: "mandatory-pack-duplicates",
    targetRating: 86,
    players: buildRatingPool(
      301,
      [93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76],
      ({ index, rating }) => ({
        isDuplicate: [11, 14].includes(index) || index % 6 === 0,
        isStorage: index >= 7,
        marketPrice: rating ** 3 + index * 50,
      }),
    ),
    requirements: [squadSizeRule(), ratingRule(86)],
    requiredItemIds: ["312", "315"],
    policy: { preferredFodderRange: [75, 89] },
  },
  {
    name: "high-chemistry-core",
    targetRating: 84,
    players: [
      ...buildRatingPool(
        401,
        [86, 86, 85, 85, 84, 84, 84, 83, 83, 82, 82],
        ({ index }) => ({
          teamId: 50,
          leagueId: 60,
          nationId: 70,
          preferredPositionName: ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"][index],
          alternativePositionNames: [],
          isStorage: index >= 6,
        }),
      ),
      ...buildRatingPool(451, [90, 89, 88, 87, 86, 85, 84], ({ index }) => ({
        teamId: 80 + index,
        leagueId: 90 + index,
        nationId: 100 + index,
        preferredPositionName: "CM",
        alternativePositionNames: ["CM"],
      })),
    ],
    requirements: [squadSizeRule(), ratingRule(84), chemistryRule(30)],
    squadSlots: Array.from({ length: SQUAD_SIZE }, (_, index) => ({
      index,
      positionName: ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"][index],
      isLocked: false,
      item: null,
    })),
    policy: { preferredFodderRange: [75, 88] },
    oracle: false,
  },
];

const combinations = function* (items, count, start = 0, prefix = []) {
  if (prefix.length === count) {
    yield prefix;
    return;
  }
  const remaining = count - prefix.length;
  for (let index = start; index <= items.length - remaining; index += 1) {
    yield* combinations(items, count, index + 1, [...prefix, items[index]]);
  }
};

const compareTuple = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const weightedObjective = (tuple) =>
  tuple.reduce(
    (sum, value, index) => sum + Math.max(0, Number(value) || 0) * (OBJECTIVE_WEIGHTS[index] ?? 0),
    0,
  );

const isValidOracleSquad = (entry, squad) => {
  if (squad.length !== SQUAD_SIZE) return false;
  if (calculateFc26SquadRating(squad.map((player) => player.rating)) < entry.targetRating) return false;
  if ((entry.minTotw ?? 0) > squad.filter((player) => player.isTotwOrTots).length) return false;
  const ids = new Set(squad.map((player) => String(player.id)));
  if ((entry.requiredItemIds ?? []).some((id) => !ids.has(String(id)))) return false;
  return new Set(squad.map((player) => String(player.basePlayerId))).size === squad.length;
};

const findOracle = (entry, eligiblePlayers, policy) => {
  if (entry.oracle === false) return null;
  let best = null;
  for (const squad of combinations(eligiblePlayers, SQUAD_SIZE)) {
    if (!isValidOracleSquad(entry, squad)) continue;
    const tuple = policy.getSquadObjectiveTuple(squad, {
      allItems: eligiblePlayers,
      targetRating: entry.targetRating,
    });
    if (!best || compareTuple(tuple, best.tuple) < 0) best = { squad, tuple };
  }
  return best;
};

const runCase = (entry) => {
  const policy = new FodderPolicy(entry.policy ?? {});
  const policyAnalysis = policy.analyze(entry.players);
  const hardExcluded = new Set([
    ...(entry.excludedItemIds ?? []).map(String),
    ...policyAnalysis.protectedItemIds.map(String),
  ]);
  const eligiblePlayers = entry.players.filter((player) => !hardExcluded.has(String(player.id)));
  const oracle = findOracle(entry, eligiblePlayers, policy);
  if (entry.oracle !== false && !oracle) throw new Error(`${entry.name}: benchmark oracle found no valid squad`);

  const context = buildSolverContext({
    players: entry.players,
    requirementsNormalized: entry.requirements,
    requiredPlayers: SQUAD_SIZE,
    squadSlots: entry.squadSlots ?? null,
    requiredItemIds: entry.requiredItemIds ?? [],
    filters: { excludedPlayerIds: [...hardExcluded] },
    prioritize: { duplicates: true, storage: true, untradeables: true },
    conservationPolicy: {
      ...policy.toSolverConservationPolicy(),
      protectedItemIds: policyAnalysis.protectedItemIds,
    },
    optimize: {
      restartTimeBudgetMs: 2_500,
      fallbackTimeBudgetMs: 500,
      refineTimeBudgetMs: 500,
      conservationTimeBudgetMs: 500,
    },
  });
  const started = performance.now();
  const result = solveSquad(context);
  const elapsedMs = performance.now() - started;
  const selectedIds = (result?.solutions?.[0] ?? []).map(String);
  const byId = new Map(entry.players.map((player) => [String(player.id), player]));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);

  const protectedViolation = selectedIds.find((id) => hardExcluded.has(id));
  if (protectedViolation) throw new Error(`${entry.name}: selected protected/active item ${protectedViolation}`);
  if (new Set(selected.map((player) => String(player.basePlayerId))).size !== selected.length) {
    throw new Error(`${entry.name}: selected two versions of the same footballer`);
  }
  if (result?.stats?.solved && selected.length !== SQUAD_SIZE) {
    throw new Error(`${entry.name}: solved with ${selected.length} players`);
  }

  const solved = Boolean(result?.stats?.solved);
  const actualTuple = policy.getSquadObjectiveTuple(selected, {
    allItems: eligiblePlayers,
    targetRating: entry.targetRating,
    hardRequirementViolations: solved ? 0 : 1,
  });
  let quality = solved ? 100 : 0;
  let regret = null;
  if (solved && oracle) {
    const actualWeighted = weightedObjective(actualTuple);
    const oracleWeighted = weightedObjective(oracle.tuple);
    regret = Math.max(0, actualWeighted - oracleWeighted);
    quality = Math.max(0, 100 - Math.log10(1 + regret) * 8);
  }
  return {
    name: entry.name,
    solved,
    quality,
    elapsedMs,
    selectedIds,
    squadRating: result?.stats?.squadRating ?? null,
    chemistry: result?.stats?.chemistry?.totalChem ?? null,
    actualTuple: [...actualTuple],
    oracleTuple: oracle ? [...oracle.tuple] : null,
    regret,
    failing: (result?.failingRequirements ?? []).map((failure) => failure?.type ?? failure?.reason ?? "unknown"),
  };
};

const started = performance.now();
const results = cases.map(runCase);
const elapsedMs = performance.now() - started;
const solvedCount = results.filter((result) => result.solved).length;
const qualityScore = results.reduce((sum, result) => sum + result.quality, 0) / results.length;
const runtimePenalty = Math.min(15, elapsedMs / 1_000);
const score = Math.max(0, qualityScore - runtimePenalty);

for (const result of results) {
  console.log(JSON.stringify({ type: "solver-benchmark-case", ...result }));
}
console.log(`SECONDARY solved_rate=${(solvedCount / results.length).toFixed(6)}`);
console.log(`SECONDARY quality=${qualityScore.toFixed(6)}`);
console.log(`SECONDARY elapsed_ms=${elapsedMs.toFixed(3)}`);
console.log(`METRIC solver_quality=${score.toFixed(6)}`);

if (solvedCount !== results.length) process.exitCode = 2;
