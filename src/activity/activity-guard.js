import { ActivityOutcome, ActivityWindow } from "./activity-ledger.js";

export const ActivityGuardState = Object.freeze({
  NORMAL: "NORMAL",
  ELEVATED: "ELEVATED",
  CAUTION: "CAUTION",
  PAUSED: "PAUSED",
  RECOVERY: "RECOVERY",
});

export function evaluateActivityGuard({
  ledger,
  activityContext,
  now = Date.now(),
  recoveryRequired = false,
  circuitOpen = false,
} = {}) {
  if (recoveryRequired) return Object.freeze({ state: ActivityGuardState.RECOVERY, reason: "RECOVERY_REQUIRED" });
  if (circuitOpen) return Object.freeze({ state: ActivityGuardState.PAUSED, reason: "FAILURE_STREAK" });
  if (!ledger || !activityContext?.personaKey || !activityContext?.gameVersion || !activityContext?.sessionId) {
    return Object.freeze({ state: ActivityGuardState.CAUTION, reason: "ACTIVITY_EVIDENCE_UNAVAILABLE" });
  }
  const fiveMinutes = ledger.query({ ...activityContext, windowMs: ActivityWindow.FIVE_MINUTES, now });
  if (!fiveMinutes.complete) {
    return Object.freeze({ state: ActivityGuardState.CAUTION, reason: "ACTIVITY_WINDOW_INCOMPLETE" });
  }
  const latest = fiveMinutes.events.at(-1) ?? null;
  if (latest && [ActivityOutcome.AMBIGUOUS, ActivityOutcome.TERMINAL_FAILURE].includes(latest.outcome)) {
    return Object.freeze({ state: ActivityGuardState.CAUTION, reason: "EA_RESPONSE_HEALTH" });
  }
  if (fiveMinutes.failures > 0) {
    return Object.freeze({ state: ActivityGuardState.CAUTION, reason: "RECENT_CLASSIFIED_FAILURE" });
  }
  const oneMinute = ledger.query({ ...activityContext, windowMs: ActivityWindow.ONE_MINUTE, now });
  if (oneMinute.total > 0) {
    return Object.freeze({ state: ActivityGuardState.ELEVATED, reason: "RECENT_ACTIVITY", lastEventAt: oneMinute.events.at(-1).timestamp });
  }
  return Object.freeze({ state: ActivityGuardState.NORMAL, reason: "CURRENT_EVIDENCE_QUIET" });
}
