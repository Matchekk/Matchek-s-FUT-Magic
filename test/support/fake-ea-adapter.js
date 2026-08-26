const clone = (value) => structuredClone(value);
const itemId = (item) => String(item?.itemId ?? item?.id ?? "");

export class FakeGrindStorage {
  constructor() {
    this.settings = {};
    this.activity = [];
    this.projects = [];
  }
  async loadBootstrap() {
    return clone({ settings: this.settings, activity: this.activity, projects: this.projects });
  }
  async saveSettings(value) { this.settings = clone(value); }
  async saveActivity(value) { this.activity = clone(value); }
  async saveProjects(value) { this.projects = clone(value); }
}

export class FakeEaAdapter {
  constructor({ iterations = 20, gameVersion = "fc26" } = {}) {
    this.iterations = iterations;
    this.gameVersion = gameVersion;
    this.setId = "fake-set-26";
    this.challengeIndex = 0;
    this.completedChallenges = new Set();
    this.rewardAvailable = false;
    this.packs = [];
    this.playerPick = null;
    this.storageCapacity = 100;
    this.interruptions = [];
    this.calls = { solve: 0, submit: 0, claim: 0, open: 0, pick: 0, resolve: 0, organize: 0 };
    this.lastSolveOptions = null;
    this.club = Array.from({ length: iterations * 11 + 40 }, (_, index) => ({
      id: `club-${index + 1}`,
      itemId: `club-${index + 1}`,
      resourceId: `resource-${index + 1}`,
      basePlayerId: `player-${index + 1}`,
      rating: index < 6 ? 94 + (index % 3) : 75 + (index % 19),
      isUntradeable: index % 4 !== 0,
      isTradeable: index % 4 === 0,
      isDuplicate: false,
      cardType: index < 6 ? "premium" : "base",
      isSpecial: index < 6,
    }));
    this.storage = [];
    this.unassigned = [];
    this.pendingSolution = null;
  }

