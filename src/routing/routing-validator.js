import { RoutingDestination, RoutingEffect } from "./routing-rule.js";
import { RoutingReason } from "./routing-explainer.js";

const guardAllowsAdvice = (guard) => {
  const state = String(guard?.state ?? "UNKNOWN").toUpperCase();
  return ["IDLE", "NORMAL"].includes(state);
};

export function validateRoutingDestination(destination, context) {
  if (!guardAllowsAdvice(context.activityGuard)) {
    return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.ACTIVITY_GUARD_BLOCKED };
  }
  if (destination === RoutingDestination.CLUB) {
    return context.item.hasMovableEvidence === true && context.item.isMovable === true
      ? { valid: true, effect: RoutingEffect.PRESERVE }
      : { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.MOVE_EVIDENCE_MISSING };
  }
  if (destination === RoutingDestination.SBC_STORAGE) {
    if (context.item.hasStorableEvidence !== true || context.item.isStorable !== true) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.STORAGE_EVIDENCE_MISSING };
    }
    if (!context.duplicate || context.storageFreeSlots <= 0) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.STORAGE_UNAVAILABLE };
    }
    return { valid: true, effect: RoutingEffect.PRESERVE };
  }
  if (destination === RoutingDestination.TRANSFER_LIST) {
    if (context.item.hasTradabilityEvidence !== true) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.TRADEABILITY_UNVERIFIED };
    }
    return context.transferSourceAvailable === true
      ? { valid: true, effect: RoutingEffect.PRESERVE }
      : { valid: false, fallback: RoutingDestination.KEEP_UNASSIGNED, reason: RoutingReason.TRANSFER_SOURCE_UNAVAILABLE };
  }
  if (destination === RoutingDestination.ACTIVE_RECIPE) {
    if (context.protectedItemIds.has(context.item.itemId)) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.PROTECTED_FROM_CONSUMPTION };
    }
    const evidenceReady = [
      "hasTradabilityEvidence", "hasLockedEvidence", "hasProtectedEvidence",
      "hasStartingSquadEvidence", "hasSpecialEvidence",
    ].every((field) => context.item[field] === true);
    if (!evidenceReady || context.recipeVerified !== true) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.RECIPE_UNVERIFIED };
    }
    return { valid: true, effect: RoutingEffect.CONSUME };
  }
  if (destination === RoutingDestination.KEEP_UNASSIGNED) {
    return { valid: true, effect: RoutingEffect.PRESERVE };
  }
  return { valid: true, effect: RoutingEffect.MANUAL };
}

export function validateRoutingPlan(plan, current = {}) {
  const blockers = [];
  if (plan.inventoryGeneration !== current.inventoryGeneration) blockers.push("STALE_INVENTORY_GENERATION");
  if (current.inventoryFingerprint != null && plan.inventoryFingerprint !== current.inventoryFingerprint) {
    blockers.push("STALE_INVENTORY_FINGERPRINT");
  }
  if (current.rulesetFingerprint != null && plan.rulesetFingerprint !== current.rulesetFingerprint) {
    blockers.push("STALE_RULESET");
  }
  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(blockers) });
}
