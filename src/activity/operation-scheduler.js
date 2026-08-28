import { ActivityGuardState, evaluateActivityGuard } from "./activity-guard.js";
import { ActivityOutcome } from "./activity-ledger.js";

export const SchedulerDecision = Object.freeze({
  ALLOW: "ALLOW",
  WAIT_UNTIL: "WAIT_UNTIL",
  PAUSE: "PAUSE",
});

const operationFamily = (stepType) => String(stepType ?? "UNKNOWN").toUpperCase();

export class OperationScheduler {
  constructor({
    ledger,
    activityContextProvider,
    clock = () => Date.now(),
    idFactory = () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    failureThreshold = 3,
    minimumSpacingMs = 0,
    persistSnapshot = null,
  } = {}) {
    if (!ledger?.append || !ledger?.consecutiveFailures) throw new TypeError("OperationScheduler requires an ActivityLedger");
    if (typeof activityContextProvider !== "function") throw new TypeError("OperationScheduler requires an activity context provider");
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1 || failureThreshold > 10) {
      throw new TypeError("failureThreshold must be between 1 and 10");
    }
    this.ledger = ledger;
    this.activityContextProvider = activityContextProvider;
    this.clock = clock;
    this.idFactory = idFactory;
    this.failureThreshold = failureThreshold;
    this.minimumSpacingMs = Math.max(0, Math.min(60_000, Number(minimumSpacingMs) || 0));
    if (persistSnapshot != null && typeof persistSnapshot !== "function") {
      throw new TypeError("persistSnapshot must be a function");
    }
    this.persistSnapshot = persistSnapshot;
  }

  #context() {
    const context = this.activityContextProvider();
    return {
      personaKey: String(context?.personaKey ?? ""),
      gameVersion: String(context?.gameVersion ?? ""),
      sessionId: String(context?.sessionId ?? ""),
    };
  }

  currentGuard({ stepType = "UNKNOWN", recoveryRequired = false } = {}) {
    const context = this.#context();
    const circuitOpen = context.personaKey && context.gameVersion && context.sessionId
      ? this.ledger.consecutiveFailures({
          ...context,
          operationFamily: operationFamily(stepType),
        }) >= this.failureThreshold
      : false;
    return evaluateActivityGuard({
      ledger: this.ledger,
      activityContext: context,
      now: this.clock(),
      recoveryRequired,
      circuitOpen,
    });
  }

  async preflight({ node, run } = {}) {
    const recoveryRequired = run?.status === "recovery_required";
    const guard = this.currentGuard({ stepType: node?.step?.type, recoveryRequired });
    if (
      guard.state === ActivityGuardState.RECOVERY ||
      guard.state === ActivityGuardState.PAUSED ||
      (guard.state === ActivityGuardState.CAUTION && guard.reason !== "RECENT_CLASSIFIED_FAILURE")
    ) {
      return Object.freeze({ decision: SchedulerDecision.PAUSE, code: guard.reason, guard });
    }
    if (
      guard.state === ActivityGuardState.ELEVATED && this.minimumSpacingMs > 0 &&
      Number.isSafeInteger(guard.lastEventAt) && guard.lastEventAt + this.minimumSpacingMs > this.clock()
    ) {
      return Object.freeze({
        decision: SchedulerDecision.WAIT_UNTIL,
        waitUntil: guard.lastEventAt + this.minimumSpacingMs,
        code: "ACTIVITY_SPACING",
        guard,
      });
    }
    return Object.freeze({ decision: SchedulerDecision.ALLOW, guard });
  }

  async recordSuccess({ node }) {
    return this.#record(node, ActivityOutcome.VERIFIED, null);
  }

  async recordNotApplied({ node }) {
    return this.#record(node, ActivityOutcome.NOT_APPLIED, null);
  }

  async recordFailure({ node, error, ambiguous = false }) {
    const outcome = ambiguous
      ? ActivityOutcome.AMBIGUOUS
      : error?.safeToRetry === true
        ? ActivityOutcome.TRANSIENT_FAILURE
        : ActivityOutcome.TERMINAL_FAILURE;
    return this.#record(node, outcome, String(error?.code ?? "UNCLASSIFIED_FAILURE"));
  }

  async recordOutcome({ node, outcome, code = null } = {}) {
    if (!Object.values(ActivityOutcome).includes(outcome)) {
      throw new TypeError("Operation outcome is unsupported");
    }
    const failureClass = [
      ActivityOutcome.TRANSIENT_FAILURE,
      ActivityOutcome.TERMINAL_FAILURE,
      ActivityOutcome.AMBIGUOUS,
    ].includes(outcome)
      ? String(code ?? "UNCLASSIFIED_FAILURE")
      : null;
    return this.#record(node, outcome, failureClass);
  }

  async #record(node, outcome, failureClass) {
    const context = this.#context();
    const event = this.ledger.append({
      eventId: String(this.idFactory()),
      timestamp: Number(this.clock()),
      ...context,
      operationFamily: operationFamily(node?.step?.type),
      outcome,
      failureClass,
    });
    if (this.persistSnapshot) await this.persistSnapshot(this.ledger.snapshot());
    return event;
  }
}
