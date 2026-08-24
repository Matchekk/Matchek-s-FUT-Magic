import { PackPolicyError, assertOwnedFreePack } from "./pack-policy.js";

const idOf = (pack) => String(pack?.packId ?? pack?.id ?? "");

const countPacksById = (packs) => {
  const counts = new Map();
  const packsById = new Map();
  for (const pack of packs) {
    const id = idOf(pack);
    const count = Number(pack?.count ?? 1);
    if (!id || !Number.isSafeInteger(count) || count < 0) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshot contains an invalid ID or count");
    }
    const nextCount = (counts.get(id) ?? 0) + count;
    if (!Number.isSafeInteger(nextCount)) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshot count exceeds the safe range");
    }
    counts.set(id, nextCount);
    const matches = packsById.get(id) ?? [];
    matches.push(pack);
    packsById.set(id, matches);
  }
  return { counts, packsById };
};

/**
 * Identifies a claimed reward only when exactly one owned pack count increased.
 * An explicit claimed ID must correlate to that same positive count delta.
 */
export function identifyClaimedRewardPack({ claim, packsBefore = [], packsAfter = [] } = {}) {
  if (!Array.isArray(packsBefore) || !Array.isArray(packsAfter)) {
    throw new PackPolicyError("INVALID_PACKS", "Pack snapshots must be arrays");
  }

  const before = countPacksById(packsBefore);
  const after = countPacksById(packsAfter);
  const positiveDeltaIds = Array.from(after.counts.entries())
    .filter(([id, count]) => count - (before.counts.get(id) ?? 0) > 0)
    .map(([id]) => id);
  const explicitId = String(claim?.packId ?? claim?.rewardPackId ?? "");
  if (
    positiveDeltaIds.length !== 1 ||
    (explicitId && positiveDeltaIds[0] !== explicitId)
  ) {
    throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Could not uniquely identify the newly claimed pack", {
      explicitId: explicitId || null,
      positiveDeltaIds,
    });
  }

  const correlatedId = positiveDeltaIds[0];
  const matches = after.packsById.get(correlatedId) ?? [];
  if (!matches.length) {
    throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Correlated reward pack was not present");
  }
  for (const pack of matches) assertOwnedFreePack(pack);
  return matches[0];
}

export class RewardService {
  constructor({ adapter, logger = null } = {}) {
    if (!adapter?.listOwnedPacks || !adapter?.claimReward) {
      throw new TypeError("RewardService requires listOwnedPacks and claimReward adapter methods");
    }
    this.adapter = adapter;
    this.logger = logger;
  }

  async claimAndIdentify(rewardRef) {
    const before = await this.adapter.listOwnedPacks();
    const claim = await this.adapter.claimReward(rewardRef);
    if (claim?.claimed !== true && claim?.success !== true) {
      throw new PackPolicyError("REWARD_CLAIM_UNVERIFIED", "Reward claim was not verified", { rewardRef });
    }
    const after = await this.adapter.listOwnedPacks();
    const pack = identifyClaimedRewardPack({ claim, packsBefore: before, packsAfter: after });
    this.logger?.info?.("reward.claimed", { rewardRef, packId: idOf(pack) });
    return { claim, pack, identifiedPackId: idOf(pack), packType: pack.packType ?? pack.type ?? null };
  }
}
