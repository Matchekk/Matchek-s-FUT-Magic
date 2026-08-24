import {
  getBasePlayerId,
  getOwnedItemId,
  getResourceId,
  normalizeOwnedItems,
} from "../sbc/solver/item-identity.js";
import { calculateFc26SquadRating, FC26_SQUAD_SIZE } from "../sbc/solver/rating.js";
import { TargetProjectService } from "./target-project-service.js";

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const normalizeIds = (values) =>
  new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map(String),
  );

const normalizeReserveMap = (value) => {
  const result = new Map();
  if (!value || typeof value !== "object") return result;
  for (const [rawRating, rawCount] of Object.entries(value)) {
    const rating = Math.trunc(numberOrNull(rawRating) ?? 0);
    const count = Math.max(0, Math.trunc(numberOrNull(rawCount) ?? 0));
    if (rating >= 1 && rating <= 99 && count > 0) result.set(rating, count);
  }
  return result;
};

const getRating = (item) => Math.max(0, numberOrNull(item?.rating) ?? 0);

const getCardType = (item) =>
  String(
    item?.cardType ??
      item?.specialCardGroup ??
      item?.rarityGroup ??
      item?.rarityName ??
      "base",
  )
    .trim()
    .toLowerCase();

const BASE_CARD_TYPES = new Set([
  "base",
  "common",
  "rare",
  "bronze",
  "silver",
  "gold",
  "common bronze",
  "rare bronze",
  "common silver",
  "rare silver",
  "common gold",
  "rare gold",
]);

const isSpecial = (item) => {
  if (typeof item?.isSpecial === "function") return Boolean(item.isSpecial());
  if (item?.isSpecial != null) return Boolean(item.isSpecial);
  return !BASE_CARD_TYPES.has(getCardType(item));
};

const getReplacementCost = (item) => {
  for (const raw of [
    item?.estimatedReplacementCost,
    item?.marketPrice,
    item?.price,
    item?.priceMeta?.price,
    item?.futggPrice,
  ]) {
    const parsed = numberOrNull(raw);
    if (parsed != null && parsed >= 0) return parsed;
  }
  return Math.pow(getRating(item), 3);
};

const normalizeRange = (value) => {
  if (Array.isArray(value)) {
    return {
      min: Math.max(1, Math.trunc(numberOrNull(value[0]) ?? 1)),
      max: Math.min(99, Math.trunc(numberOrNull(value[1]) ?? 99)),
    };
  }
  const source = value && typeof value === "object" ? value : {};
  return {
    min: Math.max(1, Math.trunc(numberOrNull(source.min) ?? 1)),
    max: Math.min(99, Math.trunc(numberOrNull(source.max) ?? 99)),
  };
};

const mergeReserveMaps = (...maps) => {
  const result = new Map();
  for (const map of maps) {
    for (const [rating, count] of map.entries()) {
      result.set(rating, (result.get(rating) || 0) + count);
    }
  }
  return result;
};

const mergeSpecialReserveMaps = (...values) => {
  const result = {};
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    for (const [rawType, rawCount] of Object.entries(value)) {
      const type = String(rawType).trim().toLowerCase();
      const count = Math.max(0, Math.trunc(numberOrNull(rawCount) ?? 0));
      if (!type || !count) continue;
      result[type] = (result[type] || 0) + count;
    }
  }
  return result;
};

const lexicographicCompare = (left, right) => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

export const compareObjectiveTuples = lexicographicCompare;

export const FODDER_OBJECTIVE_FIELDS = Object.freeze([
  "hardRequirementViolations",
  "protectedCardViolations",
  "scarceSpecialUsage",
  "nonExpendableCardUsage",
  "preferencePenalty",
  "premiumFodderPenalty",
  "replacementCost",
  "ratingOvershoot",
]);

