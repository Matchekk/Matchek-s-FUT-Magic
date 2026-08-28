import {
  PackPolicyError,
  assertNoUnassigned,
  assertOwnedFreePack,
  getUnassignedCount,
  normalizePackPolicy,
  selectPacksForPolicy,
} from "./pack-policy.js";
import { EarnedPackTracker } from "./earned-pack-tracker.js";

const idOf = (pack) => String(pack?.packId ?? pack?.id ?? "");

export class PackService {
  constructor({ adapter, inventoryService, logger = null } = {}) {
    if (!adapter?.listOwnedPacks || !adapter?.openOwnedPack) {
      throw new TypeError("PackService requires listOwnedPacks and openOwnedPack adapter methods");
    }
    if (!inventoryService?.getState || !inventoryService?.refresh) {
      throw new TypeError("PackService requires getState and refresh inventory methods");
    }
    this.adapter = adapter;
    this.inventoryService = inventoryService;
    this.logger = logger;
  }

  async plan({ policy, currentReward } = {}) {
    assertNoUnassigned(await this.inventoryService.getState());
    const packs = await this.adapter.listOwnedPacks();
    const ownedSnapshot = EarnedPackTracker.capture(packs);
    const normalizedPolicy = normalizePackPolicy(policy);
    const selected = currentReward?.packBinding && normalizedPolicy.mode === "OPEN_CURRENT_REWARD"
      ? [EarnedPackTracker.resolve(currentReward.packBinding, packs)]
      : selectPacksForPolicy({ packs, policy: normalizedPolicy, currentReward });
    return {
      policy: normalizedPolicy,
      packs: selected.map((pack) => ({ ...pack })),
      packSnapshotFingerprint: ownedSnapshot.fingerprint,
      packExpectations: selected.map((pack) => ({
        packId: idOf(pack),
        packType: String(pack?.packType ?? pack?.type ?? ""),
        count: Number(pack?.count ?? 1),
      })),
      currentRewardBinding: normalizedPolicy.mode === "OPEN_CURRENT_REWARD"
        ? currentReward?.packBinding ?? null
        : null,
    };
  }

  async open({ policy, currentReward } = {}) {
    const plan = await this.plan({ policy, currentReward });
    return this.openPlan(plan);
  }

  async openPlan(plan = {}) {
    if (
      !Array.isArray(plan?.packs) ||
      !Array.isArray(plan?.packExpectations) ||
      typeof plan?.packSnapshotFingerprint !== "string"
    ) {
      throw new PackPolicyError("INVALID_PACK_PLAN", "A verified owned-pack plan is required");
    }
    const ownedAtStart = await this.adapter.listOwnedPacks();
    const startSnapshot = EarnedPackTracker.capture(ownedAtStart);
    if (startSnapshot.fingerprint !== plan.packSnapshotFingerprint) {
      throw new PackPolicyError("PACK_PLAN_STALE", "Owned packs changed after this plan was prepared");
    }
    const opened = [];

    for (let index = 0; index < plan.packs.length; index += 1) {
      const pack = plan.packs[index];
      assertNoUnassigned(await this.inventoryService.getState());
      assertOwnedFreePack(pack);
      const packId = idOf(pack);
      const expectation = plan.packExpectations[index];
      if (!expectation || expectation.packId !== packId) {
        throw new PackPolicyError("INVALID_PACK_PLAN", "Pack plan evidence does not match its selected pack");
      }
      const currentPacks = await this.adapter.listOwnedPacks();
      const matching = currentPacks.filter((entry) => idOf(entry) === packId);
      const expectedCount = expectation.count - opened.filter((entry) => entry.packId === packId).length;
      if (
        matching.length !== 1 ||
        Number(matching[0]?.count ?? 1) !== expectedCount ||
        String(matching[0]?.packType ?? matching[0]?.type ?? "") !== expectation.packType
      ) {
        throw new PackPolicyError("PACK_PLAN_STALE", "The selected owned pack is no longer in its reviewed state", {
          packId,
        });
      }
      if (plan.currentRewardBinding) {
        const resolved = EarnedPackTracker.resolve(plan.currentRewardBinding, currentPacks);
        if (idOf(resolved) !== packId) {
          throw new PackPolicyError("PACK_PLAN_STALE", "The earned-pack binding no longer matches the reviewed pack", {
            packId,
          });
        }
      }
      this.logger?.info?.("pack.open.intent", { packId });

      // This deliberately exposes no price or purchase argument to the adapter.
      const response = await this.adapter.openOwnedPack({ packId });
      if (response?.opened !== true || !Array.isArray(response.items)) {
        throw new PackPolicyError("PACK_OPEN_UNVERIFIED", "Pack opening response was not verifiable", { packId });
      }

      const inventory = await this.inventoryService.refresh();
      opened.push({ packId, itemCount: response.items.length, response });
      this.logger?.info?.("pack.opened", { packId, itemCount: response.items.length });

      let unresolved;
      try {
        unresolved = getUnassignedCount(
          Array.isArray(inventory?.unassigned?.items)
            ? { ...inventory, unassigned: inventory.unassigned.items }
            : inventory,
        );
      } catch (error) {
        return { status: "blocked", reason: error.code ?? "INVENTORY_STATE_UNVERIFIED", opened, inventory };
      }
      if (unresolved > 0) {
        return { status: "blocked", reason: "UNASSIGNED_BLOCKING", opened, inventory };
      }
    }

    return { status: "completed", opened };
  }
}
