import { cloneAndFreeze, stableFingerprint } from "./immutable.js";

export const GoalKind = Object.freeze({
  COMPLETE_SBC: "complete_sbc",
  GRIND_UPGRADES: "grind_upgrades",
  CLEAR_DUPLICATES: "clear_duplicates",
  OPTIMIZE_FODDER: "optimize_fodder",
  PLAN_EVOLUTION: "plan_evolution",
  OPTIMIZE_CLUB: "optimize_club",
});

export const createGoal = ({ kind, intent, inputs = {}, createdAt = Date.now() }) => {
  if (!Object.values(GoalKind).includes(kind)) throw new TypeError(`Unknown goal kind: ${kind}`);
  const normalized = { kind, intent: String(intent || kind), inputs, createdAt: Math.max(0, Number(createdAt) || 0) };
  return cloneAndFreeze({ id: stableFingerprint(normalized), ...normalized });
};