export class FodderPolicy {
  constructor(config = {}, { targetProjects = [] } = {}) {
    const projectService =
      targetProjects instanceof TargetProjectService
        ? targetProjects
        : new TargetProjectService(targetProjects);
    const projectOverlay = projectService.getFodderPolicyOverlay();
    const configuredThreshold = numberOrNull(config.protectRatingAtOrAbove);
    const projectThreshold = numberOrNull(projectOverlay.protectRatingAtOrAbove);
    const thresholds = [configuredThreshold, projectThreshold].filter(
      (value) => value != null,
    );
    const configuredReserve = normalizeReserveMap(config.minimumReserveByRating);
    const projectReserve = normalizeReserveMap(projectOverlay.minimumReserveByRating);

    this.config = Object.freeze({
      protectRatingAtOrAbove: thresholds.length ? Math.min(...thresholds) : null,
      preferredFodderRange: normalizeRange(config.preferredFodderRange),
      protectedCardTypes: Object.freeze(normalizeStrings(config.protectedCardTypes)),
      allowedSpecialTypes: Object.freeze(normalizeStrings(config.allowedSpecialTypes)),
      restrictSpecialTypes: Array.isArray(config.allowedSpecialTypes),
      protectedItemIds: Object.freeze([...normalizeIds(config.protectedItemIds)]),
      protectedPlayerIds: Object.freeze([
        ...normalizeIds(config.protectedPlayerIds),
        ...projectOverlay.protectedPlayerIds,
      ]),
      protectedResourceIds: Object.freeze([
        ...normalizeIds(config.protectedResourceIds),
        ...projectOverlay.protectedResourceIds,
      ]),
      protectedExactRatings: Object.freeze(
        Array.from(
          new Set([
            ...(Array.isArray(config.protectedRatings) ? config.protectedRatings : []),
            ...projectOverlay.protectedExactRatings,
          ]),
        )
          .map((rating) => Math.trunc(numberOrNull(rating) ?? 0))
          .filter((rating) => rating >= 1 && rating <= 99),
      ),
      protectStartingSquad: config.protectStartingSquad === true,
      protectFavorites: config.protectFavorites === true,
      protectTradables: config.protectTradables === true,
      preferUntradeables: config.preferUntradeables !== false,
      preferDuplicates: config.preferDuplicates !== false,
      preferSbcStorage: config.preferSbcStorage !== false,
      minimumReserveByRating: mergeReserveMaps(configuredReserve, projectReserve),
      specialReserveByCardType: Object.freeze(
        mergeSpecialReserveMaps(
          projectOverlay.specialReserveByCardType,
          config.specialReserveByCardType,
        ),
      ),
      projectRatingDemand: Object.freeze(projectOverlay.projectRatingDemand),
      activeTargetProjectIds: Object.freeze(projectOverlay.activeProjectIds),
    });
  }

  #baseReasons(item) {
    const reasons = [];
    const rating = getRating(item);
    const itemId = getOwnedItemId(item);
    const resourceId = getResourceId(item);
    const playerId = getBasePlayerId(item);
    const cardType = getCardType(item);
    const protectedPlayerIds = new Set(this.config.protectedPlayerIds);
    const protectedItemIds = new Set(this.config.protectedItemIds);
    const protectedResourceIds = new Set(this.config.protectedResourceIds);
    const protectedCardTypes = new Set(this.config.protectedCardTypes);
    const allowedSpecialTypes = new Set(this.config.allowedSpecialTypes);

