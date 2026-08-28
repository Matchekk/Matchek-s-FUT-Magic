import { buildDuplicateRelations } from "../inventory/duplicate-relations.js";
import { getDuplicateKey } from "../inventory/duplicate-service.js";
import { explainRoutingDecision, RoutingReason } from "./routing-explainer.js";
import {
  RoutingDestination,
  RoutingEffect,
  RoutingTradeability,
  routingRuleMatches,
} from "./routing-rule.js";
import { normalizeRoutingRuleset, ROUTING_LIMITS } from "./routing-ruleset.js";
import { validateRoutingDestination } from "./routing-validator.js";

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value) => {
  const input = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const defaultDecision = (context) => {
  if (context.ambiguousDuplicate) {
    return [RoutingDestination.ASK_USER, RoutingReason.DUPLICATE_IDENTITY_AMBIGUOUS];
  }
  if (!context.duplicate) {
    return [RoutingDestination.CLUB, RoutingReason.NON_DUPLICATE_TO_CLUB];
  }
  if (
    context.tradeability === RoutingTradeability.UNTRADEABLE &&
    context.storageFreeSlots > 0
  ) {
    return [RoutingDestination.SBC_STORAGE, RoutingReason.DUPLICATE_TO_STORAGE];
  }
  if (context.tradeability === RoutingTradeability.TRADEABLE) {
    return [RoutingDestination.KEEP_UNASSIGNED, RoutingReason.TRADEABLE_DUPLICATE_PRESERVED];
  }
  return [RoutingDestination.ASK_USER, RoutingReason.TRADEABILITY_UNVERIFIED];
};

const tradeabilityOf = (item) => item.hasTradabilityEvidence !== true
  ? RoutingTradeability.UNKNOWN
  : item.isTradable === true
    ? RoutingTradeability.TRADEABLE
    : RoutingTradeability.UNTRADEABLE;

export class RoutingEngine {
  plan({
    inventorySnapshot,
    ruleset,
    duplicateRelations = null,
    protectionAnalysis = {},
    recipeCandidates = [],
    activityGuard = { state: "NORMAL" },
  } = {}) {
    if (!inventorySnapshot || !Array.isArray(inventorySnapshot.items)) {
      throw new TypeError("RoutingEngine requires a complete inventory snapshot");
    }
    if (inventorySnapshot.items.length > ROUTING_LIMITS.maxItems) {
      throw new RangeError(`Routing input exceeds ${ROUTING_LIMITS.maxItems} items`);
    }
    const normalizedRuleset = normalizeRoutingRuleset(ruleset);
    const relations = duplicateRelations ?? buildDuplicateRelations(inventorySnapshot);
    const relationByKey = new Map(relations.relations.map((entry) => [entry.relationKey, entry]));
    const ambiguousIds = new Set(relations.ambiguousItemRefs.map(({ itemId }) => itemId));
    const protectedItemIds = new Set(
      [...(protectionAnalysis.protectedItemIds ?? [])].map(String),
    );
    const verifiedRecipeItems = new Set(
      recipeCandidates.filter((entry) => entry?.verified === true)
        .flatMap((entry) => entry.acceptedItemIds ?? []).map(String),
    );
    const capacity = Number.isSafeInteger(inventorySnapshot.storageCapacity)
      ? inventorySnapshot.storageCapacity
      : null;
    let storageFreeSlots = capacity == null
      ? 0
      : Math.max(0, capacity - (inventorySnapshot.storage?.items?.length ?? 0));

    const decisions = [];
    const items = [...(inventorySnapshot.unassigned?.items ?? [])]
      .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)));
    for (const item of items) {
      const key = getDuplicateKey(item);
      const relation = key ? relationByKey.get(key) : null;
      const duplicate = Boolean(
        item.isDuplicate === true ||
        (
          relation &&
          relation.copies.club.length + relation.copies.sbcStorage.length + relation.copies.unassigned.length > 1
        ),
      );
      const context = {
        item,
        location: item.location,
        duplicate,
        ambiguousDuplicate: ambiguousIds.has(String(item.itemId)) || (item.isDuplicate === true && !key),
        tradeability: tradeabilityOf(item),
        rating: Number(item.rating || 0),
        rarity: item.rarityName ?? item.rarityId ?? "",
        cardType: item.cardType ?? "",
        itemType: item.itemType ?? "player",
        storageFreeSlots,
        transferSourceAvailable: relations.transferSourceAvailable,
        protectedItemIds,
        recipeVerified: verifiedRecipeItems.has(String(item.itemId)),
        activityGuard,
      };

      const matched = normalizedRuleset.rules.find(
        (rule) => rule.enabled && routingRuleMatches(rule, context),
      );
      let [destination, reason] = matched
        ? [matched.destination, RoutingReason.RULE_MATCHED]
        : defaultDecision(context);
      const validation = validateRoutingDestination(destination, context);
      if (!validation.valid) {
        destination = validation.fallback;
        reason = validation.reason;
      }
      if (destination === RoutingDestination.SBC_STORAGE) storageFreeSlots -= 1;
      decisions.push(Object.freeze({
        itemRef: Object.freeze({
          itemId: String(item.itemId),
          generation: inventorySnapshot.generation,
        }),
        destination,
        effect: validation.valid ? validation.effect : destination === RoutingDestination.KEEP_UNASSIGNED
          ? RoutingEffect.PRESERVE
          : RoutingEffect.MANUAL,
        ruleId: matched?.id ?? null,
        reasonCodes: Object.freeze([reason]),
        explanation: explainRoutingDecision([reason]),
      }));
    }

    const inventoryFingerprint = fingerprint({
      generation: inventorySnapshot.generation,
      items: inventorySnapshot.items.map((item) => ({
        itemId: item.itemId,
        location: item.location,
        resourceId: item.resourceId,
        definitionId: item.definitionId,
        isDuplicate: item.isDuplicate,
        isTradable: item.isTradable,
        hasTradabilityEvidence: item.hasTradabilityEvidence,
      })),
      storageCapacity: inventorySnapshot.storageCapacity,
    });
    const rulesetFingerprint = fingerprint(normalizedRuleset);
    return Object.freeze({
      schemaVersion: 1,
      inventoryGeneration: inventorySnapshot.generation,
      inventoryFingerprint,
      rulesetFingerprint,
      rulesetId: normalizedRuleset.id,
      decisions: Object.freeze(decisions),
      blockers: Object.freeze(decisions
        .filter(({ destination }) => destination === RoutingDestination.ASK_USER)
        .map(({ itemRef, reasonCodes }) => Object.freeze({ itemRef, reasonCodes }))),
      canExecute: false,
      readOnly: true,
    });
  }
}

export { fingerprint as fingerprintRoutingValue };
