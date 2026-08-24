/**
 * FC26 continues to use EA's adjusted-average SBC rating calculation. The
 * Web App promotes an adjusted average only at the observed 0.96 boundary.
 * Keeping the calculation pure makes boundary fixtures independent from the
 * search strategy used by a solver adapter.
 */
export const FC26_SQUAD_SIZE = 11;
export const FC26_RATING_ROUND_THRESHOLD = 0.96;

const toRating = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
    throw new RangeError(`Invalid FC26 item rating: ${String(value)}`);
  }
  return parsed;
};

export const getFc26AdjustedAverage = (ratings) => {
  if (!Array.isArray(ratings) || ratings.length === 0) {
    throw new TypeError("ratings must be a non-empty array");
  }
  const normalized = ratings.map(toRating);
  const average = normalized.reduce((sum, rating) => sum + rating, 0) /
    normalized.length;
  const adjustedTotal = normalized.reduce(
    (sum, rating) => sum + (rating <= average ? rating : 2 * rating - average),
    0,
  );
  return adjustedTotal / normalized.length;
};

export const calculateFc26SquadRating = (
  ratings,
  {
    expectedSquadSize = FC26_SQUAD_SIZE,
    roundThreshold = FC26_RATING_ROUND_THRESHOLD,
  } = {},
) => {
  if (!Array.isArray(ratings) || ratings.length !== expectedSquadSize) {
    throw new RangeError(
      `FC26 SBC rating requires ${expectedSquadSize} ratings; received ${
        Array.isArray(ratings) ? ratings.length : 0
      }`,
    );
  }
  if (!Number.isFinite(roundThreshold) || roundThreshold < 0 || roundThreshold > 1) {
    throw new RangeError("roundThreshold must be between 0 and 1");
  }

  const adjusted = getFc26AdjustedAverage(ratings);
  // EA comparisons are made at two decimal places. Normalizing to integer
  // hundredths avoids binary floating-point noise at the boundary.
  const hundredths = Math.round(adjusted * 100);
  const base = Math.floor(hundredths / 100);
  const fraction = hundredths - base * 100;
  return fraction >= Math.round(roundThreshold * 100) ? base + 1 : base;
};

export const calculateFc26RatingOvershoot = (ratings, targetRating) => {
  const target = toRating(targetRating);
  return Math.max(0, calculateFc26SquadRating(ratings) - target);
};