    if (item?.isLocked === true) reasons.push("locked-item");
    if (item?.isProtected === true) reasons.push("protected-item-flag");
    if (itemId != null && protectedItemIds.has(itemId)) reasons.push("protected-item");
    if (playerId != null && protectedPlayerIds.has(playerId)) reasons.push("protected-player");
    if (resourceId != null && protectedResourceIds.has(resourceId)) {
      reasons.push("protected-resource");
    }
    if (this.config.protectRatingAtOrAbove != null && rating >= this.config.protectRatingAtOrAbove) {
      reasons.push("protected-rating");
    }
    if (this.config.protectedExactRatings.includes(rating)) {
      reasons.push("target-project-rating");
    }
    if (protectedCardTypes.has(cardType)) reasons.push("protected-card-type");
    if (
      isSpecial(item) &&
      this.config.restrictSpecialTypes &&
      !allowedSpecialTypes.has(cardType)
    ) {
      reasons.push("special-type-not-allowed");
    }
    if (
      this.config.protectStartingSquad &&
      (item?.isInStartingSquad || item?.isInActive11)
    ) {
      reasons.push("starting-squad");
    }
    if (this.config.protectFavorites && (item?.isFavorite || item?.isFavourite)) {
      reasons.push("favorite");
    }
    if (
      this.config.protectTradables &&
      (item?.isTradable === true || item?.isUntradeable === false)
    ) {
      reasons.push("tradable");
    }
    return reasons;
  }

  #preservationTuple(item) {
    return [
      Number(isSpecial(item)),
      Number(Boolean(item?.isTradable)),
      Number(!item?.isDuplicate),
      Number(!item?.isStorage),
      getReplacementCost(item),
    ];
  }

  analyze(items) {
    const normalizedItems = normalizeOwnedItems(items).map((item) => ({
      ...item,
      id: item.id ?? item.itemId,
    }));
    const reasons = new Map(
      normalizedItems.map((item) => [item.itemId, this.#baseReasons(item)]),
    );

    const protectReserve = (candidates, required, reason) => {
      const alreadyProtected = candidates.filter(
        (item) => (reasons.get(item.itemId) || []).length > 0,
      ).length;
      const needed = Math.max(0, required - alreadyProtected);
      if (!needed) return;
      candidates
        .filter((item) => (reasons.get(item.itemId) || []).length === 0)
        .sort((left, right) => {
          const comparison = lexicographicCompare(
            this.#preservationTuple(right),
            this.#preservationTuple(left),
          );
          return comparison || left.itemId.localeCompare(right.itemId);
        })
        .slice(0, needed)
        .forEach((item) => reasons.get(item.itemId).push(reason));
    };

    for (const [rating, required] of this.config.minimumReserveByRating.entries()) {
      protectReserve(
        normalizedItems.filter((item) => getRating(item) === rating),
        required,
        `minimum-rating-reserve:${rating}`,
      );
    }
    for (const [rawType, rawRequired] of Object.entries(
      this.config.specialReserveByCardType,
    )) {
      const type = String(rawType).trim().toLowerCase();
      const required = Math.max(0, Math.trunc(numberOrNull(rawRequired) ?? 0));
      if (!type || !required) continue;
      protectReserve(
        normalizedItems.filter((item) => getCardType(item) === type),
        required,
        `minimum-special-reserve:${type}`,
      );
    }

    const protectedItemIds = normalizedItems
      .filter((item) => (reasons.get(item.itemId) || []).length > 0)
      .map((item) => item.itemId);
    const protectedIdSet = new Set(protectedItemIds);
    return {
      items: normalizedItems,
      protectedItemIds,
      protectedIds: protectedItemIds,
      eligibleItems: normalizedItems.filter(
        (item) => !protectedIdSet.has(item.itemId),
      ),
      reasonsByItemId: Object.fromEntries(
        [...reasons.entries()].filter(([, itemReasons]) => itemReasons.length),
      ),
      activeTargetProjectIds: [...this.config.activeTargetProjectIds],
    };
  }

  getProtectedItemIds(items) {
    return this.analyze(items).protectedItemIds;
  }

  getSquadObjectiveTuple(
    squad,
    {
      allItems = squad,
      hardRequirementViolations = 0,
      targetRating = null,
      analysis = null,
    } = {},
  ) {
    const policyAnalysis = analysis || this.analyze(allItems);
    const protectedIds = new Set(policyAnalysis.protectedItemIds);
    const protectedCardViolations = squad.filter((item) => {
      const id = getOwnedItemId(item);
      return id != null && protectedIds.has(id);
    }).length;
    let scarceSpecialUsage = 0;
    let nonExpendableCardUsage = 0;
    let preferencePenalty = 0;
    let premiumFodderPenalty = 0;
    let replacementCost = 0;

    for (const item of squad) {
      const type = getCardType(item);
      const rating = getRating(item);
      const reserve = numberOrNull(this.config.specialReserveByCardType[type]) ?? 0;
      if (reserve > 0 && isSpecial(item)) scarceSpecialUsage += reserve;
      if (isSpecial(item)) nonExpendableCardUsage += 1;
      if (this.config.preferDuplicates && !item?.isDuplicate) preferencePenalty += 1;
      if (this.config.preferSbcStorage && !item?.isStorage) preferencePenalty += 1;
      if (this.config.preferUntradeables && !item?.isUntradeable) preferencePenalty += 1;

      const preferredMax = this.config.preferredFodderRange.max;
      if (rating > preferredMax) premiumFodderPenalty += Math.pow(rating - preferredMax, 2);
      for (const demand of this.config.projectRatingDemand) {
        if (rating >= demand.rating) {
          premiumFodderPenalty +=
            (rating - demand.rating + 1) * demand.count * Math.max(1, demand.priority);
        }
      }
      replacementCost += getReplacementCost(item);
    }

    let ratingOvershoot = 0;
    if (targetRating != null && squad.length === FC26_SQUAD_SIZE) {
      ratingOvershoot = Math.max(
        0,
        calculateFc26SquadRating(squad.map((item) => getRating(item))) -
          Number(targetRating),
      );
    }
    return Object.freeze([
      Math.max(0, Math.trunc(numberOrNull(hardRequirementViolations) ?? 0)),
      protectedCardViolations,
      scarceSpecialUsage,
      nonExpendableCardUsage,
      preferencePenalty,
      premiumFodderPenalty,
      replacementCost,
      ratingOvershoot,
    ]);
  }
}