  interruptNext(operation) { this.interruptions.push(String(operation)); }
  #finish(operation, value) {
    if (this.interruptions[0] !== operation) return Promise.resolve(clone(value));
    this.interruptions.shift();
    return new Promise(() => {});
  }
  #challengeId(index = this.challengeIndex) { return `challenge-${index + 1}`; }
  #rawInventory() {
    return clone({ club: this.club, storage: this.storage, unassigned: this.unassigned, generation: 1 });
  }

  async health() { return { eaReady: true }; }
  async getCapabilityHealth() {
    return ["inventory", "current sbc read", "solve", "submit", "claim", "packs", "pick", "resolve"].map((id) => ({
      id, status: "AVAILABLE", evidence: { fake: true },
    }));
  }
  async getContext() {
    const observedGameVersion = ["fc26", "fc27"].includes(this.gameVersion)
      ? this.gameVersion
      : "unknown";
    return {
      gameVersion: observedGameVersion,
      gameVersionObservation: observedGameVersion === "unknown" ? "unverified" : "observed",
      gameVersionSource: observedGameVersion === "unknown" ? "none" : "test_fixture",
      setId: this.setId,
      challengeId: this.#challengeId(),
      challengeCompleted: this.completedChallenges.has(this.#challengeId()),
      bridgeReady: true,
    };
  }
  async readInventory() { return this.#rawInventory(); }
  async readCurrentSbcProject() {
    return {
      setId: this.setId,
      setName: "Fake 20x Upgrade",
      challenges: Array.from({ length: this.iterations }, (_, index) => ({
        id: this.#challengeId(index),
        name: `Fake Squad ${index + 1}`,
        completed: this.completedChallenges.has(this.#challengeId(index)),
        requiredSquadRating: 80 + (index % 7),
        specialCardRequirements: index % 5 === 0 ? [{ cardType: "totw", count: 1 }] : [],
        unknownRequirements: [],
      })),
    };
  }
  async findSbcTarget() {
    return {
      setId: this.setId,
      challengeId: this.#challengeId(),
      name: "10x 85+ Upgrade",
    };
  }
  async readLegacySequences() { return []; }

  async solveCurrentSbc(options = {}) {
    this.calls.solve += 1;
    this.lastSolveOptions = clone(options);
    const protectedIds = new Set((options.protectedItemIds ?? []).map(String));
    const candidates = this.club
      .filter((item) => !protectedIds.has(itemId(item)))
      .sort((left, right) =>
        Number(Boolean(left.isDuplicate)) - Number(Boolean(right.isDuplicate)) ||
        Number(left.rating) - Number(right.rating),
      );
    if (candidates.length < 11) throw new Error("Fake club has insufficient players");
    const solutionIds = candidates.slice(0, 11).map(itemId);
    if (options.previewOnly !== true) this.pendingSolution = solutionIds;
    return {
      solved: true,
      submitReady: true,
      setId: this.setId,
      challengeId: this.#challengeId(),
      solutionIds,
      stats: { conservationObjectiveTuple: [0, 0, 0] },
    };
  }

  async submitCurrentSbc(intent) {
    this.calls.submit += 1;
    if (String(intent.expectedChallengeId) !== this.#challengeId()) {
      throw new Error("Fake submit challenge mismatch");
    }
    const expected = new Set((intent.expectedItemIds ?? []).map(String));
    if (!this.pendingSolution || this.pendingSolution.some((id) => !expected.has(id))) {
      throw new Error("Fake submit solution mismatch");
    }
    this.club = this.club.filter((item) => !expected.has(itemId(item)));
    const completedId = this.#challengeId();
    this.completedChallenges.add(completedId);
    this.rewardAvailable = true;
    this.pendingSolution = null;
    this.challengeIndex = Math.min(this.challengeIndex + 1, this.iterations - 1);
    return this.#finish("submit", { success: true, completed: true, challengeId: completedId });
  }

  async listOwnedPacks() { return clone(this.packs); }
  async claimReward(_rewardRef, _beforePacks) {
    this.calls.claim += 1;
    if (!this.rewardAvailable) throw new Error("Fake reward is unavailable");
    const packId = `reward-pack-${this.calls.claim}`;
    this.packs.push({ packId, id: packId, count: 1, owned: true, costsCoins: false, costsPoints: false, isReward: true });
    this.rewardAvailable = false;
    return this.#finish("claim", { claimed: true, success: true, packId });
  }

  async openOwnedPack({ packId }) {
    this.calls.open += 1;
    const index = this.packs.findIndex((pack) => String(pack.packId) === String(packId));
    if (index < 0) throw new Error("Fake owned pack is unavailable");
    this.packs.splice(index, 1);
    const items = Array.from({ length: 12 }, (_, offset) => {
      const duplicate = offset % 3 === 0;
      const serial = `${this.calls.open}-${offset + 1}`;
      return {
        id: `pack-item-${serial}`,
        itemId: `pack-item-${serial}`,
        resourceId: duplicate ? `resource-${20 + offset}` : `pack-resource-${serial}`,
        basePlayerId: `pack-player-${serial}`,
        rating: 75 + ((this.calls.open + offset) % 15),
        isUntradeable: true,
        isTradeable: false,
        isDuplicate: duplicate,
        cardType: "base",
      };
    });
    this.unassigned.push(...items);
    this.playerPick = {
      pickIdentity: `pick-${this.calls.open}`,
      pending: true,
      offers: [
        { itemId: `pick-low-${this.calls.open}`, resourceId: `pick-r-low-${this.calls.open}`, rating: 82 },
        { itemId: `pick-high-${this.calls.open}`, resourceId: `pick-r-high-${this.calls.open}`, rating: 88 },
      ],
    };
    return this.#finish("open", { opened: true, packId, items });
  }

  async getPlayerPick(pickId = null) {
    if (!this.playerPick) return { resolved: true, pending: false, offers: [] };
    if (pickId != null && String(pickId) !== this.playerPick.pickIdentity) {
      return { availability: "unavailable", pending: false, offers: [] };
    }
    return clone(this.playerPick);
  }
  async selectPlayerPick(intent) {
    this.calls.pick += 1;
    if (!this.playerPick || String(intent.pickIdentity) !== this.playerPick.pickIdentity) {
      throw new Error("Fake pick identity mismatch");
    }
    const selected = this.playerPick.offers.find((offer) => String(offer.itemId) === String(intent.itemId));
    if (!selected) throw new Error("Fake pick offer mismatch");
    this.unassigned.push({
      ...selected,
      id: selected.itemId,
      basePlayerId: selected.itemId,
      isUntradeable: true,
      isTradeable: false,
      isDuplicate: false,
      cardType: "base",
    });
    this.playerPick = null;
    return this.#finish("pick", { success: true, selectedItemId: String(intent.itemId) });
  }

  async resolveUnassigned({
    expectedActions = [],
    expectedUnassignedItemIdsBefore = null,
    expectedRemainingItemIdsAfter = null,
  } = {}) {
    this.calls.resolve += 1;
    const beforeIds = this.unassigned.map(itemId).sort();
    if (Array.isArray(expectedUnassignedItemIdsBefore)) {
      const expectedBefore = expectedUnassignedItemIdsBefore.map(String).sort();
      if (JSON.stringify(beforeIds) !== JSON.stringify(expectedBefore)) {
        const error = new Error("Fake complete Unassigned pre-state mismatch");
        error.code = "EA_OPERATION_NOT_APPLIED";
        error.notApplied = true;
        error.safeToRetry = true;
        throw error;
      }
    }
    const remaining = new Map(this.unassigned.map((item) => [itemId(item), item]));
    const movedToClub = [];
    const movedToStorage = [];
    for (const action of expectedActions) {
      const item = remaining.get(String(action.itemId));
      if (!item) throw new Error("Fake resolution intent item is missing");
      remaining.delete(String(action.itemId));
      if (action.type === "SEND_TO_CLUB") {
        this.club.push(item);
        movedToClub.push(String(action.itemId));
      } else if (action.type === "MOVE_TO_SBC_STORAGE") {
        this.storage.push(item);
        movedToStorage.push(String(action.itemId));
      }
    }
    this.unassigned = [...remaining.values()];
    if (Array.isArray(expectedRemainingItemIdsAfter)) {
      const expectedAfter = expectedRemainingItemIdsAfter.map(String).sort();
      const afterIds = this.unassigned.map(itemId).sort();
      if (JSON.stringify(afterIds) !== JSON.stringify(expectedAfter)) {
        const error = new Error("Fake exact Unassigned post-state mismatch");
        error.code = "EA_STATE_AMBIGUOUS";
        throw error;
      }
    }
    const result = {
      movedToClub,
      movedToStorage,
      unresolvedItemIds: this.unassigned.map(itemId),
      unresolvedUnassigned: this.unassigned.length,
      storageUsed: this.storage.length,
      storageCapacity: this.storageCapacity,
    };
    return this.#finish("resolve", result);
  }

  async organizeIntoSbc({
    setId,
    challengeId,
    requiredItemIds = [],
    protectedItemIds = [],
  } = {}) {
    this.calls.organize += 1;
    if (String(setId) !== this.setId) throw new Error("Fake organizer set mismatch");
    const required = new Set(requiredItemIds.map(String));
    const protectedIds = new Set(protectedItemIds.map(String));
    if (!required.size || required.size > 11) throw new Error("Fake organizer required-card count invalid");
    if ([...required].some((id) => protectedIds.has(id))) {
      throw new Error("Fake organizer protected-card violation");
    }
    const unassignedIds = new Set(this.unassigned.map(itemId));
    if ([...required].some((id) => !unassignedIds.has(id))) {
      throw new Error("Fake organizer required card is unavailable");
    }
    const filler = this.club
      .filter((item) => !protectedIds.has(itemId(item)))
      .slice(0, 11 - required.size);
    if (filler.length + required.size !== 11) {
      throw new Error("Fake organizer has insufficient filler");
    }
    const fillerIds = new Set(filler.map(itemId));
    this.unassigned = this.unassigned.filter((item) => !required.has(itemId(item)));
    this.club = this.club.filter((item) => !fillerIds.has(itemId(item)));
    const completedId = String(challengeId || this.#challengeId());
    this.completedChallenges.add(completedId);
    return this.#finish("organize", {
      success: true,
      completed: true,
      setId: this.setId,
      challengeId: completedId,
      requiredItemIds: [...required],
      solutionIds: [...required, ...fillerIds],
      unresolvedItemIds: this.unassigned.map(itemId),
    });
  }

  async readSbcChallengeState({ setId, challengeId } = {}) {
    return {
      setId: String(setId),
      challengeId: String(challengeId),
      available: true,
      completed: this.completedChallenges.has(String(challengeId)),
      status: this.completedChallenges.has(String(challengeId)) ? "COMPLETED" : "ACTIVE",
    };
  }
}
