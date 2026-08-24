import {
  PackPolicyError,
  assertNoUnassigned,
  assertOwnedFreePack,
  getUnassignedCount,
  normalizePackPolicy,
  selectPacksForPolicy,
} from "./pack-policy.js";

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
    const normalizedPolicy = normalizePackPolicy(policy);
    const selected = selectPacksForPolicy({ packs, policy: normalizedPolicy, currentReward });
    return { policy: normalizedPolicy, packs: selected.map((pack) => ({ ...pack })) };
  }

  async open({ policy, currentReward } = {}) {
    const plan = await this.plan({ policy, currentReward });
    const opened = [];

    for (const pack of plan.packs) {
      assertNoUnassigned(await this.inventoryService.getState());
      assertOwnedFreePack(pack);
      const packId = idOf(pack);
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
        unresolved = getUnassignedCount(inventory);
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
