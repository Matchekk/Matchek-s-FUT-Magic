import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateFc26SquadRating,
  getFc26AdjustedAverage,
} from "../src/sbc/solver/rating.js";

test("FC26 rating promotes the observed .96 boundary", () => {
  const ratings = [75, 75, ...Array(9).fill(76)];
  assert.equal(Number(getFc26AdjustedAverage(ratings).toFixed(4)), 75.9669);
  assert.equal(calculateFc26SquadRating(ratings), 76);
});

test("FC26 rating does not promote an adjusted .94 value", () => {
  const ratings = [...Array(8).fill(75), 77, 77, 77];
  assert.equal(Number(getFc26AdjustedAverage(ratings).toFixed(4)), 75.9421);
  assert.equal(calculateFc26SquadRating(ratings), 75);
});

test("FC26 rating is stable for a uniform squad and rejects incomplete squads", () => {
  assert.equal(calculateFc26SquadRating(Array(11).fill(84)), 84);
  assert.throws(() => calculateFc26SquadRating(Array(10).fill(84)), /requires 11/);
});
