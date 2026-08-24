import { PackPolicyError, assertOwnedFreePack } from "./pack-policy.js";

const idOf = (pack) => String(pack?.packId ?? pack?.id ?? "");

/**
 * Identifies a claimed reward without guessing. A unique explicit ID wins;
 * otherwise exactly one newly-owned pack must have appeared.
 */
export function identifyClaimedRewardPack({ claim, packsBefore = [], packsAfter = [] } = {}) {
  if (!Array.isArray(packsBefore) || !Array.isArray(packsAfter)) {
    throw new PackPolicyError("INVALID_PACKS", "Pack snapshots must be arrays");
  }

  const explicitId = String(claim?.packId ?? claim?.rewardPackId ?? "");
  if (explicitId) {
    const matches = packsAfter.filter((pack) => idOf(pack) === explicitId);
    if (matches.length === 1) {
      assertOwnedFreePack(matches[0]);
      return matches[0];
    }
    throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Claimed reward ID was not uniquely present", {
      explicitId,
      matches: matches.length,
    });
  }

  const beforeIds = new Set(packsBefore.map(idOf).filter(Boolean));
  const added = packsAfter.filter((pack) => !beforeIds.has(idOf(pack)));
  if (added.length !== 1) {
    throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Could not uniquely identify the newly claimed pack", {
      added: added.map(idOf),
    });
  }
  assertOwnedFreePack(added[0]);
  return added[0];
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
