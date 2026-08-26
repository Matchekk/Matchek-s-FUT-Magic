import { decidePlayerPick } from "./pick-policy.js";

const pickIdentity = (pick) =>
  String(pick?.pickIdentity ?? pick?.pickId ?? pick?.id ?? "");

const offerIdentity = (pick) => {
  if (pick?.offerIdentity) return String(pick.offerIdentity);
  if (!Array.isArray(pick?.offers)) return "";
  return pick.offers
    .map((offer) => `${String(offer?.itemId ?? offer?.id ?? "")}:${String(offer?.resourceId ?? "")}`)
    .sort()
    .join("|");
};

export class PlayerPickService {
  constructor({ adapter, logger = null } = {}) {
    if (!adapter?.getPlayerPick || !adapter?.selectPlayerPick) {
      throw new TypeError("PlayerPickService requires getPlayerPick and selectPlayerPick adapter methods");
    }
    this.adapter = adapter;
    this.logger = logger;
  }

  async handle({ pickId, policy, context = {}, execute = false, approved = false, expectedIntent = null } = {}) {
    const pick = await this.adapter.getPlayerPick(pickId);
    if (pick?.resolved === true && pick?.pending !== true) {
      return { status: "completed", reason: "PICK_ALREADY_RESOLVED", selectedItemId: null };
    }
    if (!pick || pick?.availability === "unavailable" || !Array.isArray(pick.offers) || !pick.offers.length) {
      return { status: "paused", reason: "PICK_STATE_UNVERIFIED", selectedItemId: null };
    }

    const observedPickIdentity = pickIdentity(pick);
    const observedOfferIdentity = offerIdentity(pick);
    if (!observedPickIdentity || !observedOfferIdentity) {
      return { status: "paused", reason: "PICK_IDENTITY_UNVERIFIED", selectedItemId: null };
    }
    if (pickId != null && String(pickId) !== observedPickIdentity) {
      return { status: "paused", reason: "PICK_IDENTITY_CHANGED", selectedItemId: null };
    }

    const decision = decidePlayerPick(pick.offers, policy, context);
    const intent = decision.selectedItemId
      ? {
          pickIdentity: observedPickIdentity,
          offerIdentity: observedOfferIdentity,
          selectedItemId: decision.selectedItemId,
          selectedResourceId: decision.selected?.resourceId || null,
        }
      : null;
    if (
      expectedIntent &&
      (
        String(expectedIntent.pickIdentity ?? "") !== String(intent?.pickIdentity ?? "") ||
        String(expectedIntent.offerIdentity ?? "") !== String(intent?.offerIdentity ?? "") ||
        String(expectedIntent.selectedItemId ?? "") !== String(intent?.selectedItemId ?? "")
      )
    ) {
      return { ...decision, intent, status: "paused", reason: "PICK_INTENT_STALE" };
    }
    this.logger?.info?.("player-pick.decision", {
      pickId,
      status: decision.status,
      reason: decision.reason,
      intendedItemId: decision.selectedItemId,
    });
    if (decision.status !== "selected" || !execute) return { ...decision, intent };
    if (!approved) return { ...decision, intent, status: "paused", reason: "DESTRUCTIVE_APPROVAL_REQUIRED" };

    const current = await this.adapter.getPlayerPick(observedPickIdentity);
    if (
      pickIdentity(current) !== observedPickIdentity ||
      offerIdentity(current) !== observedOfferIdentity ||
      !current?.offers?.some((offer) => String(offer?.itemId ?? offer?.id ?? "") === decision.selectedItemId)
    ) {
      return { ...decision, intent, status: "paused", reason: "PICK_INTENT_STALE" };
    }

    const response = await this.adapter.selectPlayerPick({
      pickId: observedPickIdentity,
      pickIdentity: observedPickIdentity,
      offerIdentity: observedOfferIdentity,
      itemId: decision.selectedItemId,
      resourceId: decision.selected?.resourceId || null,
    });
    const responseItemId = String(response?.selectedItemId ?? response?.itemId ?? "");
    if (response?.success !== true || responseItemId !== decision.selectedItemId) {
      return { ...decision, intent, status: "paused", reason: "PICK_SELECTION_UNVERIFIED", response };
    }
    this.logger?.info?.("player-pick.selected", { pickId, itemId: decision.selectedItemId });
    return { ...decision, intent, status: "completed", response };
  }

  async recover(intent, context = {}) {
    if (!intent?.pickIdentity || !intent?.selectedItemId) {
      return { status: "ambiguous", reason: "PICK_INTENT_MISSING" };
    }
    if (typeof this.adapter.reconcilePlayerPick === "function") {
      return this.adapter.reconcilePlayerPick(intent, context);
    }
    const current = await this.adapter.getPlayerPick(intent.pickIdentity);
    if (current?.pending === true && pickIdentity(current) === String(intent.pickIdentity)) {
      if (offerIdentity(current) === String(intent.offerIdentity)) {
        return { status: "not_applied", reason: "PICK_STILL_PENDING" };
      }
      return { status: "ambiguous", reason: "PICK_OFFERS_CHANGED" };
    }
    const items = Array.isArray(context?.inventoryItems) ? context.inventoryItems : [];
    const beforeItemIds = new Set(
      (intent.inventoryItemIdsBefore ?? []).map(String),
    );
    const selectedObserved = items.some((item) => {
      const id = String(item?.itemId ?? item?.id ?? "");
      return id === String(intent.selectedItemId) && !beforeItemIds.has(id);
    });
    const resourceCountAfter = intent.selectedResourceId
      ? items.filter(
          (item) =>
            String(item?.resourceId ?? "") === String(intent.selectedResourceId),
        ).length
      : 0;
    const resourceDeltaObserved =
      intent.selectedResourceId &&
      Number.isSafeInteger(intent.selectedResourceCountBefore) &&
      resourceCountAfter > intent.selectedResourceCountBefore;
    if (selectedObserved || resourceDeltaObserved) {
      return { status: "completed", result: { selectedItemId: intent.selectedItemId } };
    }
    return { status: "ambiguous", reason: "PICK_CONSUMPTION_UNVERIFIED" };
  }
}
