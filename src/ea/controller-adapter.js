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

export const ControllerGameVersion = Object.freeze({
  FC26: "fc26",
  FC27: "fc27",
  UNKNOWN: "unknown",
});

export const ControllerGameVersionObservation = Object.freeze({
  OBSERVED: "observed",
  UNVERIFIED: "unverified",
  COMPATIBILITY_DEFAULT: "compatibility_default",
});

const ownDataProperty = (input, key) => {
  if (input == null || typeof input !== "object") return { present: false, value: undefined };
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key);
  } catch {
    return { present: true, value: undefined };
  }
  if (!descriptor) return { present: false, value: undefined };
  return { present: true, value: "value" in descriptor ? descriptor.value : undefined };
};

const boundedScalar = (input, key, maxLength, { allowNumber = false } = {}) => {
  const property = ownDataProperty(input, key);
  const value = property.value;
  if (allowNumber && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
};

const normalizeVersionFields = (input) => {
  const versionProperty = ownDataProperty(input, "gameVersion");
  if (!versionProperty.present) {
    return {
      gameVersion: ControllerGameVersion.FC26,
      gameVersionObservation: ControllerGameVersionObservation.COMPATIBILITY_DEFAULT,
      gameVersionSource: "legacy_bridge_v1",
    };
  }
  const value = typeof versionProperty.value === "string"
    ? versionProperty.value.trim().toLowerCase()
    : "";
  if (![ControllerGameVersion.FC26, ControllerGameVersion.FC27].includes(value)) {
    return {
      gameVersion: ControllerGameVersion.UNKNOWN,
      gameVersionObservation: ControllerGameVersionObservation.UNVERIFIED,
      gameVersionSource: "none",
    };
  }
  const observation = boundedScalar(input, "gameVersionObservation", 32) ===
    ControllerGameVersionObservation.UNVERIFIED
    ? ControllerGameVersionObservation.UNVERIFIED
    : ControllerGameVersionObservation.OBSERVED;
  const declaredSource = boundedScalar(input, "gameVersionSource", 64);
  return {
    gameVersion: value,
    gameVersionObservation: observation,
    gameVersionSource: declaredSource === "ea_runtime" ? declaredSource : "main_world_context",
  };
};

export const normalizeControllerContext = (input) => {
  let prototype;
  try {
    prototype = input != null && typeof input === "object" && !Array.isArray(input)
      ? Object.getPrototypeOf(input)
      : undefined;
  } catch {
    prototype = undefined;
  }
  const context = prototype === Object.prototype || prototype === null
    ? input
    : { gameVersion: ControllerGameVersion.UNKNOWN };
  return Object.freeze({
    ...normalizeVersionFields(context),
    route: boundedScalar(context, "route", 512),
    setId: boundedScalar(context, "setId", 128, { allowNumber: true }),
    setName: boundedScalar(context, "setName", 240),
    challengeId: boundedScalar(context, "challengeId", 128, { allowNumber: true }),
    challengeName: boundedScalar(context, "challengeName", 240),
    challengeCompleted: ownDataProperty(context, "challengeCompleted").value === true,
    bridgeReady: ownDataProperty(context, "bridgeReady").value === true,
  });
};

/** Primary adapter around the preserved AutoPilot controller/runtime bridge. */
export class ControllerAdapter {
  async health() {
    return verifiedValue(await requireBridge().getHealth(), "Bridge health check");
  }

  async getContext() {
    return normalizeControllerContext(await requireBridge().getContext());
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
