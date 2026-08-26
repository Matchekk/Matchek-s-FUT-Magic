export const PLAYER_PICK_POLICIES = Object.freeze({
  PAUSE_FOR_USER: "PAUSE_FOR_USER",
  HIGHEST_RATING: "HIGHEST_RATING",
  HIGHEST_VALUE: "HIGHEST_VALUE",
  PREFER_NON_DUPLICATE: "PREFER_NON_DUPLICATE",
  PREFER_REQUIRED_SPECIAL: "PREFER_REQUIRED_SPECIAL",
  CUSTOM_PRIORITY: "CUSTOM_PRIORITY",
});

const VALID_POLICIES = new Set(Object.values(PLAYER_PICK_POLICIES));
const VALID_CRITERIA = new Set([
  "REQUIRED_SPECIAL",
  "NON_DUPLICATE",
  "PREFERRED_PLAYER",
  "PREFERRED_RESOURCE",
  "PREFERRED_CARD_TYPE",
  "RATING",
  "VALUE",
]);

export class PlayerPickPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PlayerPickPolicyError";
    this.code = code;
    this.details = details;
  }
}

function strings(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new PlayerPickPolicyError("INVALID_PICK_POLICY", `${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

export function normalizePlayerPickPolicy(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new PlayerPickPolicyError("INVALID_PICK_POLICY", "Player-pick policy must be an object");
  }
  const type = input.type ?? PLAYER_PICK_POLICIES.PAUSE_FOR_USER;
  if (!VALID_POLICIES.has(type)) {
    throw new PlayerPickPolicyError("INVALID_PICK_POLICY", `Unsupported player-pick policy: ${String(type)}`);
  }

  const criteria = input.criteria ?? [];
  if (!Array.isArray(criteria) || criteria.some((criterion) => !VALID_CRITERIA.has(criterion))) {
    throw new PlayerPickPolicyError("INVALID_PICK_POLICY", "CUSTOM_PRIORITY contains an unsupported criterion");
  }
  if (type === PLAYER_PICK_POLICIES.CUSTOM_PRIORITY && criteria.length === 0) {
    throw new PlayerPickPolicyError("INVALID_PICK_POLICY", "CUSTOM_PRIORITY requires at least one typed criterion");
  }

  return Object.freeze({
    type,
    criteria: [...criteria],
    preferredPlayerIds: strings(input.preferredPlayerIds, "preferredPlayerIds"),
    preferredResourceIds: strings(input.preferredResourceIds, "preferredResourceIds"),
    preferredCardTypes: strings(input.preferredCardTypes, "preferredCardTypes"),
    requiredSpecialTypes: strings(input.requiredSpecialTypes, "requiredSpecialTypes"),
  });
}

function normalizeOffer(offer, index) {
  if (offer == null || typeof offer !== "object" || Array.isArray(offer)) {
    throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", `Offer ${index} is invalid`);
  }
  const itemId = String(offer.itemId ?? offer.id ?? "");
  if (!itemId) throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", `Offer ${index} has no item ID`);
  const rating = Number(offer.rating);
  const value = offer.estimatedValue == null && offer.value == null
    ? null
    : Number(offer.estimatedValue ?? offer.value);
  return {
    ...offer,
    itemId,
    resourceId: String(offer.resourceId ?? ""),
    basePlayerId: String(offer.basePlayerId ?? offer.assetId ?? ""),
    name: offer.name == null ? null : String(offer.name),
    cardType: String(offer.cardType ?? ""),
    rarityName: String(offer.rarityName ?? offer.rarity ?? ""),
    specialGroups: Array.isArray(offer.specialGroups)
      ? offer.specialGroups.map(String)
      : [],
    isSpecial: offer.isSpecial === true,
    rating: Number.isFinite(rating) ? rating : null,
    estimatedValue: Number.isFinite(value) && value >= 0 ? value : null,
    isDuplicate: offer.isDuplicate === true,
  };
}

function paused(reason, offers, extra = {}) {
  return { status: "paused", reason, selectedItemId: null, offers, ...extra };
}

function uniqueBest(offers, score, reason) {
  const scored = offers.map((offer) => ({ offer, score: score(offer) }));
  if (scored.some((entry) => entry.score == null || Number.isNaN(entry.score))) {
    return paused("INSUFFICIENT_PICK_DATA", offers, { criterion: reason });
  }
  const best = Math.max(...scored.map((entry) => entry.score));
  const winners = scored.filter((entry) => entry.score === best).map((entry) => entry.offer);
  if (winners.length !== 1) return paused("AMBIGUOUS_PICK", offers, { criterion: reason, candidates: winners.map((o) => o.itemId) });
  return selected(winners[0], offers, reason);
}

function selected(offer, offers, reason) {
  return {
    status: "selected",
    reason,
    selectedItemId: offer.itemId,
    selected: offer,
    offers,
  };
}

function isRequiredSpecial(offer, policy, context) {
  const required = new Set([
    ...policy.requiredSpecialTypes,
    ...(Array.isArray(context?.requiredSpecialTypes) ? context.requiredSpecialTypes.map(String) : []),
  ].map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  return [offer.cardType, offer.rarityName, ...(offer.specialGroups || [])]
    .map((value) => String(value).trim().toLowerCase())
    .some((value) => required.has(value));
}

function criterionScore(criterion, offer, policy, context) {
  switch (criterion) {
    case "REQUIRED_SPECIAL": return isRequiredSpecial(offer, policy, context) ? 1 : 0;
    case "NON_DUPLICATE": return offer.isDuplicate ? 0 : 1;
    case "PREFERRED_PLAYER": return policy.preferredPlayerIds.includes(offer.basePlayerId) ? 1 : 0;
    case "PREFERRED_RESOURCE": return policy.preferredResourceIds.includes(offer.resourceId) ? 1 : 0;
    case "PREFERRED_CARD_TYPE": return policy.preferredCardTypes.includes(offer.cardType) ? 1 : 0;
    case "RATING": return offer.rating;
    case "VALUE": return offer.estimatedValue;
    default: return null;
  }
}

function compareTuples(left, right) {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/** Returns a decision; it never silently breaks a tie. */
export function decidePlayerPick(rawOffers, rawPolicy = {}, context = {}) {
  if (!Array.isArray(rawOffers) || rawOffers.length === 0) {
    throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", "At least one player-pick offer is required");
  }
  const existingResourceIds = new Set(
    (context?.existingResourceIds || []).map(String),
  );
  const duplicateResourceIds = new Set(
    (context?.duplicateResourceIds || []).map(String),
  );
  const duplicateItemIds = new Set((context?.duplicateItemIds || []).map(String));
  const offers = rawOffers.map(normalizeOffer).map((offer) => ({
    ...offer,
    isDuplicate:
      offer.isDuplicate ||
      duplicateItemIds.has(offer.itemId) ||
      (offer.resourceId &&
        (existingResourceIds.has(offer.resourceId) ||
          duplicateResourceIds.has(offer.resourceId))),
  }));
  if (new Set(offers.map((offer) => offer.itemId)).size !== offers.length) {
    throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", "Player-pick item IDs must be unique");
  }
  const policy = normalizePlayerPickPolicy(rawPolicy);

  switch (policy.type) {
    case PLAYER_PICK_POLICIES.PAUSE_FOR_USER:
      return paused("USER_SELECTION_REQUIRED", offers);
    case PLAYER_PICK_POLICIES.HIGHEST_RATING:
      return uniqueBest(offers, (offer) => offer.rating, "HIGHEST_RATING");
    case PLAYER_PICK_POLICIES.HIGHEST_VALUE:
      return uniqueBest(offers, (offer) => offer.estimatedValue, "HIGHEST_VALUE");
    case PLAYER_PICK_POLICIES.PREFER_NON_DUPLICATE: {
      const candidates = offers.filter((offer) => !offer.isDuplicate);
      if (candidates.length === 1) return selected(candidates[0], offers, "PREFER_NON_DUPLICATE");
      return paused(candidates.length ? "AMBIGUOUS_PICK" : "NO_NON_DUPLICATE_OPTION", offers, {
        candidates: candidates.map((offer) => offer.itemId),
      });
    }
    case PLAYER_PICK_POLICIES.PREFER_REQUIRED_SPECIAL: {
      const candidates = offers.filter((offer) => isRequiredSpecial(offer, policy, context));
      if (candidates.length === 1) return selected(candidates[0], offers, "PREFER_REQUIRED_SPECIAL");
      return paused(candidates.length ? "AMBIGUOUS_PICK" : "NO_REQUIRED_SPECIAL_OPTION", offers, {
        candidates: candidates.map((offer) => offer.itemId),
      });
    }
    case PLAYER_PICK_POLICIES.CUSTOM_PRIORITY: {
      const ranked = offers.map((offer) => ({
        offer,
        tuple: policy.criteria.map((criterion) => criterionScore(criterion, offer, policy, context)),
      }));
      if (ranked.some((entry) => entry.tuple.some((value) => value == null || Number.isNaN(value)))) {
        return paused("INSUFFICIENT_PICK_DATA", offers);
      }
      ranked.sort((a, b) => compareTuples(b.tuple, a.tuple));
      if (ranked.length > 1 && compareTuples(ranked[0].tuple, ranked[1].tuple) === 0) {
        return paused("AMBIGUOUS_PICK", offers, { candidates: ranked.filter((entry) => compareTuples(entry.tuple, ranked[0].tuple) === 0).map((entry) => entry.offer.itemId) });
      }
      return selected(ranked[0].offer, offers, "CUSTOM_PRIORITY");
    }
    default:
      return paused("USER_SELECTION_REQUIRED", offers);
  }
}
