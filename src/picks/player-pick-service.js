import { decidePlayerPick } from "./pick-policy.js";

export class PlayerPickService {
  constructor({ adapter, logger = null } = {}) {
    if (!adapter?.getPlayerPick || !adapter?.selectPlayerPick) {
      throw new TypeError("PlayerPickService requires getPlayerPick and selectPlayerPick adapter methods");
    }
    this.adapter = adapter;
    this.logger = logger;
  }

  async handle({ pickId, policy, context = {}, execute = false, approved = false } = {}) {
    const pick = await this.adapter.getPlayerPick(pickId);
    if (!pick || !Array.isArray(pick.offers) || pick.resolved === true) {
      return { status: "paused", reason: "PICK_STATE_UNVERIFIED", selectedItemId: null };
    }

    const decision = decidePlayerPick(pick.offers, policy, context);
    this.logger?.info?.("player-pick.decision", {
      pickId,
      status: decision.status,
      reason: decision.reason,
      intendedItemId: decision.selectedItemId,
    });
    if (decision.status !== "selected" || !execute) return decision;
    if (!approved) return { ...decision, status: "paused", reason: "DESTRUCTIVE_APPROVAL_REQUIRED" };

    const response = await this.adapter.selectPlayerPick({ pickId, itemId: decision.selectedItemId });
    const responseItemId = String(response?.selectedItemId ?? response?.itemId ?? "");
    if (response?.success !== true || responseItemId !== decision.selectedItemId) {
      return { ...decision, status: "paused", reason: "PICK_SELECTION_UNVERIFIED", response };
    }
    this.logger?.info?.("player-pick.selected", { pickId, itemId: decision.selectedItemId });
    return { ...decision, status: "completed", response };
  }
}
