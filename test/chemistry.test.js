import test from "node:test";
import assert from "node:assert/strict";

import { computeBestChemistryAssignment } from "../solver/chemistry.js";

const player = (id, teamId, leagueId, nationId, positions = ["CM"]) => ({
  id,
  teamId,
  leagueId,
  nationId,
  preferredPositionName: positions[0],
  alternativePositionNames: positions,
});

test("chemistry uses club, league and nation thresholds and caps at three", () => {
  const players = Array.from({ length: 3 }, (_, index) =>
    player(String(index + 1), 1, 2, 3),
  );
  const slots = players.map(() => ({ positionName: "CM" }));
  const result = computeBestChemistryAssignment(players, slots);
  assert.deepEqual(result.perSlotChem, [3, 3, 3]);
  assert.equal(result.totalChem, 9);
  assert.equal(result.minChem, 3);
});

test("off-position players contribute no chemistry", () => {
  const players = [
    player("1", 1, 2, 3, ["ST"]),
    player("2", 1, 2, 3, ["CM"]),
  ];
  const slots = [{ positionName: "GK" }, { positionName: "CM" }];
  const result = computeBestChemistryAssignment(players, slots);
  assert.equal(result.onPositionCount, 1);
  assert.equal(result.totalChem, 0);
  assert.ok(result.perSlotChem.includes(0));
});

test("preferred position remains playable when alternatives omit it", () => {
  const players = [
    {
      ...player("1", 1, 2, 3, ["LW"]),
      preferredPositionName: "ST",
      alternativePositionNames: ["LW"],
    },
  ];
  const result = computeBestChemistryAssignment(players, [
    { positionName: "ST" },
  ]);
  assert.equal(result.onPositionCount, 1);
});
