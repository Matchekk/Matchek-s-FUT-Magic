const requireBridge = () => {
  const bridge = globalThis.window?.eaData?.grindPilot;
  if (!bridge) {
    const error = new Error("GrindPilot EA controller bridge is unavailable");
    error.code = "EA_BRIDGE_UNAVAILABLE";
    throw error;
  }
  return bridge;
};

const verifiedValue = (result, operation) => {
  if (result?.status === "verified") return result.value;
  const error = new Error(result?.reason || `${operation} was not verified`);
  error.code =
    result?.status === "ambiguous"
      ? "EA_STATE_AMBIGUOUS"
      : result?.status === "not_applied"
        ? "EA_OPERATION_NOT_APPLIED"
        : "EA_OPERATION_UNAVAILABLE";
  error.evidence = result?.evidence ?? null;
  error.result = result ?? null;
  if (result?.status === "not_applied") {
    error.notApplied = true;
    error.safeToRetry = true;
  }
  throw error;
};

/** Primary adapter around the preserved AutoPilot controller/runtime bridge. */
export class ControllerAdapter {
  async health() {
    return verifiedValue(await requireBridge().getHealth(), "Bridge health check");
  }

  async getContext() {
    return requireBridge().getContext();
  }

  async readInventory() {
    return verifiedValue(await requireBridge().readInventory(), "Inventory refresh");
  }

  async solveCurrentSbc(options = {}) {
    return verifiedValue(
      await requireBridge().solveCurrentSbc(options),
      "SBC solve",
    );
  }

  async submitCurrentSbc(intent = {}) {
    return verifiedValue(
      await requireBridge().submitCurrentSbc(intent),
      "SBC submission",
    );
  }

  async listOwnedPacks() {
    const packs = verifiedValue(
      await requireBridge().listOwnedRewardPacks(),
      "Owned-pack listing",
    );
    return packs.map((pack) => ({ ...pack, packId: String(pack.id), owned: true }));
  }

  async claimReward(rewardRef = {}, beforePacks = null) {
    const value = verifiedValue(
      await requireBridge().claimCurrentReward({
        ...rewardRef,
        beforePacks: Array.isArray(beforePacks)
          ? beforePacks.map((pack) => ({
              ...pack,
              id: String(pack?.packId ?? pack?.id ?? ""),
            }))
          : null,
      }),
      "Reward claim",
    );
    return {
      claimed: true,
      success: true,
      packId: String(value?.pack?.id ?? ""),
      rewardRef,
    };
  }

  async openOwnedPack({ packId }) {
    const value = verifiedValue(
      await requireBridge().openOwnedRewardPack({ packId }),
      "Reward-pack opening",
    );
    return {
      opened: true,
      packId: String(value.packId),
      items: (value.itemIds ?? []).map((itemId) => ({ itemId })),
    };
  }

  async resolveUnassigned(policy = {}) {
    return verifiedValue(
      await requireBridge().resolveUnassigned(policy),
      "Unassigned resolution",
    );
  }

  async getPlayerPick(pickId = null) {
    const value = verifiedValue(
      await requireBridge().readPlayerPick({ pickId }),
      "Player-pick inspection",
    );
    return {
      ...value,
      id: value.pickIdentity ?? null,
      pickId: value.pickIdentity ?? null,
      offers: Array.isArray(value.offers) ? value.offers : [],
    };
  }

  async selectPlayerPick(intent) {
    const value = verifiedValue(
      await requireBridge().selectPlayerPick(intent),
      "Player-pick selection",
    );
    return { success: true, ...value };
  }

  async organizeIntoSbc(intent = {}) {
    return verifiedValue(
      await requireBridge().organizeIntoSbc(intent),
      "Organizer SBC submission",
    );
  }

  async readSbcChallengeState(query = {}) {
    return verifiedValue(
      await requireBridge().readSbcChallengeState(query),
      "SBC challenge state read",
    );
  }

  async getCapabilityHealth() {
    return verifiedValue(
      await requireBridge().getCapabilityHealth(),
      "Capability health read",
    );
  }

  async readCurrentSbcProject() {
    return verifiedValue(
      await requireBridge().readCurrentSbcProject(),
      "Current SBC project read",
    );
  }

  async findSbcTarget(query = {}) {
    return verifiedValue(
      await requireBridge().findSbcTarget(query),
      "SBC target lookup",
    );
  }

  async readLegacySequences() {
    return verifiedValue(
      await requireBridge().readLegacySequences(),
      "Legacy Sequence read",
    );
  }
}

export { verifiedValue as requireVerifiedEaResult };
