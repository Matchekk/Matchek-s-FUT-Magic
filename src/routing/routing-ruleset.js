import { normalizeRoutingRule } from "./routing-rule.js";

export const ROUTING_RULESET_SCHEMA_VERSION = 1;
export const ROUTING_LIMITS = Object.freeze({ maxRules: 100, maxItems: 5000 });

export function normalizeRoutingRuleset(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Routing ruleset must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!["schemaVersion", "id", "rules"].includes(key)) {
      throw new TypeError(`Unsupported routing ruleset field: ${key}`);
    }
  }
  if ((input.schemaVersion ?? ROUTING_RULESET_SCHEMA_VERSION) !== ROUTING_RULESET_SCHEMA_VERSION) {
    throw new TypeError("Unsupported routing ruleset schema version");
  }
  if (typeof input.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.id)) {
    throw new TypeError("Routing ruleset id must be a safe identifier");
  }
  if (!Array.isArray(input.rules) || input.rules.length > ROUTING_LIMITS.maxRules) {
    throw new TypeError(`Routing ruleset supports at most ${ROUTING_LIMITS.maxRules} rules`);
  }
  const rules = input.rules.map(normalizeRoutingRule);
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new TypeError(`Duplicate routing rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  rules.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return Object.freeze({
    schemaVersion: ROUTING_RULESET_SCHEMA_VERSION,
    id: input.id,
    rules: Object.freeze(rules),
  });
}
