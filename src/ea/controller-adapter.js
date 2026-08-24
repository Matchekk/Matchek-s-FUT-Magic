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
  throw error;
};

/** Primary adapter around the preserved AutoPilot controller/runtime bridge. */
export class ControllerAdapter {
  async health() {
    return verifiedValue(await requireBridge().getHealth(), "Bridge health check");
  }

  getContext() {
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

  async claimReward(rewardRef = {}) {
    const value = verifiedValue(
      await requireBridge().claimCurrentReward(rewardRef),
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

  async getPlayerPick() {
    const value = verifiedValue(
      await requireBridge().readPlayerPick(),
      "Player-pick inspection",
    );
    return value.pending
      ? { id: value.pickItemIds?.[0] ?? null, offers: [], resolved: false, requiresUser: true }
      : { id: null, offers: [], resolved: true };
  }

  async selectPlayerPick(intent) {
    return verifiedValue(
      await requireBridge().selectPlayerPick(intent),
      "Player-pick selection",
    );
  }
}

export { verifiedValue as requireVerifiedEaResult };

