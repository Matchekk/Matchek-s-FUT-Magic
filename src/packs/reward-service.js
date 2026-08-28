import { PackPolicyError } from "./pack-policy.js";
import { EarnedPackTracker } from "./earned-pack-tracker.js";

const idOf = (pack) => String(pack?.packId ?? pack?.id ?? "");

/**
 * Identifies a claimed reward only when exactly one owned pack count increased.
 * An explicit claimed ID must correlate to that same positive count delta.
 */
export function identifyClaimedRewardPack({ claim, packsBefore = [], packsAfter = [] } = {}) {
  try {
    return EarnedPackTracker.correlate({
      before: packsBefore,
      after: packsAfter,
      claimEvidence: claim,
      operationId: "legacy-reward-correlation",
    }).pack;
  } catch (error) {
    if (error?.code === "AMBIGUOUS_REWARD_PACK") {
      throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", error.message, error.details);
    }
    throw error;
  }
}

export class RewardService {
  constructor({ adapter, logger = null } = {}) {
    if (!adapter?.listOwnedPacks || !adapter?.claimReward) {
      throw new TypeError("RewardService requires listOwnedPacks and claimReward adapter methods");
    }
    this.adapter = adapter;
    this.logger = logger;
  }

  async claimAndIdentify(rewardRef, packsBefore = null, { operationId = "reward-claim", inventoryGeneration = null } = {}) {
    const before = Array.isArray(packsBefore)
      ? packsBefore.map((pack) => ({ ...pack }))
      : await this.adapter.listOwnedPacks();
    const claim = await this.adapter.claimReward(rewardRef, before);
    if (claim?.claimed !== true && claim?.success !== true) {
      throw new PackPolicyError("REWARD_CLAIM_UNVERIFIED", "Reward claim was not verified", { rewardRef });
    }
    const after = await this.adapter.listOwnedPacks();
    const { binding, pack } = EarnedPackTracker.correlate({
      before,
      after,
      claimEvidence: claim,
      operationId,
      sourceChallenge: rewardRef?.challengeId ?? rewardRef?.source ?? null,
      inventoryGeneration,
      correlatedAt: Date.now(),
    });
    this.logger?.info?.("reward.claimed", { rewardRef, packId: idOf(pack) });
    return {
      claim,
      pack,
      packBinding: binding,
      identifiedPackId: idOf(pack),
      packType: pack.packType ?? pack.type ?? null,
    };
  }
}
