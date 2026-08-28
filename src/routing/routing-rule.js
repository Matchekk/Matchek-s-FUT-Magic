export const RoutingDestination = Object.freeze({
  CLUB: "CLUB",
  SBC_STORAGE: "SBC_STORAGE",
  TRANSFER_LIST: "TRANSFER_LIST",
  ACTIVE_RECIPE: "ACTIVE_RECIPE",
  KEEP_UNASSIGNED: "KEEP_UNASSIGNED",
  ASK_USER: "ASK_USER",
});

export const RoutingEffect = Object.freeze({
  PRESERVE: "preserve",
  CONSUME: "consume",
  MANUAL: "manual",
});

export const RoutingTradeability = Object.freeze({
  TRADEABLE: "tradeable",
  UNTRADEABLE: "untradeable",
  UNKNOWN: "unknown",
});

const DESTINATIONS = new Set(Object.values(RoutingDestination));
const CRITERIA_KEYS = new Set([
  "locations", "duplicate", "tradeability", "minRating", "maxRating",
  "rarities", "cardTypes", "itemTypes",
]);
const RULE_KEYS = new Set(["id", "priority", "destination", "criteria", "enabled"]);

const exactKeys = (value, allowed, path) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
};

const stringList = (value, field) => {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  return Object.freeze([...new Set(value.map((entry) => entry.trim()))].sort());
};

export function normalizeRoutingRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Routing rule must be an object");
  }
  exactKeys(input, RULE_KEYS, "$routingRule");
  if (typeof input.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.id)) {
    throw new TypeError("Routing rule id must be a safe identifier");
  }
  if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 10_000) {
    throw new TypeError("Routing rule priority must be an integer from 0 to 10000");
  }
  if (!DESTINATIONS.has(input.destination)) {
    throw new TypeError(`Unsupported routing destination: ${String(input.destination)}`);
  }
  const rawCriteria = input.criteria ?? {};
  if (!rawCriteria || typeof rawCriteria !== "object" || Array.isArray(rawCriteria)) {
    throw new TypeError("Routing rule criteria must be an object");
  }
  exactKeys(rawCriteria, CRITERIA_KEYS, "$routingRule.criteria");
  const number = (value, field) => {
    if (value == null) return null;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new TypeError(`${field} must be between 0 and 100`);
    }
    return Number(value);
  };
  const criteria = Object.freeze({
    locations: stringList(rawCriteria.locations, "criteria.locations"),
    duplicate: rawCriteria.duplicate == null ? null : Boolean(rawCriteria.duplicate),
    tradeability: rawCriteria.tradeability == null
      ? null
      : String(rawCriteria.tradeability).toLowerCase(),
    minRating: number(rawCriteria.minRating, "criteria.minRating"),
    maxRating: number(rawCriteria.maxRating, "criteria.maxRating"),
    rarities: stringList(rawCriteria.rarities, "criteria.rarities"),
    cardTypes: stringList(rawCriteria.cardTypes, "criteria.cardTypes"),
    itemTypes: stringList(rawCriteria.itemTypes, "criteria.itemTypes"),
  });
  if (
    criteria.tradeability != null &&
    !Object.values(RoutingTradeability).includes(criteria.tradeability)
  ) {
    throw new TypeError("criteria.tradeability is unsupported");
  }
  if (criteria.minRating != null && criteria.maxRating != null && criteria.minRating > criteria.maxRating) {
    throw new TypeError("criteria.minRating cannot exceed maxRating");
  }
  return Object.freeze({
    id: input.id,
    priority: input.priority,
    destination: input.destination,
    criteria,
    enabled: input.enabled !== false,
  });
}

export function routingRuleMatches(rule, context) {
  const { criteria } = rule;
  const includes = (list, value) => list.length === 0 || list.includes(String(value ?? ""));
  if (!includes(criteria.locations, context.location)) return false;
  if (criteria.duplicate != null && criteria.duplicate !== context.duplicate) return false;
  if (criteria.tradeability != null && criteria.tradeability !== context.tradeability) return false;
  if (criteria.minRating != null && context.rating < criteria.minRating) return false;
  if (criteria.maxRating != null && context.rating > criteria.maxRating) return false;
  if (!includes(criteria.rarities, context.rarity)) return false;
  if (!includes(criteria.cardTypes, context.cardType)) return false;
  if (!includes(criteria.itemTypes, context.itemType)) return false;
  return true;
}
