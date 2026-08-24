const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clampPercent = (value, fallback) => {
  const parsed = toFiniteNumber(value);
  return Math.max(0, Math.min(100, parsed ?? fallback));
};

const readBaseValue = (player) => {
  for (const value of [
    player?.marketPrice,
    player?.price,
    player?.priceMeta?.price,
    player?.futggPrice,
    player?.buyNowPrice,
  ]) {
    const parsed = toFiniteNumber(value);
    if (parsed != null && parsed >= 0) return parsed;
  }
  // Deterministic replacement-value fallback. The cubic curve makes consuming
  // a high-rated card materially more expensive than several low-rated cards.
  const rating = Math.max(0, toFiniteNumber(player?.rating) ?? 0);
  return Math.pow(rating, 3);
};

/**
 * Applies the useful part of Auto-SBC's cost policy without its remote backend:
 * preferred cards can be treated as zero-cost, while duplicates, storage cards
 * and untradeables receive configurable replacement-value discounts.
 */
export const applyPlayerValuePolicy = (players, policy = {}) => {
  const preferredIds = new Set(
    (policy?.preferredPlayerIds || [])
      .map((value) => (value == null ? null : String(value)))
      .filter(Boolean),
  );
  const duplicatePercent = clampPercent(
    policy?.duplicateValuePercent,
    policy?.duplicates ? 50 : 100,
  );
  const untradeablePercent = clampPercent(
    policy?.untradeableValuePercent,
    policy?.untradeables ? 85 : 100,
  );
  const storagePercent = clampPercent(
    policy?.storageValuePercent,
    policy?.storage ? 50 : 100,
  );

  return (Array.isArray(players) ? players : [])
    .map((player, originalIndex) => {
      const id = player?.id == null ? null : String(player.id);
      const preferred = Boolean(id && preferredIds.has(id));
      let effectiveValue = preferred ? 0 : readBaseValue(player);
      if (!preferred && player?.isDuplicate) effectiveValue *= duplicatePercent / 100;
      if (!preferred && player?.isStorage) effectiveValue *= storagePercent / 100;
      if (!preferred && player?.isUntradeable)
        effectiveValue *= untradeablePercent / 100;
      return {
        ...player,
        selectionPolicy: {
          preferred,
          effectiveValue,
          originalIndex,
        },
      };
    })
    .sort((a, b) => {
      const preferredDiff =
        Number(Boolean(b.selectionPolicy?.preferred)) -
        Number(Boolean(a.selectionPolicy?.preferred));
      if (preferredDiff) return preferredDiff;
      const valueDiff =
        (a.selectionPolicy?.effectiveValue ?? Infinity) -
        (b.selectionPolicy?.effectiveValue ?? Infinity);
      if (valueDiff) return valueDiff;
      return (
        (a.selectionPolicy?.originalIndex ?? 0) -
        (b.selectionPolicy?.originalIndex ?? 0)
      );
    });
};
