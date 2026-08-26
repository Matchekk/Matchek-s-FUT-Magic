import { cloneAndFreeze, stableFingerprint } from "./immutable.js";

export const PlanState = Object.freeze({ READY: "ready", BLOCKED: "blocked" });

export const createPlan = ({
  goal,
  gameContext,
  steps = [],
  blockers = [],
  explanation = [],
  fingerprints = null,
  preview = null,
  strategy = null,
  compilerVersion = 1,
  createdAt = Date.now(),
}) => {
  if (!goal?.id) throw new TypeError("Plan requires a goal");
  if (!gameContext?.gameVersion) throw new TypeError("Plan requires a game context");
  const state = blockers.length ? PlanState.BLOCKED : PlanState.READY;
  const body = {
    goalId: goal.id,
    gameContext,
    state,
    steps,
    blockers,
    explanation,
    fingerprints,
    preview,
    strategy,
    compilerVersion,
  };
  return cloneAndFreeze({
    id: stableFingerprint(body),
    createdAt: Math.max(0, Number(createdAt) || 0),
    ...body,
  });
};
