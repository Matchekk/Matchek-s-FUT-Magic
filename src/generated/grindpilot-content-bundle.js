"use strict";
(() => {
  // src/core/activity-logger.js
  var REDACTED = "[REDACTED]";
  var CIRCULAR = "[Circular]";
  var TRUNCATED = "[Truncated]";
  var OMITTED_ACCESSOR = "[Accessor omitted]";
  var UNREADABLE = "[Unreadable object]";
  var LEVELS = /* @__PURE__ */ new Set(["debug", "info", "warn", "error"]);
  var normalizeSecretKey = (key) => String(key).normalize("NFKC").replace(/[^a-z0-9]/gi, "").toLowerCase();
  var SECRET_KEYS = /* @__PURE__ */ new Set([
    "authorization",
    "proxyauthorization",
    "cookie",
    "setcookie",
    "password",
    "passwd",
    "passphrase",
    "secret",
    "clientsecret",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "token",
    "sessionid",
    "sessiontoken",
    "xutsid",
    "sid",
    "credential",
    "credentials"
  ]);
  var isSecretKey = (key) => {
    const normalized = normalizeSecretKey(key);
    return SECRET_KEYS.has(normalized) || normalized.endsWith("accesstoken") || normalized.endsWith("refreshtoken") || normalized.endsWith("sessiontoken") || normalized.endsWith("token") || normalized.endsWith("apikey") || normalized.endsWith("apisecret");
  };
  var redactString = (value, maxLength = 4096) => {
    const redacted = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`).replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`).replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
      REDACTED
    ).replace(
      /([?&](?:access_token|refresh_token|id_token|token|session|session_id|sid|x-ut-sid|api_key|code|password|secret)=)[^&#\s]*/gi,
      `$1${encodeURIComponent(REDACTED)}`
    ).replace(
      /\b((?:access_token|refresh_token|id_token|token|session|session_id|sid|x-ut-sid|api_key|password|secret|cookie)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`
    );
    return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…${TRUNCATED}` : redacted;
  };
  var redactSecrets = (value, {
    maxDepth = 12,
    maxArrayLength = 100,
    maxObjectKeys = 100,
    maxNodes = 2e3,
    maxStringLength = 4096
  } = {}) => {
    const seen = /* @__PURE__ */ new WeakSet();
    let visitedNodes = 0;
    const visit = (current, depth, key = null) => {
      visitedNodes += 1;
      if (visitedNodes > maxNodes) return TRUNCATED;
      if (key != null && isSecretKey(key)) return REDACTED;
      if (current == null || typeof current === "boolean" || typeof current === "number") {
        return current;
      }
      if (typeof current === "string") return redactString(current, maxStringLength);
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function" || typeof current === "symbol") {
        return `[${typeof current}]`;
      }
      if (depth >= maxDepth) return TRUNCATED;
      if (current instanceof Date) {
        return Number.isNaN(current.getTime()) ? "Invalid Date" : current.toISOString();
      }
      if (current instanceof Error) {
        return {
          name: current.name,
          message: redactString(current.message),
          ...typeof current.code === "string" ? { code: current.code } : {}
        };
      }
      if (seen.has(current)) return CIRCULAR;
      seen.add(current);
      if (Array.isArray(current)) {
        let descriptors2;
        try {
          descriptors2 = Object.getOwnPropertyDescriptors(current);
        } catch {
          return UNREADABLE;
        }
        const currentLength = Number.isSafeInteger(descriptors2.length?.value) ? descriptors2.length.value : 0;
        const result2 = [];
        for (let index = 0; index < Math.min(currentLength, Math.max(0, maxArrayLength)); index += 1) {
          const descriptor = descriptors2[index];
          if (!descriptor) continue;
          result2.push(
            "value" in descriptor ? visit(descriptor.value, depth + 1) : OMITTED_ACCESSOR
          );
        }
        if (currentLength > maxArrayLength) result2.push(TRUNCATED);
        return result2;
      }
      if (current instanceof Map) {
        return visit(Object.fromEntries(current), depth + 1);
      }
      if (current instanceof Set) {
        return visit([...current], depth + 1);
      }
      const result = {};
      let descriptors;
      try {
        descriptors = Object.getOwnPropertyDescriptors(current);
      } catch {
        return UNREADABLE;
      }
      const entries = Object.entries(descriptors);
      for (const [entryKey, descriptor] of entries.slice(0, Math.max(0, maxObjectKeys))) {
        result[entryKey] = "value" in descriptor ? visit(descriptor.value, depth + 1, entryKey) : isSecretKey(entryKey) ? REDACTED : OMITTED_ACCESSOR;
      }
      if (entries.length > maxObjectKeys) result.__truncated__ = TRUNCATED;
      return result;
    };
    try {
      return visit(value, 0);
    } catch {
      return UNREADABLE;
    }
  };
  var cloneLogValue = (value) => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };
  var ActivityLogger = class {
    #clock;
    #sequence;
    #buffer;
    #subscribers;
    /**
     * @param {{maxEntries?: number, clock?: () => Date | string | number}} [options]
     */
    constructor({ maxEntries = 500, clock = () => /* @__PURE__ */ new Date() } = {}) {
      if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 5e3) {
        throw new RangeError("maxEntries must be an integer between 1 and 5000");
      }
      if (typeof clock !== "function") throw new TypeError("clock must be a function");
      this.maxEntries = maxEntries;
      this.#clock = clock;
      this.#sequence = 0;
      this.#buffer = [];
      this.#subscribers = /* @__PURE__ */ new Set();
    }
    /**
     * @param {'debug'|'info'|'warn'|'error'} level
     * @param {string} action
     * @param {string} message
     * @param {unknown} [data]
     */
    log(level, action, message, data = null) {
      if (!LEVELS.has(level)) throw new TypeError(`Unsupported log level: ${level}`);
      if (typeof action !== "string" || !action.trim()) {
        throw new TypeError("Log action must be a non-empty string");
      }
      if (typeof message !== "string") throw new TypeError("Log message must be a string");
      const instant = new Date(this.#clock());
      if (Number.isNaN(instant.getTime())) throw new TypeError("clock returned an invalid date");
      const entry = Object.freeze({
        id: ++this.#sequence,
        timestamp: instant.toISOString(),
        level,
        action: redactString(action),
        message: redactString(message),
        data: redactSecrets(data)
      });
      this.#buffer.push(entry);
      if (this.#buffer.length > this.maxEntries) {
        this.#buffer.splice(0, this.#buffer.length - this.maxEntries);
      }
      const failures = [];
      for (const subscriber of [...this.#subscribers]) {
        try {
          subscriber(cloneLogValue(entry));
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Multiple activity-log subscribers failed");
      }
      return cloneLogValue(entry);
    }
    debug(action, message, data) {
      return this.log("debug", action, message, data);
    }
    info(action, message, data) {
      return this.log("info", action, message, data);
    }
    warn(action, message, data) {
      return this.log("warn", action, message, data);
    }
    error(action, message, data) {
      return this.log("error", action, message, data);
    }
    /**
     * @param {{level?: string, action?: string, limit?: number}} [filter]
     */
    entries({ level, action, limit } = {}) {
      let result = this.#buffer;
      if (level != null) result = result.filter((entry) => entry.level === level);
      if (action != null) result = result.filter((entry) => entry.action === action);
      if (limit != null) {
        if (!Number.isInteger(limit) || limit < 0) {
          throw new RangeError("Log limit must be a non-negative integer");
        }
        result = result.slice(Math.max(0, result.length - limit));
      }
      return cloneLogValue(result);
    }
    clear() {
      this.#buffer.length = 0;
    }
    /** @param {(entry: object) => void} subscriber */
    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        throw new TypeError("Log subscriber must be a function");
      }
      this.#subscribers.add(subscriber);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        this.#subscribers.delete(subscriber);
      };
    }
    export() {
      return { version: 1, entries: this.entries() };
    }
  };

  // src/activity/activity-ledger.js
  var ActivityOutcome = Object.freeze({
    VERIFIED: "verified",
    NOT_APPLIED: "not_applied",
    TRANSIENT_FAILURE: "transient_failure",
    TERMINAL_FAILURE: "terminal_failure",
    AMBIGUOUS: "ambiguous"
  });
  var ActivityWindow = Object.freeze({
    ONE_MINUTE: 6e4,
    FIVE_MINUTES: 5 * 6e4,
    FIFTEEN_MINUTES: 15 * 6e4,
    ONE_HOUR: 60 * 6e4,
    ONE_DAY: 24 * 60 * 6e4
  });
  var OUTCOMES = new Set(Object.values(ActivityOutcome));
  var safeToken = (value, field) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
      throw new TypeError(`${field} must be a safe non-empty token`);
    }
    return value;
  };
  var normalizeEvent = (event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError("Activity event must be an object");
    }
    const timestamp = Number(event.timestamp);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Activity timestamp is invalid");
    const outcome2 = String(event.outcome);
    if (!OUTCOMES.has(outcome2)) throw new TypeError("Activity outcome is unsupported");
    return Object.freeze({
      eventId: safeToken(event.eventId, "eventId"),
      timestamp,
      personaKey: safeToken(event.personaKey, "personaKey"),
      gameVersion: safeToken(event.gameVersion, "gameVersion"),
      sessionId: safeToken(event.sessionId, "sessionId"),
      operationFamily: safeToken(event.operationFamily, "operationFamily"),
      outcome: outcome2,
      failureClass: event.failureClass == null ? null : safeToken(event.failureClass, "failureClass")
    });
  };
  var ActivityLedger = class {
    #events = [];
    #prunedBefore = null;
    constructor({ maxEvents = 5e3, clock = () => Date.now(), snapshot = null } = {}) {
      if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 2e4) {
        throw new TypeError("maxEvents must be between 1 and 20000");
      }
      if (typeof clock !== "function") throw new TypeError("clock must be a function");
      this.maxEvents = maxEvents;
      this.clock = clock;
      if (snapshot) this.restore(snapshot);
    }
    restore(snapshot) {
      if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.events)) {
        throw new TypeError("Activity ledger snapshot is invalid");
      }
      const events = snapshot.events.map(normalizeEvent).sort((left, right) => left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId));
      const ids = /* @__PURE__ */ new Set();
      for (const event of events) {
        if (ids.has(event.eventId)) throw new TypeError("Activity ledger event IDs must be unique");
        ids.add(event.eventId);
      }
      this.#events = events.slice(-this.maxEvents);
      this.#prunedBefore = snapshot.prunedBefore == null ? null : Number(snapshot.prunedBefore);
      if (events.length > this.maxEvents) {
        this.#prunedBefore = events[events.length - this.maxEvents - 1].timestamp;
      }
    }
    append(input) {
      const event = normalizeEvent(input);
      const now = Number(this.clock());
      if (!Number.isSafeInteger(now) || now < 0 || event.timestamp > now + 6e4) {
        throw new TypeError("Activity event time is unavailable or future-dated");
      }
      if (this.#events.some(({ eventId }) => eventId === event.eventId)) {
        throw new TypeError("Activity event ID already exists");
      }
      this.#events.push(event);
      this.#events.sort((left, right) => left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId));
      if (this.#events.length > this.maxEvents) {
        const removed = this.#events.splice(0, this.#events.length - this.maxEvents);
        this.#prunedBefore = removed.at(-1)?.timestamp ?? this.#prunedBefore;
      }
      return Object.freeze({ ...event });
    }
    query({ personaKey, gameVersion, sessionId = null, windowMs, now = this.clock() } = {}) {
      const persona = safeToken(personaKey, "personaKey");
      const game = safeToken(gameVersion, "gameVersion");
      const session = sessionId == null ? null : safeToken(sessionId, "sessionId");
      const current = Number(now);
      if (!Number.isSafeInteger(current) || current < 0) throw new TypeError("Activity query time is invalid");
      if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > ActivityWindow.ONE_DAY) {
        throw new TypeError("Activity window is invalid");
      }
      const from = current - windowMs;
      const events = this.#events.filter(
        (event) => event.personaKey === persona && event.gameVersion === game && (session == null || event.sessionId === session) && event.timestamp > from && event.timestamp <= current
      );
      const complete = this.#prunedBefore == null || this.#prunedBefore <= from;
      return Object.freeze({
        from,
        to: current,
        complete,
        total: events.length,
        verified: events.filter(({ outcome: outcome2 }) => outcome2 === ActivityOutcome.VERIFIED).length,
        failures: events.filter(({ outcome: outcome2 }) => [
          ActivityOutcome.TRANSIENT_FAILURE,
          ActivityOutcome.TERMINAL_FAILURE,
          ActivityOutcome.AMBIGUOUS
        ].includes(outcome2)).length,
        events: Object.freeze(events.map((event) => Object.freeze({ ...event })))
      });
    }
    consecutiveFailures({ personaKey, gameVersion, sessionId, operationFamily: operationFamily2 }) {
      const matching = this.#events.filter(
        (event) => event.personaKey === personaKey && event.gameVersion === gameVersion && event.sessionId === sessionId && event.operationFamily === operationFamily2
      );
      let count = 0;
      for (let index = matching.length - 1; index >= 0; index -= 1) {
        const outcome2 = matching[index].outcome;
        if (outcome2 === ActivityOutcome.VERIFIED) break;
        if ([ActivityOutcome.TRANSIENT_FAILURE, ActivityOutcome.TERMINAL_FAILURE, ActivityOutcome.AMBIGUOUS].includes(outcome2)) {
          count += 1;
        }
      }
      return count;
    }
    snapshot() {
      return Object.freeze({
        schemaVersion: 1,
        prunedBefore: this.#prunedBefore,
        events: Object.freeze(this.#events.map((event) => Object.freeze({ ...event })))
      });
    }
    publicSummary({ personaKey, gameVersion, sessionId, now = this.clock() }) {
      const windows = Object.fromEntries(Object.entries(ActivityWindow).map(([key, windowMs]) => [
        key,
        this.query({ personaKey, gameVersion, sessionId, windowMs, now }).total
      ]));
      return Object.freeze({ schemaVersion: 1, windows: Object.freeze(windows) });
    }
  };

  // src/activity/activity-guard.js
  var ActivityGuardState = Object.freeze({
    NORMAL: "NORMAL",
    ELEVATED: "ELEVATED",
    CAUTION: "CAUTION",
    PAUSED: "PAUSED",
    RECOVERY: "RECOVERY"
  });
  function evaluateActivityGuard({
    ledger,
    activityContext,
    now = Date.now(),
    recoveryRequired = false,
    circuitOpen = false
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

  // src/activity/operation-scheduler.js
  var SchedulerDecision = Object.freeze({
    ALLOW: "ALLOW",
    WAIT_UNTIL: "WAIT_UNTIL",
    PAUSE: "PAUSE"
  });
  var operationFamily = (stepType) => String(stepType ?? "UNKNOWN").toUpperCase();
  var OperationScheduler = class {
    constructor({
      ledger,
      activityContextProvider,
      clock = () => Date.now(),
      idFactory = () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      failureThreshold = 3,
      minimumSpacingMs = 0,
      persistSnapshot = null
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
      this.minimumSpacingMs = Math.max(0, Math.min(6e4, Number(minimumSpacingMs) || 0));
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
        sessionId: String(context?.sessionId ?? "")
      };
    }
    currentGuard({ stepType = "UNKNOWN", recoveryRequired = false } = {}) {
      const context = this.#context();
      const circuitOpen = context.personaKey && context.gameVersion && context.sessionId ? this.ledger.consecutiveFailures({
        ...context,
        operationFamily: operationFamily(stepType)
      }) >= this.failureThreshold : false;
      return evaluateActivityGuard({
        ledger: this.ledger,
        activityContext: context,
        now: this.clock(),
        recoveryRequired,
        circuitOpen
      });
    }
    async preflight({ node, run } = {}) {
      const recoveryRequired = run?.status === "recovery_required";
      const guard = this.currentGuard({ stepType: node?.step?.type, recoveryRequired });
      if (guard.state === ActivityGuardState.RECOVERY || guard.state === ActivityGuardState.PAUSED || guard.state === ActivityGuardState.CAUTION && guard.reason !== "RECENT_CLASSIFIED_FAILURE") {
        return Object.freeze({ decision: SchedulerDecision.PAUSE, code: guard.reason, guard });
      }
      if (guard.state === ActivityGuardState.ELEVATED && this.minimumSpacingMs > 0 && Number.isSafeInteger(guard.lastEventAt) && guard.lastEventAt + this.minimumSpacingMs > this.clock()) {
        return Object.freeze({
          decision: SchedulerDecision.WAIT_UNTIL,
          waitUntil: guard.lastEventAt + this.minimumSpacingMs,
          code: "ACTIVITY_SPACING",
          guard
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
      const outcome2 = ambiguous ? ActivityOutcome.AMBIGUOUS : error?.safeToRetry === true ? ActivityOutcome.TRANSIENT_FAILURE : ActivityOutcome.TERMINAL_FAILURE;
      return this.#record(node, outcome2, String(error?.code ?? "UNCLASSIFIED_FAILURE"));
    }
    async recordOutcome({ node, outcome: outcome2, code = null } = {}) {
      if (!Object.values(ActivityOutcome).includes(outcome2)) {
        throw new TypeError("Operation outcome is unsupported");
      }
      const failureClass = [
        ActivityOutcome.TRANSIENT_FAILURE,
        ActivityOutcome.TERMINAL_FAILURE,
        ActivityOutcome.AMBIGUOUS
      ].includes(outcome2) ? String(code ?? "UNCLASSIFIED_FAILURE") : null;
      return this.#record(node, outcome2, failureClass);
    }
    async #record(node, outcome2, failureClass) {
      const context = this.#context();
      const event = this.ledger.append({
        eventId: String(this.idFactory()),
        timestamp: Number(this.clock()),
        ...context,
        operationFamily: operationFamily(node?.step?.type),
        outcome: outcome2,
        failureClass
      });
      if (this.persistSnapshot) await this.persistSnapshot(this.ledger.snapshot());
      return event;
    }
  };

  // src/analytics/run-analytics.js
  var STEP = Object.freeze({
    SOLVE: "SOLVE_SBC",
    SUBMIT: "SUBMIT_SBC",
    CLAIM: "CLAIM_REWARD",
    OPEN: "OPEN_REWARD_PACK",
    PICK: "HANDLE_PLAYER_PICK",
    RESOLVE: "RESOLVE_ITEMS"
  });
  var completed = (nodes, type) => nodes.filter((node) => node?.step?.type === type && node?.status === "completed");
  var ratingFlow = (entries, field) => {
    const counts = {};
    let cards = 0;
    let ratingPoints = 0;
    for (const entry of entries) {
      for (const item of entry?.result?.[field] ?? []) {
        const rating = Math.max(0, Math.trunc(Number(item?.rating) || 0));
        if (!rating) continue;
        counts[rating] = (counts[rating] || 0) + 1;
        cards += 1;
        ratingPoints += rating;
      }
    }
    return { cards, ratingPoints, byRating: counts };
  };
  function summarizeRunAnalytics(run, { now = Date.now() } = {}) {
    const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
    const solves = completed(nodes, STEP.SOLVE);
    const submissions = completed(nodes, STEP.SUBMIT);
    const packs = completed(nodes, STEP.OPEN);
    const picks = completed(nodes, STEP.PICK);
    const resolutions = completed(nodes, STEP.RESOLVE);
    const startedAt = Number(run?.startedAt ?? 0) || null;
    const endedAt = Number(run?.completedAt ?? run?.stoppedAt ?? 0) || null;
    const durationEnd = endedAt ?? (startedAt ? Number(now) : null);
    const events = Array.isArray(run?.history) ? run.history : Array.isArray(run?.events) ? run.events : [];
    return Object.freeze({
      schemaVersion: 1,
      runId: run?.runId == null ? null : String(run.runId),
      status: run?.status == null ? null : String(run.status),
      mode: run?.mode == null ? null : String(run.mode),
      startedAt,
      endedAt,
      durationMs: startedAt && durationEnd ? Math.max(0, durationEnd - startedAt) : 0,
      iterations: Math.max(0, Number(run?.counters?.loopIterations) || 0),
      sbcsCompleted: submissions.length,
      rewardsClaimed: completed(nodes, STEP.CLAIM).length,
      packsOpened: packs.length,
      playerPicksCompleted: picks.length,
      cardsMovedToClub: resolutions.reduce(
        (sum, node) => sum + Number(node?.result?.movedToClub?.length || 0),
        0
      ),
      cardsMovedToStorage: resolutions.reduce(
        (sum, node) => sum + Number(node?.result?.movedToStorage?.length || 0),
        0
      ),
      duplicatesRecycled: resolutions.reduce(
        (sum, node) => sum + Number(node?.result?.movedToStorage?.length || 0),
        0
      ),
      protectedDecisions: solves.reduce(
        (sum, node) => sum + Number(node?.result?.protectedItemIds?.length || 0),
        0
      ),
      solverFailures: nodes.filter(
        (node) => node?.step?.type === STEP.SOLVE && (node?.status === "failed" || Number(node?.attempt || 0) > 1)
      ).length,
      pauses: events.filter(
        (event) => ["RUN_PAUSED", "STEP_PAUSED", "STEP_GATED"].includes(event?.type)
      ).length,
      ratingFlow: {
        consumed: ratingFlow(solves, "selectedItems"),
        received: ratingFlow(packs, "receivedItems")
      }
    });
  }
  function exportRunAnalytics(run, options) {
    return JSON.stringify(summarizeRunAnalytics(run, options), null, 2);
  }

  // src/application/immutable.js
  var cloneAndFreeze = (value) => {
    const clone4 = value == null ? value : structuredClone(value);
    const freeze2 = (entry) => {
      if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) return entry;
      Object.values(entry).forEach(freeze2);
      return Object.freeze(entry);
    };
    return freeze2(clone4);
  };
  var stableStringify = (value) => JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
  });
  var stableFingerprint = (value) => {
    const text = stableStringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  // src/application/capability-registry.js
  var CapabilityState = Object.freeze({
    AVAILABLE: "available",
    DEGRADED: "degraded",
    UNAVAILABLE: "unavailable",
    UNVERIFIED: "unverified"
  });
  var validateId = (id) => {
    const value = String(id || "").trim();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
      throw new TypeError(`Invalid capability id: ${value || "missing"}`);
    }
    return value;
  };
  var CapabilityRegistry = class {
    #records = /* @__PURE__ */ new Map();
    #revision = 0;
    declare(id, { state = CapabilityState.UNVERIFIED, reason = null, evidence = null, observedAt = Date.now() } = {}) {
      const capabilityId = validateId(id);
      if (!Object.values(CapabilityState).includes(state)) throw new TypeError(`Invalid capability state: ${state}`);
      this.#revision += 1;
      const record = cloneAndFreeze({ id: capabilityId, state, reason, evidence, observedAt, revision: this.#revision });
      this.#records.set(capabilityId, record);
      return record;
    }
    get(id) {
      return this.#records.get(validateId(id)) || cloneAndFreeze({
        id: String(id),
        state: CapabilityState.UNVERIFIED,
        reason: "Capability has not been observed",
        evidence: null,
        observedAt: null,
        revision: this.#revision
      });
    }
    isAvailable(id) {
      return this.get(id).state === CapabilityState.AVAILABLE;
    }
    require(ids) {
      const records = [...new Set(ids || [])].map((id) => this.get(id));
      return cloneAndFreeze({
        ok: records.every((record) => record.state === CapabilityState.AVAILABLE),
        records,
        missing: records.filter((record) => record.state !== CapabilityState.AVAILABLE).map((record) => record.id),
        revision: this.#revision
      });
    }
    snapshot() {
      return cloneAndFreeze({ revision: this.#revision, capabilities: [...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)) });
    }
  };

  // src/inventory/item-model.js
  var INVENTORY_LOCATIONS = Object.freeze({
    CLUB: "club",
    SBC_STORAGE: "sbc_storage",
    UNASSIGNED: "unassigned"
  });
  var LOCATION_ALIASES = /* @__PURE__ */ new Map([
    ["club", INVENTORY_LOCATIONS.CLUB],
    ["storage", INVENTORY_LOCATIONS.SBC_STORAGE],
    ["sbc-storage", INVENTORY_LOCATIONS.SBC_STORAGE],
    ["sbc_storage", INVENTORY_LOCATIONS.SBC_STORAGE],
    ["sbcstorage", INVENTORY_LOCATIONS.SBC_STORAGE],
    ["unassigned", INVENTORY_LOCATIONS.UNASSIGNED]
  ]);
  var readFirst = (source, keys) => {
    for (const key of keys) {
      if (source?.[key] !== void 0 && source?.[key] !== null) {
        return source[key];
      }
    }
    return null;
  };
  var normalizeIdentifier = (value, { required = false, name = "identifier" } = {}) => {
    if (value === null || value === void 0 || value === "") {
      if (required) throw new TypeError(`${name} is required`);
      return null;
    }
    if (!["string", "number", "bigint"].includes(typeof value)) {
      throw new TypeError(`${name} must be a string, number, or bigint`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${name} must be finite`);
    }
    const normalized = String(value).trim();
    if (!normalized) {
      if (required) throw new TypeError(`${name} is required`);
      return null;
    }
    return normalized;
  };
  var normalizeInventoryLocation = (value) => {
    if (value === null || value === void 0) return null;
    const normalized = LOCATION_ALIASES.get(String(value).trim().toLowerCase());
    if (!normalized) throw new TypeError(`Unsupported inventory location: ${value}`);
    return normalized;
  };
  var toFiniteNumber = (value) => {
    if (value === null || value === void 0 || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  var readTradable = (raw) => {
    const direct = readFirst(raw, ["isTradable", "isTradeable", "tradable"]);
    if (typeof direct === "boolean") return direct;
    if (direct === 1 || direct === "1" || direct === "true") return true;
    if (direct === 0 || direct === "0" || direct === "false") return false;
    const untradeable = readFirst(raw, ["isUntradeable", "untradeable"]);
    if (typeof untradeable === "boolean") return !untradeable;
    return false;
  };
  var hasAnyValue = (source, keys) => keys.some((key) => source?.[key] !== void 0 && source?.[key] !== null);
  var normalizeStringList = (value) => Object.freeze(
    Array.from(
      new Set(
        (Array.isArray(value) ? value : value == null ? [] : [value]).map((entry) => String(entry).trim()).filter(Boolean)
      )
    )
  );
  var normalizeInventoryItem = (raw, options = {}) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError("Inventory item must be an object");
    }
    const itemId = normalizeIdentifier(readFirst(raw, ["itemId", "id"]), {
      required: true,
      name: "itemId"
    });
    const resourceId = normalizeIdentifier(
      readFirst(raw, ["resourceId", "resourceID"]),
      { name: "resourceId" }
    );
    const definitionId = normalizeIdentifier(
      readFirst(raw, ["definitionId", "defId"]),
      { name: "definitionId" }
    );
    const assetId = normalizeIdentifier(readFirst(raw, ["assetId", "assetID"]), {
      name: "assetId"
    });
    const baseId = normalizeIdentifier(readFirst(raw, ["baseId", "baseID", "basePlayerId"]), {
      name: "baseId"
    });
    const location2 = normalizeInventoryLocation(options.location ?? raw.location);
    if (!location2) throw new TypeError("Inventory item location is required");
    const isTradable = readTradable(raw);
    const movableEvidence = readFirst(raw, ["isMovable"]);
    const storableEvidence = readFirst(raw, ["isStorable"]);
    const movableEvidenceDeclared = readFirst(raw, ["hasMovableEvidence"]);
    const storableEvidenceDeclared = readFirst(raw, ["hasStorableEvidence"]);
    const evidence = (declaredKey, sourceKeys) => {
      const declared = readFirst(raw, [declaredKey]);
      return declared == null ? hasAnyValue(raw, sourceKeys) : Boolean(declared);
    };
    return Object.freeze({
      itemId,
      resourceId,
      definitionId,
      assetId,
      baseId,
      location: location2,
      rating: toFiniteNumber(raw.rating) ?? 0,
      name: raw.name == null ? null : String(raw.name),
      cardType: raw.cardType == null ? null : String(raw.cardType),
      rarityId: normalizeIdentifier(raw.rarityId, { name: "rarityId" }),
      rarityName: raw.rarityName == null ? null : String(raw.rarityName),
      specialGroups: normalizeStringList(raw.specialGroups),
      isSpecial: Boolean(raw.isSpecial),
      isTradable,
      // Keep the spelling used by existing AutoPilot payloads as a read-only alias.
      isTradeable: isTradable,
      isUntradeable: !isTradable,
      // Older/fake adapters did not expose these EA capabilities. Preserve their
      // historical permissive behavior, while honoring explicit live false flags.
      isMovable: movableEvidence == null ? true : Boolean(movableEvidence),
      isStorable: storableEvidence == null ? true : Boolean(storableEvidence),
      hasMovableEvidence: movableEvidenceDeclared == null ? movableEvidence != null : Boolean(movableEvidenceDeclared),
      hasStorableEvidence: storableEvidenceDeclared == null ? storableEvidence != null : Boolean(storableEvidenceDeclared),
      hasTradabilityEvidence: evidence("hasTradabilityEvidence", [
        "isTradable",
        "isTradeable",
        "tradable",
        "isUntradeable",
        "untradeable"
      ]),
      hasLockedEvidence: evidence("hasLockedEvidence", ["isLocked", "locked"]),
      hasProtectedEvidence: evidence("hasProtectedEvidence", ["isProtected"]),
      hasFavoriteEvidence: evidence("hasFavoriteEvidence", [
        "isFavorite",
        "isFavourite",
        "favorite"
      ]),
      hasStartingSquadEvidence: evidence("hasStartingSquadEvidence", [
        "isInStartingSquad",
        "isInActive11"
      ]),
      hasSpecialEvidence: evidence("hasSpecialEvidence", [
        "isSpecial",
        "cardType",
        "rarityId",
        "rarityName",
        "specialGroups"
      ]),
      isDuplicate: Boolean(raw.isDuplicate),
      isLocked: Boolean(raw.isLocked ?? raw.locked),
      isFavorite: Boolean(raw.isFavorite ?? raw.isFavourite),
      isFavourite: Boolean(raw.isFavorite ?? raw.isFavourite),
      isInStartingSquad: Boolean(raw.isInStartingSquad ?? raw.isInActive11),
      isInActive11: Boolean(raw.isInStartingSquad ?? raw.isInActive11),
      isStorage: location2 === INVENTORY_LOCATIONS.SBC_STORAGE,
      isProtected: Boolean(raw.isProtected)
    });
  };

  // src/inventory/duplicate-service.js
  var getDuplicateKey = (item) => {
    const resourceId = normalizeIdentifier(item?.resourceId, { name: "resourceId" });
    if (resourceId) return `resource:${resourceId}`;
    const definitionId = normalizeIdentifier(item?.definitionId, {
      name: "definitionId"
    });
    return definitionId ? `definition:${definitionId}` : null;
  };
  var buildDuplicateGroups = (items) => {
    const byKey = /* @__PURE__ */ new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const key = getDuplicateKey(item);
      if (!key) continue;
      const group = byKey.get(key) ?? [];
      group.push(item);
      byKey.set(key, group);
    }
    return Object.freeze(
      Array.from(byKey.entries()).filter(([, group]) => group.length > 1).map(
        ([key, group]) => Object.freeze({
          key,
          resourceId: group[0]?.resourceId ?? null,
          definitionId: group[0]?.definitionId ?? null,
          assetId: group[0]?.assetId ?? null,
          itemIds: Object.freeze(group.map((item) => item.itemId)),
          items: Object.freeze(group.slice())
        })
      )
    );
  };
  var DuplicateService = class {
    getKey(item) {
      return getDuplicateKey(item);
    }
    group(items) {
      return buildDuplicateGroups(items);
    }
    isDuplicate(item, items) {
      const key = getDuplicateKey(item);
      if (!key) return Boolean(item?.isDuplicate);
      let matches = 0;
      for (const candidate of Array.isArray(items) ? items : []) {
        if (getDuplicateKey(candidate) === key) matches += 1;
        if (matches > 1) return true;
      }
      return Boolean(item?.isDuplicate);
    }
  };

  // src/inventory/resolution-policy.js
  var INVENTORY_RESOLUTION_ACTIONS = Object.freeze({
    SEND_TO_CLUB: "SEND_TO_CLUB",
    MOVE_TO_SBC_STORAGE: "MOVE_TO_SBC_STORAGE",
    SAFE_HOLD: "SAFE_HOLD",
    PAUSE: "PAUSE"
  });
  var DEFAULT_DUPLICATE_POLICY = Object.freeze({
    preferSbcStorage: true,
    tradableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD,
    untradeableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.PAUSE
  });
  var validateFallbackAction = (action, policyName) => {
    if (action !== INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD && action !== INVENTORY_RESOLUTION_ACTIONS.PAUSE) {
      throw new TypeError(`${policyName} must be SAFE_HOLD or PAUSE`);
    }
    return action;
  };
  var createAction = (item, type, reason) => Object.freeze({
    itemId: item.itemId,
    type,
    reason,
    from: item.location,
    to: type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB ? "club" : type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE ? "sbc_storage" : item.location
  });
  var planUnassignedResolution = (snapshot, policy = {}) => {
    if (!snapshot || typeof snapshot !== "object") {
      throw new TypeError("An inventory snapshot is required");
    }
    const effectivePolicy = {
      ...DEFAULT_DUPLICATE_POLICY,
      ...policy && typeof policy === "object" ? policy : {}
    };
    effectivePolicy.tradableWhenStorageUnavailable = validateFallbackAction(
      effectivePolicy.tradableWhenStorageUnavailable,
      "tradableWhenStorageUnavailable"
    );
    effectivePolicy.untradeableWhenStorageUnavailable = validateFallbackAction(
      effectivePolicy.untradeableWhenStorageUnavailable,
      "untradeableWhenStorageUnavailable"
    );
    const capacity = snapshot.storageCapacity == null ? null : Math.min(100, Math.max(0, Math.trunc(Number(snapshot.storageCapacity) || 0)));
    let storageFreeSlots = capacity == null ? 0 : Math.max(0, Number(capacity) - (snapshot.storage?.items?.length ?? 0));
    const occupiedVersions = /* @__PURE__ */ new Set();
    for (const item of [
      ...snapshot.club?.items ?? [],
      ...snapshot.storage?.items ?? []
    ]) {
      const key = getDuplicateKey(item);
      if (key) occupiedVersions.add(key);
    }
    const actions = [];
    let paused2 = false;
    for (const item of snapshot.unassigned?.items ?? []) {
      const duplicateKey = getDuplicateKey(item);
      const duplicate = Boolean(
        item.isDuplicate || duplicateKey && occupiedVersions.has(duplicateKey)
      );
      if (!duplicate) {
        if (item.hasMovableEvidence !== true || item.isMovable !== true) {
          actions.push(
            createAction(
              item,
              INVENTORY_RESOLUTION_ACTIONS.PAUSE,
              item.hasMovableEvidence === true ? "unassigned_item_not_movable" : "unassigned_move_evidence_unverified"
            )
          );
          paused2 = true;
          continue;
        }
        actions.push(
          createAction(
            item,
            INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB,
            "not_duplicate"
          )
        );
        if (duplicateKey) occupiedVersions.add(duplicateKey);
        continue;
      }
      if (!duplicateKey) {
        actions.push(
          createAction(
            item,
            INVENTORY_RESOLUTION_ACTIONS.PAUSE,
            "duplicate_identity_ambiguous"
          )
        );
        paused2 = true;
        continue;
      }
      if (effectivePolicy.preferSbcStorage && storageFreeSlots > 0) {
        if (item.hasStorableEvidence !== true) {
          actions.push(
            createAction(
              item,
              INVENTORY_RESOLUTION_ACTIONS.PAUSE,
              "duplicate_storage_evidence_unverified"
            )
          );
          paused2 = true;
          continue;
        }
        if (item.isStorable === true) {
          actions.push(
            createAction(
              item,
              INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE,
              "duplicate_storage_available"
            )
          );
          storageFreeSlots -= 1;
          occupiedVersions.add(duplicateKey);
          continue;
        }
      }
      if (item.hasTradabilityEvidence !== true) {
        actions.push(
          createAction(
            item,
            INVENTORY_RESOLUTION_ACTIONS.PAUSE,
            "duplicate_tradability_evidence_unverified"
          )
        );
        paused2 = true;
        continue;
      }
      const fallback = item.isTradable ? effectivePolicy.tradableWhenStorageUnavailable : effectivePolicy.untradeableWhenStorageUnavailable;
      actions.push(
        createAction(
          item,
          fallback,
          item.isTradable ? "tradable_duplicate_storage_unavailable" : "untradeable_duplicate_storage_unavailable"
        )
      );
      if (fallback === INVENTORY_RESOLUTION_ACTIONS.PAUSE) {
        paused2 = true;
        continue;
      }
    }
    const requiresUserAction = actions.some(
      (action) => action.type === INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD || action.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE
    );
    return Object.freeze({
      generation: snapshot.generation,
      actions: Object.freeze(actions),
      paused: paused2,
      requiresUserAction,
      canContinueWorkflow: !requiresUserAction,
      projectedStorageFreeSlots: storageFreeSlots
    });
  };

  // src/application/sbc-preview.js
  var SBC_PREVIEW_CAPABILITIES = Object.freeze([
    "ea.inventory.read",
    "ea.sbc.read",
    "ea.sbc.solve.preview"
  ]);
  var CAPABILITY_ALIASES = Object.freeze({
    "inventory": ["ea.inventory.read"],
    "inventory read": ["ea.inventory.read"],
    "current sbc read": ["ea.sbc.read"],
    "sbc project import": ["ea.sbc.read"],
    "solve": ["ea.sbc.solve.preview"],
    "unassigned": ["ea.unassigned.read"],
    "resolve": ["ea.unassigned.read", "ea.items.move"],
    "sbc storage move": ["ea.items.move"]
  });
  var STATUS_ALIASES = Object.freeze({
    AVAILABLE: CapabilityState.AVAILABLE,
    DEGRADED: CapabilityState.DEGRADED,
    UNAVAILABLE: CapabilityState.UNAVAILABLE,
    UNVERIFIED: CapabilityState.UNVERIFIED
  });
  var buildRuntimeCapabilityRegistry = (health = []) => {
    const registry = new CapabilityRegistry();
    for (const entry of Array.isArray(health) ? health : []) {
      const sourceId = String(entry?.id || "").trim().toLowerCase();
      const ids = CAPABILITY_ALIASES[sourceId];
      if (!ids) continue;
      const state = STATUS_ALIASES[String(entry?.status || "").toUpperCase()] || CapabilityState.UNVERIFIED;
      for (const id of ids) {
        const existing = registry.get(id);
        const rank = {
          [CapabilityState.UNAVAILABLE]: 0,
          [CapabilityState.UNVERIFIED]: 1,
          [CapabilityState.DEGRADED]: 2,
          [CapabilityState.AVAILABLE]: 3
        };
        if (existing.revision && rank[existing.state] >= rank[state]) continue;
        registry.declare(id, {
          state,
          reason: state === CapabilityState.AVAILABLE ? null : `${entry.id || id} is ${state}`,
          evidence: entry?.evidence || null
        });
      }
    }
    return registry;
  };
  var canonicalContext = (context = {}) => ({
    gameVersion: context.gameVersion,
    state: context.state,
    route: context.route || null,
    setId: context.setId || null,
    challengeId: context.challengeId || null
  });
  var canonicalInventory = (snapshot = {}) => ({
    storageCapacity: snapshot.storageCapacity ?? null,
    items: [...snapshot.items || []].map((item) => ({
      itemId: item.itemId,
      resourceId: item.resourceId,
      definitionId: item.definitionId,
      assetId: item.assetId,
      baseId: item.baseId,
      location: item.location,
      rating: item.rating,
      cardType: item.cardType,
      rarityId: item.rarityId,
      specialGroups: item.specialGroups,
      isSpecial: item.isSpecial,
      isTradable: item.isTradable,
      isDuplicate: item.isDuplicate,
      isLocked: item.isLocked,
      isFavorite: item.isFavorite,
      isInStartingSquad: item.isInStartingSquad,
      isMovable: item.isMovable,
      isStorable: item.isStorable,
      hasMovableEvidence: item.hasMovableEvidence,
      hasStorableEvidence: item.hasStorableEvidence
    })).sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)))
  });
  var canonicalCapabilities = (snapshot = {}, requiredCapabilities = SBC_PREVIEW_CAPABILITIES) => ({
    capabilities: (snapshot.capabilities || []).filter((entry) => requiredCapabilities.includes(entry.id)).map((entry) => ({ id: entry.id, state: entry.state, evidence: entry.evidence || null })).sort((left, right) => left.id.localeCompare(right.id))
  });
  var buildPlanningFingerprints = ({
    gameContext,
    inventorySnapshot,
    capabilitySnapshot,
    requiredCapabilities,
    bindings = {}
  }) => {
    const components = {
      gameContext: stableFingerprint(canonicalContext(gameContext)),
      inventory: stableFingerprint(canonicalInventory(inventorySnapshot)),
      capabilities: stableFingerprint(
        canonicalCapabilities(capabilitySnapshot, requiredCapabilities)
      ),
      bindings: stableFingerprint(bindings)
    };
    return cloneAndFreeze({
      ...components,
      combined: stableFingerprint(components),
      inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0))
    });
  };
  var comparePlanningFingerprints = (expected, current) => {
    const keys = ["gameContext", "inventory", "capabilities", "bindings"];
    const changed = keys.filter((key) => expected?.[key] !== current?.[key]);
    return cloneAndFreeze({ ok: changed.length === 0, changed });
  };
  var buildSbcPlanFingerprints = ({
    gameContext,
    inventorySnapshot,
    project,
    policySnapshot,
    capabilitySnapshot
  }) => {
    const components = {
      gameContext: stableFingerprint(canonicalContext(gameContext)),
      inventory: stableFingerprint(canonicalInventory(inventorySnapshot)),
      project: stableFingerprint(project),
      policy: stableFingerprint(policySnapshot),
      capabilities: stableFingerprint(canonicalCapabilities(capabilitySnapshot))
    };
    return cloneAndFreeze({
      ...components,
      combined: stableFingerprint(components),
      inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0))
    });
  };
  var compareSbcPlanFingerprints = (expected, current) => {
    const keys = ["gameContext", "inventory", "project", "policy", "capabilities"];
    const changed = keys.filter((key) => expected?.[key] !== current?.[key]);
    return cloneAndFreeze({ ok: changed.length === 0, changed });
  };
  var projectChallengeForContext = (project, context) => (project?.sourceChallenges || []).find((challenge) => String(challenge.id) === String(context?.challengeId || "")) || null;
  var summarizeSbcSolution = ({ solution, inventorySnapshot, protectedItemIds = [] }) => {
    const byId = new Map((inventorySnapshot?.items || []).map((item) => [String(item.itemId), item]));
    const protectedIds = new Set((protectedItemIds || []).map(String));
    const selectedIds = (solution?.solutionIds || []).map(String);
    const selected3 = selectedIds.map((id) => byId.get(id)).filter(Boolean);
    const unobservedItemIds = selectedIds.filter((id) => !byId.has(id));
    const protectedViolations = selectedIds.filter((id) => protectedIds.has(id));
    const ratings = selected3.map((item) => Number(item.rating || 0));
    return cloneAndFreeze({
      solved: solution?.solved === true && solution?.submitReady === true,
      selectedCount: selectedIds.length,
      cards: selected3.map((item) => ({
        name: item.name || null,
        rating: Number(item.rating || 0),
        location: item.location,
        isSpecial: Boolean(item.isSpecial),
        isDuplicate: Boolean(item.isDuplicate),
        isTradable: Boolean(item.isTradable)
      })).sort((left, right) => right.rating - left.rating || String(left.name || "").localeCompare(String(right.name || ""))),
      ratingRange: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
      specialCount: selected3.filter((item) => item.isSpecial).length,
      duplicateCount: selected3.filter((item) => item.isDuplicate).length,
      storageCount: selected3.filter((item) => item.location === "sbc_storage").length,
      selectedProtectedCount: protectedViolations.length,
      protectedViolations,
      unobservedItemIds,
      objectiveTuple: solution?.stats?.conservationObjectiveTuple || null
    });
  };

  // src/application/duplicate-route-preview.js
  var DUPLICATE_ROUTE_READ_CAPABILITIES = Object.freeze([
    "ea.inventory.read",
    "ea.unassigned.read"
  ]);
  var DUPLICATE_ROUTE_MOVE_CAPABILITIES = Object.freeze([
    "ea.items.move"
  ]);
  var DUPLICATE_ROUTE_POLICY = Object.freeze({
    schemaVersion: 1,
    preferSbcStorage: true,
    tradableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD,
    untradeableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.PAUSE
  });
  var SAFE_TYPES = /* @__PURE__ */ new Set([
    INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB,
    INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE
  ]);
  var MAX_APPROVABLE_ROUTE_ITEMS = 100;
  var canonicalAction = (action = {}) => ({
    itemId: String(action.itemId || ""),
    type: String(action.type || ""),
    from: String(action.from || ""),
    to: String(action.to || ""),
    reason: String(action.reason || "")
  });
  var canonicalDuplicateRouteActions = (actions = []) => cloneAndFreeze((actions || []).map(canonicalAction).sort((left, right) => `${left.itemId}:${left.type}:${left.to}`.localeCompare(
    `${right.itemId}:${right.type}:${right.to}`
  )));
  var fingerprintDuplicateRouteActions = (actions = []) => stableFingerprint(canonicalDuplicateRouteActions(actions));
  var publicReason = (action) => {
    const reasons = {
      not_duplicate: "Unique card can move to Club",
      duplicate_storage_available: "Exact duplicate can move to SBC Storage",
      tradable_duplicate_storage_unavailable: "Tradable duplicate stays for your decision",
      untradeable_duplicate_storage_unavailable: "No verified safe destination is available",
      duplicate_identity_ambiguous: "Exact card version could not be verified",
      unassigned_item_not_movable: "EA reports this card cannot move"
    };
    return reasons[action.reason] || "Kept unassigned for your decision";
  };
  var summarizeDuplicateRoute = ({ plan, inventorySnapshot }) => {
    const byId = new Map(
      (inventorySnapshot?.unassigned?.items || []).map((item) => [String(item.itemId), item])
    );
    const actions = canonicalDuplicateRouteActions(plan?.actions || []);
    const blockers = [];
    for (const action of actions) {
      const item = byId.get(action.itemId);
      if (!item) {
        blockers.push({
          code: "ROUTE_ITEM_UNOBSERVED",
          message: "The route references an item outside the current Unassigned snapshot."
        });
        continue;
      }
      if (action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB && (!item.hasMovableEvidence || item.isMovable !== true)) {
        blockers.push({
          code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
          message: "EA did not provide verified Club-move evidence for every proposed card."
        });
      }
      if (action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE && (!item.hasMovableEvidence || item.isMovable !== false || !item.hasStorableEvidence || item.isStorable !== true)) {
        blockers.push({
          code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
          message: "EA did not provide verified SBC Storage evidence for every proposed card."
        });
      }
      if (action.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE && String(action.reason || "").endsWith("_evidence_unverified")) {
        blockers.push({
          code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
          message: "EA did not provide verified movement evidence for every proposed card."
        });
      }
    }
    const safeActions = actions.filter((action) => SAFE_TYPES.has(action.type));
    const heldActions = actions.filter((action) => !SAFE_TYPES.has(action.type));
    const expectedUnassignedItemIdsBefore = [...byId.keys()].sort();
    const expectedRemainingItemIdsAfter = heldActions.map((action) => action.itemId).sort();
    if (actions.length !== expectedUnassignedItemIdsBefore.length || new Set(actions.map((action) => action.itemId)).size !== actions.length) {
      blockers.push({
        code: "ROUTE_COVERAGE_MISMATCH",
        message: "The route does not account for every current Unassigned item exactly once."
      });
    }
    if (actions.length > MAX_APPROVABLE_ROUTE_ITEMS) {
      blockers.push({
        code: "ROUTE_TOO_LARGE",
        message: `This route exceeds the ${MAX_APPROVABLE_ROUTE_ITEMS}-item safety boundary.`
      });
    }
    const uniqueBlockers = [...new Map(
      blockers.map((blocker) => [`${blocker.code}:${blocker.message}`, blocker])
    ).values()];
    const cards = actions.map((action) => {
      const item = byId.get(action.itemId) || {};
      return {
        itemId: action.itemId,
        name: item.name || null,
        rating: Number(item.rating || 0),
        isSpecial: Boolean(item.isSpecial),
        isTradable: Boolean(item.isTradable),
        action: action.type,
        destination: action.to,
        reason: publicReason(action)
      };
    });
    return cloneAndFreeze({
      status: uniqueBlockers.length ? "blocked" : safeActions.length ? "ready" : "clear",
      totalCount: actions.length,
      safeCount: safeActions.length,
      toClubCount: safeActions.filter((action) => action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB).length,
      toStorageCount: safeActions.filter((action) => action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE).length,
      attentionCount: heldActions.length,
      cards,
      blockers: uniqueBlockers,
      routeActions: actions,
      approvedActions: safeActions,
      expectedUnassignedItemIdsBefore,
      expectedRemainingItemIdsAfter,
      actionSetFingerprint: fingerprintDuplicateRouteActions(actions)
    });
  };
  var buildDuplicateRouteFingerprints = ({
    gameContext,
    inventorySnapshot,
    capabilitySnapshot,
    policy,
    routeActions
  }) => buildPlanningFingerprints({
    gameContext,
    inventorySnapshot,
    capabilitySnapshot,
    requiredCapabilities: [
      ...DUPLICATE_ROUTE_READ_CAPABILITIES,
      ...DUPLICATE_ROUTE_MOVE_CAPABILITIES
    ],
    bindings: {
      policy,
      actionSetFingerprint: fingerprintDuplicateRouteActions(routeActions)
    }
  });
  var compareDuplicateRouteFingerprints = comparePlanningFingerprints;

  // src/application/entitlement-service.js
  var ProductPlan = Object.freeze({ FREE: "free", PRO: "pro" });
  var Feature = Object.freeze({
    PRODUCT_SHELL: "product_shell",
    SBC_PROJECTS: "sbc_projects",
    LOCAL_RECIPES: "local_recipes",
    ADVANCED_TOOLS: "advanced_tools",
    EVOLUTION_PLANNING: "evolution_planning",
    CLUB_OPTIMIZATION: "club_optimization",
    PROJECT_OPTIMIZATION: "project_optimization",
    SMART_ROUTING: "smart_routing",
    CLOUD_RECIPES: "cloud_recipes"
  });
  var FREE_FEATURES = /* @__PURE__ */ new Set([Feature.PRODUCT_SHELL, Feature.SBC_PROJECTS, Feature.LOCAL_RECIPES, Feature.ADVANCED_TOOLS]);
  var PRO_FEATURES = /* @__PURE__ */ new Set([
    ...FREE_FEATURES,
    Feature.EVOLUTION_PLANNING,
    Feature.CLUB_OPTIMIZATION,
    Feature.PROJECT_OPTIMIZATION,
    Feature.SMART_ROUTING,
    Feature.CLOUD_RECIPES
  ]);
  var EntitlementService = class {
    constructor({ plan = ProductPlan.FREE } = {}) {
      if (!Object.values(ProductPlan).includes(plan)) throw new TypeError(`Unknown product plan: ${plan}`);
      this.plan = plan;
    }
    check(feature) {
      if (!Object.values(Feature).includes(feature)) throw new TypeError(`Unknown feature: ${feature}`);
      const entitled = (this.plan === ProductPlan.PRO ? PRO_FEATURES : FREE_FEATURES).has(feature);
      return cloneAndFreeze({ entitled, feature, plan: this.plan, requiredPlan: entitled ? this.plan : ProductPlan.PRO });
    }
  };

  // src/application/pro-contracts/errors.js
  var PRO_CONTRACT_ERROR_CODES = Object.freeze({
    CONTRACT_INVALID: "CONTRACT_INVALID",
    CONTRACT_VERSION_UNSUPPORTED: "CONTRACT_VERSION_UNSUPPORTED",
    CONTRACT_TOO_LARGE: "CONTRACT_TOO_LARGE",
    PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
    PROVIDER_OFFLINE: "PROVIDER_OFFLINE",
    PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
    PROVIDER_INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
    RESPONSE_MISMATCH: "RESPONSE_MISMATCH",
    RESPONSE_EXPIRED: "RESPONSE_EXPIRED",
    HANDLE_UNKNOWN: "HANDLE_UNKNOWN",
    LOCAL_REVALIDATION_FAILED: "LOCAL_REVALIDATION_FAILED"
  });

  // src/application/pro-contracts/schema.js
  var PRO_CONTRACT_LIMITS = Object.freeze({
    MAX_BYTES: 512 * 1024,
    MAX_DEPTH: 16,
    MAX_ARRAY_LENGTH: 5e3,
    MAX_OBJECT_KEYS: 128,
    MAX_STRING_BYTES: 240,
    // Compatibility alias for callers written before limits were clarified as
    // UTF-8 byte limits. Both names intentionally have the same value.
    MAX_STRING_LENGTH: 240,
    MAX_ID_LENGTH: 128,
    MAX_FEATURES: 64
  });
  var FORBIDDEN_KEY_TOKENS = [
    "authorization",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "password",
    "secret",
    "secrets",
    "token",
    "tokens",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "session",
    "sessionid",
    "sessiontoken",
    "headers",
    "endpoint",
    "url",
    "uri",
    "href",
    "html",
    "script",
    "selector",
    "expression",
    "workflow",
    "steps",
    "command",
    "module",
    "wasm",
    "function",
    "itemid",
    "resourceid",
    "definitionid",
    "assetid",
    "baseplayerid",
    "playerid"
  ];
  var PRO_CONTRACT_FORBIDDEN_KEYS = Object.freeze(
    [...new Set(FORBIDDEN_KEY_TOKENS)].sort()
  );
  var forbiddenKeys = new Set(PRO_CONTRACT_FORBIDDEN_KEYS);
  var encoder = new TextEncoder();

  // src/application/evolution-metadata-provider.js
  var EVOLUTION_METADATA_LIMITS = Object.freeze({
    maxBytes: 16 * 1024,
    maxDepth: 5,
    maxObjectKeys: 16,
    maxRequestTtlMs: 2 * 6e4,
    maxEvidenceTtlMs: 24 * 60 * 6e4,
    maxDefinitions: 2e3,
    maxStringBytes: 128
  });
  var EvolutionMetadataProviderState = Object.freeze({
    READY: "ready",
    UNVERIFIED: "unverified",
    NOT_CONFIGURED: "not_configured"
  });
  var EvolutionMetadataEvidenceState = Object.freeze({
    VERIFIED: "verified",
    UNVERIFIED: "unverified"
  });
  var EvolutionMetadataGameVersion = Object.freeze({
    FC26: "fc26",
    FC27: "fc27"
  });

  // src/application/evolution-planner.js
  var EVOLUTION_PLANNER_LIMITS = Object.freeze({
    maxDepth: 4,
    maxNodes: 256,
    maxEdges: 128,
    maxEdgeEvaluations: 1e4,
    maxAlternatives: 16,
    maxCollectionSize: 32
  });
  var EVOLUTION_PLANNER_HARD_LIMITS = Object.freeze({
    maxDepth: 8,
    maxNodes: 2e3,
    maxEdges: 512,
    maxEdgeEvaluations: 5e4,
    maxAlternatives: 64,
    maxCollectionSize: 64
  });
  var EvolutionAttribute = Object.freeze({
    PACE: "pace",
    SHOOTING: "shooting",
    PASSING: "passing",
    DRIBBLING: "dribbling",
    DEFENDING: "defending",
    PHYSICAL: "physical"
  });
  var EvolutionPosition = Object.freeze([
    "GK",
    "RB",
    "RWB",
    "CB",
    "LB",
    "LWB",
    "CDM",
    "CM",
    "CAM",
    "RM",
    "RW",
    "LM",
    "LW",
    "CF",
    "ST"
  ]);
  var EvolutionObjectiveDimension = Object.freeze({
    OVERALL: "OVERALL",
    PACE: "PACE",
    SHOOTING: "SHOOTING",
    PASSING: "PASSING",
    DRIBBLING: "DRIBBLING",
    DEFENDING: "DEFENDING",
    PHYSICAL: "PHYSICAL",
    POSITION_MATCHES: "POSITION_MATCHES",
    ROLE_MATCHES: "ROLE_MATCHES",
    PLAYSTYLE_MATCHES: "PLAYSTYLE_MATCHES",
    PLAYSTYLE_PLUS_MATCHES: "PLAYSTYLE_PLUS_MATCHES",
    ELIGIBILITY_TAG_MATCHES: "ELIGIBILITY_TAG_MATCHES",
    PATH_LENGTH: "PATH_LENGTH"
  });
  var EvolutionObjectiveDirection = Object.freeze({
    MAXIMIZE: "MAXIMIZE",
    MINIMIZE: "MINIMIZE"
  });
  var EvolutionTransformOperation = Object.freeze({
    ADD_CAPPED: "ADD_CAPPED",
    SET: "SET",
    MAX: "MAX"
  });
  var EvolutionSearchStatus = Object.freeze({
    COMPLETE_WITHIN_BOUNDS: "COMPLETE_WITHIN_BOUNDS",
    NO_VERIFIED_PATH: "NO_VERIFIED_PATH",
    BOUNDED: "BOUNDED"
  });
  var EvolutionBoundReason = Object.freeze({
    DEPTH_BOUND_REACHED: "DEPTH_BOUND_REACHED",
    NODE_BOUND_REACHED: "NODE_BOUND_REACHED",
    EDGE_EVALUATION_BOUND_REACHED: "EDGE_EVALUATION_BOUND_REACHED",
    ALTERNATIVE_BOUND_REACHED: "ALTERNATIVE_BOUND_REACHED"
  });
  var EvolutionExplanationCode = Object.freeze({
    STARTING_STATE: "STARTING_STATE",
    VERIFIED_EDGE_APPLIED: "VERIFIED_EDGE_APPLIED",
    OVERALL_CHANGED: "OVERALL_CHANGED",
    ATTRIBUTE_CHANGED: "ATTRIBUTE_CHANGED",
    POSITION_ADDED: "POSITION_ADDED",
    ROLE_ADDED: "ROLE_ADDED",
    PLAYSTYLE_ADDED: "PLAYSTYLE_ADDED",
    PLAYSTYLE_PLUS_ADDED: "PLAYSTYLE_PLUS_ADDED",
    RARITY_CHANGED: "RARITY_CHANGED",
    ELIGIBILITY_TAG_CHANGED: "ELIGIBILITY_TAG_CHANGED",
    PARETO_NON_DOMINATED: "PARETO_NON_DOMINATED"
  });
  var EvolutionPlannerErrorCode = Object.freeze({
    INVALID_INPUT: "INVALID_INPUT",
    BOUND_EXCEEDED: "BOUND_EXCEEDED",
    UNVERIFIED_EDGE: "UNVERIFIED_EDGE",
    DUPLICATE_EDGE: "DUPLICATE_EDGE",
    INVALID_TRANSFORMATION: "INVALID_TRANSFORMATION",
    INVALID_OBJECTIVE: "INVALID_OBJECTIVE"
  });
  var ATTRIBUTE_KEYS = Object.freeze(Object.values(EvolutionAttribute));
  var POSITION_SET = new Set(EvolutionPosition);
  var OBJECTIVE_DIMENSIONS = new Set(Object.values(EvolutionObjectiveDimension));
  var DIRECTIONS = new Set(Object.values(EvolutionObjectiveDirection));
  var TRANSFORM_OPERATIONS = new Set(Object.values(EvolutionTransformOperation));
  var EvolutionEligibilityReason = Object.freeze({
    POSITION_ANY_OF_MISSING: "POSITION_ANY_OF_MISSING",
    POSITION_ALL_OF_MISSING: "POSITION_ALL_OF_MISSING",
    ROLE_MISSING: "ROLE_MISSING",
    PLAYSTYLE_MISSING: "PLAYSTYLE_MISSING",
    PLAYSTYLE_PLUS_MISSING: "PLAYSTYLE_PLUS_MISSING",
    RARITY_MISMATCH: "RARITY_MISMATCH",
    ELIGIBILITY_TAG_MISSING: "ELIGIBILITY_TAG_MISSING",
    EXCLUDED_ELIGIBILITY_TAG: "EXCLUDED_ELIGIBILITY_TAG",
    OVERALL_BELOW_MINIMUM: "OVERALL_BELOW_MINIMUM",
    OVERALL_ABOVE_MAXIMUM: "OVERALL_ABOVE_MAXIMUM",
    ATTRIBUTE_BELOW_MINIMUM: "ATTRIBUTE_BELOW_MINIMUM",
    ATTRIBUTE_ABOVE_MAXIMUM: "ATTRIBUTE_ABOVE_MAXIMUM",
    EVOLUTION_ALREADY_APPLIED: "EVOLUTION_ALREADY_APPLIED"
  });

  // src/application/evolution-analysis.js
  var EvolutionResultMode = Object.freeze({
    BEST_FINAL_OVR: "BEST_FINAL_OVR",
    BIGGEST_UPGRADE: "BIGGEST_UPGRADE",
    SHORTEST_STRONG_PATH: "SHORTEST_STRONG_PATH",
    BEST_FOR_ROLE: "BEST_FOR_ROLE"
  });
  var FUT_MAGIC_ROLE_PROFILES_V1 = Object.freeze({
    ST: Object.freeze({ pace: 2, shooting: 4, passing: 1, dribbling: 2, defending: 0, physical: 1 }),
    CAM: Object.freeze({ pace: 1, shooting: 2, passing: 3, dribbling: 3, defending: 0, physical: 1 }),
    RW: Object.freeze({ pace: 3, shooting: 2, passing: 2, dribbling: 3, defending: 0, physical: 0 }),
    LW: Object.freeze({ pace: 3, shooting: 2, passing: 2, dribbling: 3, defending: 0, physical: 0 }),
    CM: Object.freeze({ pace: 1, shooting: 1, passing: 3, dribbling: 2, defending: 2, physical: 1 }),
    CDM: Object.freeze({ pace: 1, shooting: 0, passing: 2, dribbling: 1, defending: 4, physical: 2 }),
    CB: Object.freeze({ pace: 1, shooting: 0, passing: 1, dribbling: 0, defending: 5, physical: 3 }),
    LB: Object.freeze({ pace: 3, shooting: 0, passing: 2, dribbling: 1, defending: 3, physical: 1 }),
    RB: Object.freeze({ pace: 3, shooting: 0, passing: 2, dribbling: 1, defending: 3, physical: 1 }),
    GK: Object.freeze({ pace: 0, shooting: 0, passing: 1, dribbling: 0, defending: 5, physical: 4 })
  });

  // src/application/evolution-beam-search.js
  var EvolutionBeamStatus = Object.freeze({
    HEURISTIC_COMPLETE: "HEURISTIC_COMPLETE",
    NO_VERIFIED_PATH: "NO_VERIFIED_PATH",
    BOUNDED: "BOUNDED"
  });
  var HARD = Object.freeze({ maxDepth: 8, beamWidth: 64, topResults: 20, maxNodes: 2e3, maxEdgeEvaluations: 5e4, maxEdges: 512 });

  // src/sbc/solver/item-identity.js
  var firstDefined = (...values) => values.find((value) => value !== null && value !== void 0 && value !== "");
  var optionalId = (...values) => {
    const value = firstDefined(...values);
    return value == null ? null : String(value);
  };
  var getOwnedItemId = (item) => optionalId(item?.itemId, item?.id);
  var getResourceId = (item) => optionalId(item?.resourceId, item?.resourceID);
  var getBasePlayerId = (item) => optionalId(
    item?.basePlayerId,
    item?.baseId,
    item?.baseID,
    item?.assetId,
    item?.assetID,
    item?.asset_id
  );
  var normalizeSolverItem = (item) => {
    if (!item || typeof item !== "object") {
      throw new TypeError("solver item must be an object");
    }
    const itemId = getOwnedItemId(item);
    if (itemId == null) {
      throw new TypeError("solver item requires an owned itemId/id");
    }
    return {
      ...item,
      itemId,
      resourceId: getResourceId(item),
      basePlayerId: getBasePlayerId(item)
    };
  };
  var normalizeOwnedItems = (items) => {
    if (!Array.isArray(items)) return [];
    const seen = /* @__PURE__ */ new Set();
    return items.map(normalizeSolverItem).filter((item) => {
      if (seen.has(item.itemId)) return false;
      seen.add(item.itemId);
      return true;
    });
  };

  // src/sbc/solver/rating.js
  var FC26_SQUAD_SIZE = 11;
  var FC26_RATING_ROUND_THRESHOLD = 0.96;
  var toRating = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
      throw new RangeError(`Invalid FC26 item rating: ${String(value)}`);
    }
    return parsed;
  };
  var getFc26AdjustedAverage = (ratings) => {
    if (!Array.isArray(ratings) || ratings.length === 0) {
      throw new TypeError("ratings must be a non-empty array");
    }
    const normalized = ratings.map(toRating);
    const average = normalized.reduce((sum, rating) => sum + rating, 0) / normalized.length;
    const adjustedTotal = normalized.reduce(
      (sum, rating) => sum + (rating <= average ? rating : 2 * rating - average),
      0
    );
    return adjustedTotal / normalized.length;
  };
  var calculateFc26SquadRating = (ratings, {
    expectedSquadSize = FC26_SQUAD_SIZE,
    roundThreshold = FC26_RATING_ROUND_THRESHOLD
  } = {}) => {
    if (!Array.isArray(ratings) || ratings.length !== expectedSquadSize) {
      throw new RangeError(
        `FC26 SBC rating requires ${expectedSquadSize} ratings; received ${Array.isArray(ratings) ? ratings.length : 0}`
      );
    }
    if (!Number.isFinite(roundThreshold) || roundThreshold < 0 || roundThreshold > 1) {
      throw new RangeError("roundThreshold must be between 0 and 1");
    }
    const adjusted = getFc26AdjustedAverage(ratings);
    const hundredths = Math.round(adjusted * 100);
    const base = Math.floor(hundredths / 100);
    const fraction = hundredths - base * 100;
    return fraction >= Math.round(roundThreshold * 100) ? base + 1 : base;
  };

  // src/policies/target-project-service.js
  var finiteNumber = (value, fallback = null) => {
    if (value === null || value === void 0 || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  var nonNegativeInteger = (value, fallback = 0) => Math.max(0, Math.trunc(finiteNumber(value, fallback)));
  var normalizeIdList = (values) => Array.from(
    new Set(
      (Array.isArray(values) ? values : []).filter((value) => value !== null && value !== void 0 && value !== "").map(String)
    )
  );
  var normalizeReserveMap = (value) => {
    const entries = value && typeof value === "object" ? Object.entries(value) : [];
    return Object.fromEntries(
      entries.map(([rating, count]) => [String(nonNegativeInteger(rating)), nonNegativeInteger(count)]).filter(([rating, count]) => Number(rating) >= 1 && Number(rating) <= 99 && count > 0)
    );
  };
  var normalizeProtectedRatings = (value) => {
    if (typeof value === "number") {
      return {
        atOrAbove: Math.min(99, Math.max(1, Math.trunc(value))),
        exact: [],
        reserveByRating: {}
      };
    }
    if (Array.isArray(value)) {
      return {
        atOrAbove: null,
        exact: Array.from(
          new Set(value.map((rating) => nonNegativeInteger(rating)).filter((rating) => rating >= 1 && rating <= 99))
        ),
        reserveByRating: {}
      };
    }
    const source = value && typeof value === "object" ? value : {};
    const threshold = finiteNumber(source.atOrAbove, null);
    return {
      atOrAbove: threshold == null ? null : Math.min(99, Math.max(1, Math.trunc(threshold))),
      exact: Array.from(
        new Set(
          (Array.isArray(source.exact) ? source.exact : []).map((rating) => nonNegativeInteger(rating)).filter((rating) => rating >= 1 && rating <= 99)
        )
      ),
      reserveByRating: normalizeReserveMap(
        source.reserveByRating ?? source.minimumReserveByRating
      )
    };
  };
  var normalizeRatingRequirements = (requirements) => (Array.isArray(requirements) ? requirements : []).map((requirement) => {
    const source = typeof requirement === "number" ? { rating: requirement } : requirement || {};
    const rating = nonNegativeInteger(source.rating ?? source.squadRating);
    if (rating < 1 || rating > 99) return null;
    return {
      rating,
      count: Math.max(1, nonNegativeInteger(source.count, 1)),
      completed: nonNegativeInteger(source.completed)
    };
  }).filter(Boolean);
  var normalizeSpecialRequirements = (requirements) => (Array.isArray(requirements) ? requirements : []).map((requirement) => {
    const source = typeof requirement === "string" ? { cardType: requirement } : requirement || {};
    const cardType = String(source.cardType ?? source.type ?? "").trim().toLowerCase();
    if (!cardType) return null;
    return {
      cardType,
      count: Math.max(1, nonNegativeInteger(source.count, 1)),
      completed: nonNegativeInteger(source.completed),
      perRemainingSquad: source.perRemainingSquad === true
    };
  }).filter(Boolean);
  var normalizeSourceChallenges = (challenges) => (Array.isArray(challenges) ? challenges : []).map((challenge) => {
    const id = String(challenge?.id ?? challenge?.challengeId ?? "").trim();
    if (!id) return null;
    const rating = finiteNumber(
      challenge?.requiredSquadRating ?? challenge?.rating,
      null
    );
    return {
      id,
      name: challenge?.name == null ? null : String(challenge.name),
      completed: challenge?.completed === true,
      requiredSquadRating: rating == null ? null : Math.max(1, Math.min(99, Math.trunc(rating))),
      specialCardRequirements: normalizeSpecialRequirements(
        challenge?.specialCardRequirements
      ),
      unknownRequirements: Array.isArray(challenge?.unknownRequirements) ? challenge.unknownRequirements.map((value) => String(value)) : []
    };
  }).filter(Boolean);
  var aggregateSourceChallenges = (challenges) => {
    const rating = /* @__PURE__ */ new Map();
    const specials = /* @__PURE__ */ new Map();
    for (const challenge of challenges) {
      if (challenge.requiredSquadRating != null) {
        const entry = rating.get(challenge.requiredSquadRating) || {
          rating: challenge.requiredSquadRating,
          count: 0,
          completed: 0
        };
        entry.count += 1;
        if (challenge.completed) entry.completed += 1;
        rating.set(challenge.requiredSquadRating, entry);
      }
      for (const requirement of challenge.specialCardRequirements) {
        const entry = specials.get(requirement.cardType) || {
          cardType: requirement.cardType,
          count: 0,
          completed: 0,
          perRemainingSquad: false
        };
        entry.count += requirement.count;
        if (challenge.completed) entry.completed += requirement.count;
        specials.set(requirement.cardType, entry);
      }
    }
    const completedChallenges = challenges.filter((challenge) => challenge.completed).length;
    return {
      ratingRequirements: [...rating.values()].sort((a, b) => a.rating - b.rating),
      specialCardRequirements: [...specials.values()].sort((a, b) => a.cardType.localeCompare(b.cardType)),
      requiredSquadsRemaining: Math.max(0, challenges.length - completedChallenges),
      completionProgress: challenges.length ? completedChallenges / challenges.length : 0
    };
  };
  var normalizeTargetProject = (project, index = 0) => {
    if (!project || typeof project !== "object") {
      throw new TypeError("target project must be an object");
    }
    const id = String(project.id ?? `target-project-${index + 1}`);
    const name = String(project.name ?? "").trim();
    if (!name) throw new TypeError(`target project ${id} requires a name`);
    const sourceChallenges = normalizeSourceChallenges(project.sourceChallenges);
    const sourceChallengeIds = normalizeIdList(
      project.sourceChallengeIds?.length ? project.sourceChallengeIds : sourceChallenges.map((challenge) => challenge.id)
    );
    return {
      id,
      name,
      active: project.active !== false,
      priority: Math.max(0, nonNegativeInteger(project.priority, 1)),
      requiredSquadsRemaining: nonNegativeInteger(
        project.requiredSquadsRemaining ?? project.remainingSquads
      ),
      ratingRequirements: normalizeRatingRequirements(project.ratingRequirements),
      specialCardRequirements: normalizeSpecialRequirements(
        project.specialCardRequirements
      ),
      protectedRatings: normalizeProtectedRatings(project.protectedRatings),
      protectedPlayerIds: normalizeIdList(project.protectedPlayerIds),
      protectedResourceIds: normalizeIdList(project.protectedResourceIds),
      sourceSetId: project.sourceSetId == null || project.sourceSetId === "" ? null : String(project.sourceSetId),
      sourceChallengeIds,
      sourceChallenges,
      completionProgress: Math.min(
        1,
        Math.max(0, finiteNumber(project.completionProgress, 0))
      )
    };
  };
  var TargetProjectService = class {
    #projects;
    constructor(projects = []) {
      this.#projects = (Array.isArray(projects) ? projects : []).map(
        normalizeTargetProject
      );
    }
    list() {
      return this.#projects.map((project) => structuredClone(project));
    }
    getActiveProjects() {
      return this.list().filter(
        (project) => project.active && project.completionProgress < 1 && (project.requiredSquadsRemaining > 0 || project.ratingRequirements.length > 0 || project.specialCardRequirements.length > 0 || project.protectedRatings.atOrAbove != null || project.protectedRatings.exact.length > 0 || Object.keys(project.protectedRatings.reserveByRating).length > 0 || project.protectedPlayerIds.length > 0 || project.protectedResourceIds.length > 0)
      ).sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
    }
    upsert(project) {
      const normalized = normalizeTargetProject(project, this.#projects.length);
      const index = this.#projects.findIndex((candidate) => candidate.id === normalized.id);
      if (index >= 0) this.#projects[index] = normalized;
      else this.#projects.push(normalized);
      return structuredClone(normalized);
    }
    remove(id) {
      const before = this.#projects.length;
      this.#projects = this.#projects.filter((project) => project.id !== String(id));
      return this.#projects.length !== before;
    }
    importCurrentSbc(snapshot, overrides = {}) {
      if (!snapshot || typeof snapshot !== "object" || !snapshot.setId) {
        throw new TypeError("A verified current SBC set is required");
      }
      const sourceChallenges = normalizeSourceChallenges(snapshot.challenges);
      if (!sourceChallenges.length) {
        throw new TypeError("The current SBC exposes no verifiable challenges");
      }
      const aggregated = aggregateSourceChallenges(sourceChallenges);
      return this.upsert({
        id: overrides.id ?? `project-${String(snapshot.setId)}`,
        name: overrides.name ?? snapshot.setName ?? "Imported Target SBC",
        active: overrides.active !== false,
        priority: overrides.priority ?? 50,
        ...aggregated,
        protectedRatings: overrides.protectedRatings ?? {},
        protectedPlayerIds: overrides.protectedPlayerIds ?? [],
        protectedResourceIds: overrides.protectedResourceIds ?? [],
        sourceSetId: String(snapshot.setId),
        sourceChallengeIds: sourceChallenges.map((challenge) => challenge.id),
        sourceChallenges
      });
    }
    synchronizeFromCurrentSbc(id, snapshot) {
      const current = this.#projects.find((project) => project.id === String(id));
      if (!current) throw new TypeError(`Unknown target project: ${String(id)}`);
      if (!current.sourceSetId || String(snapshot?.setId ?? "") !== current.sourceSetId) {
        throw new TypeError("The open SBC set does not match this Target Project");
      }
      const observed = normalizeSourceChallenges(snapshot?.challenges);
      const observedById = new Map(observed.map((challenge) => [challenge.id, challenge]));
      if (current.sourceChallengeIds.length === 0 || current.sourceChallengeIds.some((challengeId) => !observedById.has(challengeId))) {
        throw new TypeError("Target Project challenges could not be mapped uniquely");
      }
      const sourceChallenges = current.sourceChallengeIds.map(
        (challengeId) => observedById.get(challengeId)
      );
      const aggregated = aggregateSourceChallenges(sourceChallenges);
      return this.upsert({
        ...current,
        ...aggregated,
        sourceChallenges
      });
    }
    markVerifiedChallengeCompleted({ setId, challengeId } = {}) {
      const matches = this.#projects.filter(
        (project2) => project2.sourceSetId === String(setId ?? "") && project2.sourceChallengeIds.includes(String(challengeId ?? ""))
      );
      if (matches.length !== 1) return null;
      const project = matches[0];
      const sourceChallenges = project.sourceChallenges.map(
        (challenge) => challenge.id === String(challengeId) ? { ...challenge, completed: true } : challenge
      );
      return this.upsert({
        ...project,
        ...aggregateSourceChallenges(sourceChallenges),
        sourceChallenges
      });
    }
    getDashboard(items = []) {
      const ratingCounts = {};
      for (const item of Array.isArray(items) ? items : []) {
        const rating = nonNegativeInteger(item?.rating);
        if (rating > 0) ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
      }
      return this.getActiveProjects().map((project) => ({
        id: project.id,
        name: project.name,
        priority: project.priority,
        completedSquads: project.sourceChallenges.filter((challenge) => challenge.completed).length,
        totalSquads: project.sourceChallenges.length || project.requiredSquadsRemaining + project.ratingRequirements.reduce((sum, requirement) => sum + requirement.completed, 0),
        requiredSquadsRemaining: project.requiredSquadsRemaining,
        remainingRatings: project.ratingRequirements.map((requirement) => ({
          rating: requirement.rating,
          remaining: Math.max(0, requirement.count - requirement.completed),
          clubCount: ratingCounts[requirement.rating] || 0,
          covered: (ratingCounts[requirement.rating] || 0) >= Math.max(0, requirement.count - requirement.completed)
        })),
        remainingSpecials: project.specialCardRequirements.map((requirement) => ({
          cardType: requirement.cardType,
          remaining: Math.max(0, requirement.count - requirement.completed) * (requirement.perRemainingSquad ? Math.max(1, project.requiredSquadsRemaining) : 1)
        })),
        protectedRatings: project.protectedRatings,
        completionProgress: project.completionProgress,
        sourceSetId: project.sourceSetId
      }));
    }
    /** Aggregate only explicit hard protection and auditable project demand. */
    getFodderPolicyOverlay() {
      const projects = this.getActiveProjects();
      let protectRatingAtOrAbove = null;
      const protectedExactRatings = /* @__PURE__ */ new Set();
      const protectedPlayerIds = /* @__PURE__ */ new Set();
      const protectedResourceIds = /* @__PURE__ */ new Set();
      const minimumReserveByRating = {};
      const projectRatingDemand = [];
      const specialReserveByCardType = {};
      for (const project of projects) {
        const protectedRatings = project.protectedRatings;
        if (protectedRatings.atOrAbove != null) {
          protectRatingAtOrAbove = protectRatingAtOrAbove == null ? protectedRatings.atOrAbove : Math.min(protectRatingAtOrAbove, protectedRatings.atOrAbove);
        }
        for (const rating of protectedRatings.exact) protectedExactRatings.add(rating);
        for (const id of project.protectedPlayerIds) protectedPlayerIds.add(id);
        for (const id of project.protectedResourceIds) protectedResourceIds.add(id);
        for (const [rating, count] of Object.entries(protectedRatings.reserveByRating)) {
          minimumReserveByRating[rating] = (minimumReserveByRating[rating] || 0) + count;
        }
        for (const requirement of project.ratingRequirements) {
          const remaining = Math.max(0, requirement.count - requirement.completed);
          if (!remaining) continue;
          projectRatingDemand.push({
            projectId: project.id,
            rating: requirement.rating,
            count: remaining,
            priority: project.priority
          });
        }
        for (const requirement of project.specialCardRequirements) {
          const remaining = Math.max(0, requirement.count - requirement.completed);
          const multiplier = requirement.perRemainingSquad ? Math.max(1, project.requiredSquadsRemaining) : 1;
          specialReserveByCardType[requirement.cardType] = (specialReserveByCardType[requirement.cardType] || 0) + remaining * multiplier;
        }
      }
      return {
        protectRatingAtOrAbove,
        protectedExactRatings: [...protectedExactRatings].sort((a, b) => a - b),
        protectedPlayerIds: [...protectedPlayerIds],
        protectedResourceIds: [...protectedResourceIds],
        minimumReserveByRating,
        projectRatingDemand,
        specialReserveByCardType,
        activeProjectIds: projects.map((project) => project.id)
      };
    }
  };

  // src/policies/fodder-policy.js
  var numberOrNull = (value) => {
    if (value === null || value === void 0 || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  var normalizeStrings = (values) => Array.from(
    new Set(
      (Array.isArray(values) ? values : []).filter((value) => value !== null && value !== void 0 && value !== "").map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    )
  );
  var normalizeIds = (values) => new Set(
    (Array.isArray(values) ? values : []).filter((value) => value !== null && value !== void 0 && value !== "").map(String)
  );
  var normalizeReserveMap2 = (value) => {
    const result = /* @__PURE__ */ new Map();
    if (!value || typeof value !== "object") return result;
    for (const [rawRating, rawCount] of Object.entries(value)) {
      const rating = Math.trunc(numberOrNull(rawRating) ?? 0);
      const count = Math.max(0, Math.trunc(numberOrNull(rawCount) ?? 0));
      if (rating >= 1 && rating <= 99 && count > 0) result.set(rating, count);
    }
    return result;
  };
  var getRating = (item) => Math.max(0, numberOrNull(item?.rating) ?? 0);
  var getCardType = (item) => String(
    item?.cardType ?? item?.specialCardGroup ?? item?.rarityGroup ?? item?.rarityName ?? "base"
  ).trim().toLowerCase();
  var BASE_CARD_TYPES = /* @__PURE__ */ new Set([
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
    "rare gold"
  ]);
  var isSpecial = (item) => {
    if (typeof item?.isSpecial === "function") return Boolean(item.isSpecial());
    if (item?.isSpecial != null) return Boolean(item.isSpecial);
    return !BASE_CARD_TYPES.has(getCardType(item));
  };
  var getReplacementCost = (item) => {
    for (const raw of [
      item?.estimatedReplacementCost,
      item?.marketPrice,
      item?.price,
      item?.priceMeta?.price,
      item?.futggPrice
    ]) {
      const parsed = numberOrNull(raw);
      if (parsed != null && parsed >= 0) return parsed;
    }
    return Math.pow(getRating(item), 3);
  };
  var normalizeRange = (value) => {
    if (Array.isArray(value)) {
      return {
        min: Math.max(1, Math.trunc(numberOrNull(value[0]) ?? 1)),
        max: Math.min(99, Math.trunc(numberOrNull(value[1]) ?? 99))
      };
    }
    const source = value && typeof value === "object" ? value : {};
    return {
      min: Math.max(1, Math.trunc(numberOrNull(source.min) ?? 1)),
      max: Math.min(99, Math.trunc(numberOrNull(source.max) ?? 99))
    };
  };
  var mergeReserveMaps = (...maps) => {
    const result = /* @__PURE__ */ new Map();
    for (const map of maps) {
      for (const [rating, count] of map.entries()) {
        result.set(rating, (result.get(rating) || 0) + count);
      }
    }
    return result;
  };
  var mergeSpecialReserveMaps = (...values) => {
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
  var FODDER_OBJECTIVE_FIELDS = Object.freeze([
    "hardRequirementViolations",
    "protectedCardViolations",
    "scarceSpecialUsage",
    "nonExpendableCardUsage",
    "nonDuplicateUsage",
    "nonStorageUsage",
    "tradableUsage",
    "targetProjectDemandPenalty",
    "premiumFodderPenalty",
    "replacementCost",
    "ratingOvershoot"
  ]);
  var FodderPolicy = class {
    constructor(config = {}, { targetProjects = [] } = {}) {
      const projectService = targetProjects instanceof TargetProjectService ? targetProjects : new TargetProjectService(targetProjects);
      const projectOverlay = projectService.getFodderPolicyOverlay();
      const configuredThreshold = numberOrNull(config.protectRatingAtOrAbove);
      const projectThreshold = numberOrNull(projectOverlay.protectRatingAtOrAbove);
      const thresholds = [configuredThreshold, projectThreshold].filter(
        (value) => value != null
      );
      const configuredReserve = normalizeReserveMap2(config.minimumReserveByRating);
      const projectReserve = normalizeReserveMap2(projectOverlay.minimumReserveByRating);
      this.config = Object.freeze({
        protectRatingAtOrAbove: thresholds.length ? Math.min(...thresholds) : null,
        preferredFodderRange: normalizeRange(config.preferredFodderRange),
        protectedCardTypes: Object.freeze(normalizeStrings(config.protectedCardTypes)),
        allowedSpecialTypes: Object.freeze(normalizeStrings(config.allowedSpecialTypes)),
        restrictSpecialTypes: Array.isArray(config.allowedSpecialTypes),
        protectedItemIds: Object.freeze([...normalizeIds(config.protectedItemIds)]),
        protectedPlayerIds: Object.freeze([
          ...normalizeIds(config.protectedPlayerIds),
          ...projectOverlay.protectedPlayerIds
        ]),
        protectedResourceIds: Object.freeze([
          ...normalizeIds(config.protectedResourceIds),
          ...projectOverlay.protectedResourceIds
        ]),
        protectedExactRatings: Object.freeze(
          Array.from(
            /* @__PURE__ */ new Set([
              ...Array.isArray(config.protectedRatings) ? config.protectedRatings : [],
              ...projectOverlay.protectedExactRatings
            ])
          ).map((rating) => Math.trunc(numberOrNull(rating) ?? 0)).filter((rating) => rating >= 1 && rating <= 99)
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
            config.specialReserveByCardType
          )
        ),
        projectRatingDemand: Object.freeze(projectOverlay.projectRatingDemand),
        activeTargetProjectIds: Object.freeze(projectOverlay.activeProjectIds)
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
      if (isSpecial(item) && this.config.restrictSpecialTypes && !allowedSpecialTypes.has(cardType)) {
        reasons.push("special-type-not-allowed");
      }
      if (this.config.protectStartingSquad && (item?.isInStartingSquad || item?.isInActive11)) {
        reasons.push("starting-squad");
      }
      if (this.config.protectFavorites && (item?.isFavorite || item?.isFavourite)) {
        reasons.push("favorite");
      }
      if (this.config.protectTradables && (item?.isTradable === true || item?.isUntradeable === false)) {
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
        getReplacementCost(item)
      ];
    }
    analyze(items) {
      const normalizedItems = normalizeOwnedItems(items).map((item) => ({
        ...item,
        id: item.id ?? item.itemId
      }));
      const reasons = new Map(
        normalizedItems.map((item) => [item.itemId, this.#baseReasons(item)])
      );
      const protectedItemIds = normalizedItems.filter((item) => (reasons.get(item.itemId) || []).length > 0).map((item) => item.itemId);
      const protectedIdSet = new Set(protectedItemIds);
      return {
        items: normalizedItems,
        protectedItemIds,
        protectedIds: protectedItemIds,
        eligibleItems: normalizedItems.filter(
          (item) => !protectedIdSet.has(item.itemId)
        ),
        reasonsByItemId: Object.fromEntries(
          [...reasons.entries()].filter(([, itemReasons]) => itemReasons.length)
        ),
        activeTargetProjectIds: [...this.config.activeTargetProjectIds]
      };
    }
    /**
     * Return a serializable soft-conservation policy for the production solver.
     * Hard protection stays in `protectedItemIds`; reserves are intentionally
     * soft so a valid SBC is not reported impossible merely to conserve fodder.
     */
    toSolverConservationPolicy() {
      return {
        enabled: true,
        objectiveFields: [...FODDER_OBJECTIVE_FIELDS],
        preferDuplicates: this.config.preferDuplicates,
        preferSbcStorage: this.config.preferSbcStorage,
        preferUntradeables: this.config.preferUntradeables,
        preferredFodderRange: { ...this.config.preferredFodderRange },
        minimumReserveByRating: Object.fromEntries(this.config.minimumReserveByRating),
        specialReserveByCardType: { ...this.config.specialReserveByCardType },
        projectRatingDemand: this.config.projectRatingDemand.map((entry) => ({ ...entry }))
      };
    }
    getProtectedItemIds(items) {
      return this.analyze(items).protectedItemIds;
    }
    getSquadObjectiveTuple(squad, {
      allItems = squad,
      hardRequirementViolations = 0,
      targetRating = null,
      analysis = null
    } = {}) {
      const policyAnalysis = analysis || this.analyze(allItems);
      const protectedIds = new Set(policyAnalysis.protectedItemIds);
      const protectedCardViolations = squad.filter((item) => {
        const id = getOwnedItemId(item);
        return id != null && protectedIds.has(id);
      }).length;
      let scarceSpecialUsage = 0;
      let nonExpendableCardUsage = 0;
      let nonDuplicateUsage = 0;
      let nonStorageUsage = 0;
      let tradableUsage = 0;
      let targetProjectDemandPenalty = 0;
      let premiumFodderPenalty = 0;
      let replacementCost = 0;
      for (const item of squad) {
        const type = getCardType(item);
        const rating = getRating(item);
        const reserve = numberOrNull(this.config.specialReserveByCardType[type]) ?? 0;
        if (reserve > 0 && isSpecial(item)) scarceSpecialUsage += reserve;
        if (isSpecial(item)) nonExpendableCardUsage += 1;
        if (this.config.preferDuplicates && !item?.isDuplicate) nonDuplicateUsage += 1;
        if (this.config.preferSbcStorage && !item?.isStorage) nonStorageUsage += 1;
        if (this.config.preferUntradeables && !item?.isUntradeable) tradableUsage += 1;
        const preferredMax = this.config.preferredFodderRange.max;
        if (rating > preferredMax) premiumFodderPenalty += Math.pow(rating - preferredMax, 2);
        for (const demand of this.config.projectRatingDemand) {
          if (rating >= demand.rating) {
            targetProjectDemandPenalty += (rating - demand.rating + 1) * demand.count * Math.max(1, demand.priority);
          }
        }
        const ratingReserve = this.config.minimumReserveByRating.get(rating) || 0;
        if (ratingReserve > 0) targetProjectDemandPenalty += ratingReserve;
        replacementCost += getReplacementCost(item);
      }
      let ratingOvershoot = 0;
      if (targetRating != null && squad.length === FC26_SQUAD_SIZE) {
        ratingOvershoot = Math.max(
          0,
          calculateFc26SquadRating(squad.map((item) => getRating(item))) - Number(targetRating)
        );
      }
      return Object.freeze([
        Math.max(0, Math.trunc(numberOrNull(hardRequirementViolations) ?? 0)),
        protectedCardViolations,
        scarceSpecialUsage,
        nonExpendableCardUsage,
        nonDuplicateUsage,
        nonStorageUsage,
        tradableUsage,
        targetProjectDemandPenalty,
        premiumFodderPenalty,
        replacementCost,
        ratingOvershoot
      ]);
    }
    explainSelection(selectedItemIds, items, { targetRating = null } = {}) {
      const selected3 = new Set((selectedItemIds || []).map(String));
      const normalized = normalizeOwnedItems(items);
      const analysis = this.analyze(normalized);
      const explanations = [];
      for (const item of normalized.filter((entry) => selected3.has(entry.itemId))) {
        const rating = getRating(item);
        const location2 = item.isStorage ? " from SBC Storage" : "";
        const ownership = item.isUntradeable ? " untradeable" : item.isTradable ? " tradable" : "";
        const duplicate = item.isDuplicate ? " duplicate" : "";
        explanations.push(`Used ${rating || "unrated"}${duplicate}${ownership}${location2}`);
      }
      for (const item of normalized.filter((entry) => !selected3.has(entry.itemId))) {
        const hardReasons = analysis.reasonsByItemId[item.itemId] || [];
        const rating = getRating(item);
        if (hardReasons.length) {
          explanations.push(`Preserved ${rating || "unrated"} because ${hardReasons[0].replaceAll("-", " ")}`);
          continue;
        }
        const type = getCardType(item);
        if ((this.config.specialReserveByCardType[type] || 0) > 0) {
          explanations.push(`Preserved ${rating || "unrated"} ${type.toUpperCase()} because its special reserve is active`);
        } else if (this.config.projectRatingDemand.some((demand) => rating >= demand.rating)) {
          explanations.push(`Preserved ${rating || "unrated"} because an active Target Project needs high-rated fodder`);
        }
        if (explanations.length >= 8) break;
      }
      const tuple = this.getSquadObjectiveTuple(
        normalized.filter((entry) => selected3.has(entry.itemId)),
        { allItems: normalized, targetRating, analysis }
      );
      return { explanations: explanations.slice(0, 8), objectiveFields: [...FODDER_OBJECTIVE_FIELDS], objectiveTuple: [...tuple] };
    }
  };

  // src/application/goals.js
  var GoalKind = Object.freeze({
    COMPLETE_SBC: "complete_sbc",
    GRIND_UPGRADES: "grind_upgrades",
    CLEAR_DUPLICATES: "clear_duplicates",
    OPTIMIZE_FODDER: "optimize_fodder",
    PLAN_EVOLUTION: "plan_evolution",
    OPTIMIZE_CLUB: "optimize_club"
  });
  var createGoal = ({ kind, intent, inputs = {}, createdAt = Date.now() }) => {
    if (!Object.values(GoalKind).includes(kind)) throw new TypeError(`Unknown goal kind: ${kind}`);
    const normalized = { kind, intent: String(intent || kind), inputs, createdAt: Math.max(0, Number(createdAt) || 0) };
    return cloneAndFreeze({ id: stableFingerprint(normalized), ...normalized });
  };

  // src/application/fodder-review.js
  var FODDER_REVIEW_KIND = "PROTECTION_REVIEW_V1";
  var FODDER_REVIEW_SAFETY_BOUNDARY = "READ_ONLY_NO_EXECUTION";
  var FODDER_REVIEW_CAPABILITIES = Object.freeze(["ea.inventory.read"]);
  var FODDER_REVIEW_LIMITS = Object.freeze({
    maxItems: 5e3,
    maxActiveProjects: 100,
    maxExamplesPerReason: 5,
    maxSpecialReserveSignals: 100,
    maxSignalsPerProject: 12,
    maxProjectNameLength: 120
  });
  var FodderReviewVerificationState = Object.freeze({
    VERIFIED: "verified",
    UNVERIFIED: "unverified"
  });
  var REASON_DEFINITIONS = Object.freeze([
    ["locked-item", "EA item lock", "ea_item"],
    ["protected-item-flag", "EA protected-item flag", "ea_item"],
    ["protected-item", "Protected owned card", "user_policy"],
    ["protected-player", "Protected footballer", "user_or_project_policy"],
    ["protected-resource", "Protected card version", "user_or_project_policy"],
    ["protected-rating", "Protected rating threshold", "user_or_project_policy"],
    ["target-project-rating", "Target Project exact rating", "target_project"],
    ["protected-card-type", "Protected card type", "user_policy"],
    ["special-type-not-allowed", "Special type is not allowed", "user_policy"],
    ["starting-squad", "Active Squad protection", "safety_invariant"],
    ["favorite", "Favorite-card protection", "user_policy"],
    ["tradable", "Tradable-card protection", "user_policy"]
  ]);
  var REASON_ORDER = new Map(REASON_DEFINITIONS.map(([code], index) => [code, index]));
  var REASON_META = new Map(
    REASON_DEFINITIONS.map(([code, label, source]) => [code, { label, source }])
  );
  var FIELD_LABELS = Object.freeze({
    locked: "item-lock",
    protected: "protected-item",
    favorite: "favorite-card",
    special: "special-card",
    tradability: "tradability",
    startingSquad: "Active Squad"
  });
  var normalizeState = (value) => {
    const raw = value && typeof value === "object" ? value.state : value;
    return String(raw || "unverified").trim().toLowerCase() === "verified" ? FodderReviewVerificationState.VERIFIED : FodderReviewVerificationState.UNVERIFIED;
  };
  var normalizeActiveSquadEvidence = (value = {}) => ({
    state: normalizeState(value),
    mode: value?.mode == null ? null : String(value.mode)
  });
  var canonicalSourceEvidence = (sourceEvidence = {}) => {
    const fields = sourceEvidence?.fields || {};
    return {
      schemaVersion: Math.max(0, Number(sourceEvidence?.schemaVersion || 0)),
      fields: Object.fromEntries(
        Object.keys(FIELD_LABELS).sort().map((field) => [field, normalizeState(fields[field])])
      ),
      activeSquadProtection: normalizeActiveSquadEvidence(
        sourceEvidence?.activeSquadProtection
      ),
      loansIncluded: sourceEvidence?.loansIncluded === true
    };
  };
  var toSortedUniqueStrings = (values) => [...new Set((Array.isArray(values) ? values : []).map(String))].sort();
  var canonicalMapEntries = (value) => {
    const entries = value instanceof Map ? [...value.entries()] : value && typeof value === "object" ? Object.entries(value) : [];
    return entries.map(([key, entry]) => [String(key), Number(entry) || 0]).sort(([left], [right]) => left.localeCompare(right));
  };
  var canonicalProjectDemand = (value) => (Array.isArray(value) ? value : []).map((entry) => ({
    projectId: String(entry?.projectId || ""),
    rating: Number(entry?.rating || 0),
    count: Math.max(0, Number(entry?.count || 0)),
    priority: Math.max(0, Number(entry?.priority || 0))
  })).sort((left, right) => left.projectId.localeCompare(right.projectId) || left.rating - right.rating || left.count - right.count || left.priority - right.priority);
  var canonicalPolicy = (policy) => {
    const config = policy?.config || {};
    return {
      protectRatingAtOrAbove: config.protectRatingAtOrAbove ?? null,
      preferredFodderRange: {
        min: Number(config.preferredFodderRange?.min || 0),
        max: Number(config.preferredFodderRange?.max || 0)
      },
      protectedCardTypes: toSortedUniqueStrings(config.protectedCardTypes),
      allowedSpecialTypes: toSortedUniqueStrings(config.allowedSpecialTypes),
      restrictSpecialTypes: config.restrictSpecialTypes === true,
      protectedItemIds: toSortedUniqueStrings(config.protectedItemIds),
      protectedPlayerIds: toSortedUniqueStrings(config.protectedPlayerIds),
      protectedResourceIds: toSortedUniqueStrings(config.protectedResourceIds),
      protectedExactRatings: [...new Set(config.protectedExactRatings || [])].map(Number).sort((left, right) => left - right),
      protectStartingSquad: config.protectStartingSquad === true,
      protectFavorites: config.protectFavorites === true,
      protectTradables: config.protectTradables === true,
      preferUntradeables: config.preferUntradeables === true,
      preferDuplicates: config.preferDuplicates === true,
      preferSbcStorage: config.preferSbcStorage === true,
      minimumReserveByRating: canonicalMapEntries(config.minimumReserveByRating),
      specialReserveByCardType: canonicalMapEntries(config.specialReserveByCardType),
      projectRatingDemand: canonicalProjectDemand(config.projectRatingDemand),
      activeTargetProjectIds: toSortedUniqueStrings(config.activeTargetProjectIds)
    };
  };
  var canonicalInventory2 = (snapshot = {}) => ({
    storageCapacity: snapshot?.storageCapacity ?? null,
    items: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => ({
      itemId: String(item?.itemId ?? item?.id ?? ""),
      resourceId: item?.resourceId == null ? null : String(item.resourceId),
      baseId: item?.baseId ?? item?.basePlayerId ?? null,
      assetId: item?.assetId ?? null,
      location: item?.location ?? null,
      rating: Number(item?.rating || 0),
      cardType: item?.cardType ?? null,
      rarityName: item?.rarityName ?? null,
      isSpecial: item?.isSpecial ?? null,
      isTradable: item?.isTradable ?? item?.isTradeable ?? null,
      isDuplicate: item?.isDuplicate ?? null,
      isStorage: item?.isStorage ?? null,
      isLocked: item?.isLocked ?? item?.locked ?? null,
      isProtected: item?.isProtected ?? null,
      isFavorite: item?.isFavorite ?? item?.isFavourite ?? null,
      isInStartingSquad: item?.isInStartingSquad ?? item?.isInActive11 ?? null,
      hasTradabilityEvidence: item?.hasTradabilityEvidence ?? null,
      hasLockedEvidence: item?.hasLockedEvidence ?? null,
      hasProtectedEvidence: item?.hasProtectedEvidence ?? null,
      hasFavoriteEvidence: item?.hasFavoriteEvidence ?? null,
      hasStartingSquadEvidence: item?.hasStartingSquadEvidence ?? null,
      hasSpecialEvidence: item?.hasSpecialEvidence ?? null,
      hasMovableEvidence: item?.hasMovableEvidence ?? null,
      hasStorableEvidence: item?.hasStorableEvidence ?? null
    })).sort((left, right) => left.itemId.localeCompare(right.itemId))
  });
  var sortCanonicalArray = (values) => (Array.isArray(values) ? values : []).map((value) => canonicalValue(value)).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  var canonicalValue = (value) => {
    if (Array.isArray(value)) return sortCanonicalArray(value);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  };
  var getActiveProjects = (targetProjects) => {
    if (targetProjects instanceof TargetProjectService) {
      return targetProjects.getActiveProjects();
    }
    return new TargetProjectService(Array.isArray(targetProjects) ? targetProjects : []).getActiveProjects();
  };
  var canonicalProjects = (projects) => sortCanonicalArray(projects).sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
  var canonicalCapabilityEvidence = (evidence) => {
    if (!evidence || typeof evidence !== "object") return null;
    const keys = ["kind", "source", "schemaVersion", "adapterVersion", "mode"];
    const result = Object.fromEntries(
      keys.filter((key) => evidence[key] != null).map((key) => [key, evidence[key]])
    );
    return Object.keys(result).length ? canonicalValue(result) : null;
  };
  var canonicalCapabilities2 = (snapshot = {}) => ({
    capabilities: (Array.isArray(snapshot?.capabilities) ? snapshot.capabilities : []).filter((entry) => FODDER_REVIEW_CAPABILITIES.includes(entry?.id)).map((entry) => ({
      id: String(entry.id),
      state: String(entry.state || "unverified"),
      evidence: canonicalCapabilityEvidence(entry.evidence)
    })).sort((left, right) => left.id.localeCompare(right.id))
  });
  var buildFodderReviewFingerprints = ({
    gameContext,
    inventorySnapshot,
    policy,
    targetProjects = [],
    capabilitySnapshot,
    sourceEvidence
  } = {}) => {
    if (!(policy instanceof FodderPolicy)) {
      throw new TypeError("Fodder review requires a FodderPolicy");
    }
    const projects = getActiveProjects(targetProjects);
    const components = {
      game: stableFingerprint({
        gameVersion: gameContext?.gameVersion ?? null,
        state: gameContext?.state ?? null
      }),
      inventory: stableFingerprint(canonicalInventory2(inventorySnapshot)),
      policy: stableFingerprint(canonicalPolicy(policy)),
      projects: stableFingerprint(canonicalProjects(projects)),
      capabilities: stableFingerprint(canonicalCapabilities2(capabilitySnapshot)),
      sourceEvidence: stableFingerprint(canonicalSourceEvidence(sourceEvidence))
    };
    return cloneAndFreeze({
      ...components,
      combined: stableFingerprint(components),
      inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0))
    });
  };
  var getCardType2 = (item) => String(
    item?.cardType ?? item?.specialCardGroup ?? item?.rarityGroup ?? item?.rarityName ?? "base"
  ).trim().toLowerCase();
  var locationCounts = (items) => {
    const counts = { club: 0, sbcStorage: 0, unassigned: 0 };
    for (const item of items) {
      if (item?.location === "club") counts.club += 1;
      else if (item?.location === "sbc_storage" || item?.isStorage === true) counts.sbcStorage += 1;
      else if (item?.location === "unassigned") counts.unassigned += 1;
    }
    return counts;
  };
  var parseObservedAt = (value) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  var boundedText = (value, maxLength) => String(value || "").slice(0, maxLength);
  var buildProjectSignals = (projects, { maxSignalsPerProject, maxProjectNameLength }) => projects.map((project) => {
    const hardExclusions = [];
    if (project.protectedRatings?.atOrAbove != null) {
      hardExclusions.push(`${project.protectedRatings.atOrAbove}+ rating threshold`);
    }
    for (const rating of project.protectedRatings?.exact || []) {
      hardExclusions.push(`Exact ${rating} rating`);
    }
    const reserveEntries = Object.entries(project.protectedRatings?.reserveByRating || {});
    if (project.protectedPlayerIds?.length) {
      hardExclusions.push(`${project.protectedPlayerIds.length} protected footballer${project.protectedPlayerIds.length === 1 ? "" : "s"}`);
    }
    if (project.protectedResourceIds?.length) {
      hardExclusions.push(`${project.protectedResourceIds.length} protected card version${project.protectedResourceIds.length === 1 ? "" : "s"}`);
    }
    const conservationPreferences = reserveEntries.map(([rating, count]) => `Keep ${count} at ${rating} rating`);
    for (const requirement of project.ratingRequirements || []) {
      const remaining = Math.max(0, Number(requirement.count || 0) - Number(requirement.completed || 0));
      if (remaining > 0) conservationPreferences.push(
        `${remaining} remaining ${requirement.rating}-rated squad signal${remaining === 1 ? "" : "s"}`
      );
    }
    for (const requirement of project.specialCardRequirements || []) {
      const remaining = Math.max(0, Number(requirement.count || 0) - Number(requirement.completed || 0));
      if (remaining > 0) conservationPreferences.push(
        `Keep ${remaining} ${String(requirement.cardType).toUpperCase()} special signal${remaining === 1 ? "" : "s"}`
      );
    }
    const unknownRequirementCount = (project.sourceChallenges || []).reduce(
      (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
      0
    );
    return {
      name: boundedText(project.name || "Target Project", maxProjectNameLength),
      hardExclusions: hardExclusions.slice(0, maxSignalsPerProject),
      conservationPreferences: conservationPreferences.slice(0, maxSignalsPerProject),
      unknownRequirementCount
    };
  });
  var buildCoverage = (policy, sourceEvidence) => {
    const evidence = canonicalSourceEvidence(sourceEvidence);
    const required = /* @__PURE__ */ new Set(["locked", "protected"]);
    if (policy.config.protectFavorites) required.add("favorite");
    if (policy.config.protectTradables) required.add("tradability");
    if (policy.config.restrictSpecialTypes || Object.keys(policy.config.specialReserveByCardType || {}).length > 0) {
      required.add("special");
    }
    if (policy.config.protectStartingSquad && evidence.activeSquadProtection.state !== FodderReviewVerificationState.VERIFIED) {
      required.add("startingSquad");
    }
    const missingFields = [...required].filter((field) => evidence.fields[field] !== FodderReviewVerificationState.VERIFIED).sort();
    const warnings = missingFields.map((field) => `${FIELD_LABELS[field] || field} evidence is UNVERIFIED; cards without a known hard reason are not classified as safe fodder.`);
    return {
      evidence,
      missingFields,
      warnings,
      state: missingFields.length ? FodderReviewVerificationState.UNVERIFIED : FodderReviewVerificationState.VERIFIED
    };
  };
  var emptyPreview = ({ itemCount, projectCount, warnings }) => ({
    kind: FODDER_REVIEW_KIND,
    safetyBoundary: FODDER_REVIEW_SAFETY_BOUNDARY,
    readOnly: true,
    canApprove: false,
    verificationState: FodderReviewVerificationState.UNVERIFIED,
    analyzedItemCount: 0,
    observedItemCount: itemCount,
    observedAt: null,
    activeProjectCount: projectCount,
    uniqueHardProtectedCount: 0,
    notHardProtectedCount: null,
    reasonGroups: [],
    projectSignals: [],
    softConservation: {
      ratingReserves: [],
      specialReserves: [],
      projectRatingDemand: [],
      preferences: {},
      activeTargetProjectIds: []
    },
    sourceCoverage: null,
    warnings,
    limits: { ...FODDER_REVIEW_LIMITS }
  });
  var summarizeFodderReview = ({
    inventorySnapshot,
    policy,
    targetProjects = [],
    sourceEvidence = {},
    limits = FODDER_REVIEW_LIMITS
  } = {}) => {
    if (!(policy instanceof FodderPolicy)) {
      throw new TypeError("Fodder review requires a FodderPolicy");
    }
    const items = Array.isArray(inventorySnapshot?.items) ? inventorySnapshot.items : [];
    const projects = getActiveProjects(targetProjects);
    const boundedLimit = (value, fallback, minimum) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(fallback, Math.max(minimum, Math.trunc(parsed)));
    };
    const maxItems = boundedLimit(
      limits?.maxItems,
      FODDER_REVIEW_LIMITS.maxItems,
      1
    );
    const maxActiveProjects = boundedLimit(
      limits?.maxActiveProjects,
      FODDER_REVIEW_LIMITS.maxActiveProjects,
      1
    );
    const maxExamples = boundedLimit(
      limits?.maxExamplesPerReason,
      FODDER_REVIEW_LIMITS.maxExamplesPerReason,
      0
    );
    const maxSignalsPerProject = boundedLimit(
      limits?.maxSignalsPerProject,
      FODDER_REVIEW_LIMITS.maxSignalsPerProject,
      0
    );
    const maxProjectNameLength = boundedLimit(
      limits?.maxProjectNameLength,
      FODDER_REVIEW_LIMITS.maxProjectNameLength,
      1
    );
    const maxSpecialReserveSignals = boundedLimit(
      limits?.maxSpecialReserveSignals,
      FODDER_REVIEW_LIMITS.maxSpecialReserveSignals,
      1
    );
    const conservation = policy.toSolverConservationPolicy();
    const blockers = [];
    if (items.length > maxItems) {
      blockers.push({
        code: "REVIEW_INPUT_TOO_LARGE",
        message: `Protection Review supports at most ${maxItems} inventory items without truncation.`
      });
    }
    if (projects.length > maxActiveProjects) {
      blockers.push({
        code: "REVIEW_INPUT_TOO_LARGE",
        message: `Protection Review supports at most ${maxActiveProjects} active projects without truncation.`
      });
    }
    if (Object.keys(conservation.specialReserveByCardType || {}).length > maxSpecialReserveSignals) {
      blockers.push({
        code: "REVIEW_INPUT_TOO_LARGE",
        message: `Protection Review supports at most ${maxSpecialReserveSignals} special-card reserve signals without truncation.`
      });
    }
    if (blockers.length) {
      return cloneAndFreeze({
        blockers,
        preview: emptyPreview({
          itemCount: items.length,
          projectCount: projects.length,
          warnings: blockers.map((blocker) => blocker.message)
        })
      });
    }
    const analysis = policy.analyze(items);
    const byId = new Map(analysis.items.map((item) => [String(item.itemId), item]));
    const groups = /* @__PURE__ */ new Map();
    for (const [itemId, reasons] of Object.entries(analysis.reasonsByItemId)) {
      const item = byId.get(String(itemId));
      for (const code of reasons) {
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push({ itemId: String(itemId), item });
      }
    }
    const reasonGroups = [...groups.entries()].sort(([left], [right]) => (REASON_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) - (REASON_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right)).map(([code, entries]) => {
      const meta = REASON_META.get(code) || {
        label: code.replaceAll("-", " "),
        source: "policy"
      };
      const sorted = entries.sort((left, right) => left.itemId.localeCompare(right.itemId));
      return {
        code,
        label: meta.label,
        source: meta.source,
        itemCount: sorted.length,
        examples: sorted.slice(0, maxExamples).map(({ item }) => ({
          name: item?.name == null ? null : String(item.name),
          rating: Number(item?.rating || 0),
          location: item?.location ?? (item?.isStorage ? "sbc_storage" : null),
          cardType: getCardType2(item)
        }))
      };
    });
    const coverage = buildCoverage(policy, sourceEvidence);
    const ratingReserves = Object.entries(conservation.minimumReserveByRating || {}).map(([rating, reserved]) => {
      const matches = analysis.items.filter((item) => Number(item?.rating || 0) === Number(rating));
      return {
        rating: Number(rating),
        reserved: Math.max(0, Number(reserved || 0)),
        observedCount: matches.length,
        observedByLocation: locationCounts(matches),
        signal: "soft_conservation"
      };
    }).sort((left, right) => left.rating - right.rating);
    const specialReserves = Object.entries(conservation.specialReserveByCardType || {}).map(([cardType, reserved]) => {
      const normalizedType = String(cardType).trim().toLowerCase();
      const matches = analysis.items.filter((item) => item?.isSpecial === true && getCardType2(item) === normalizedType);
      return {
        cardType: normalizedType,
        reserved: Math.max(0, Number(reserved || 0)),
        observedCount: coverage.evidence.fields.special === FodderReviewVerificationState.VERIFIED ? matches.length : null,
        observedByLocation: coverage.evidence.fields.special === FodderReviewVerificationState.VERIFIED ? locationCounts(matches) : null,
        signal: "soft_conservation"
      };
    }).sort((left, right) => left.cardType.localeCompare(right.cardType));
    const projectWarnings = projects.flatMap((project) => {
      const unknown = (project.sourceChallenges || []).reduce(
        (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
        0
      );
      return unknown > 0 ? [`Target Project ${project.name} has ${unknown} unknown requirement${unknown === 1 ? "" : "s"}; its conservation signals are incomplete.`] : [];
    });
    const projectSignals = buildProjectSignals(projects, {
      maxSignalsPerProject,
      maxProjectNameLength
    });
    const warnings = [...coverage.warnings, ...projectWarnings];
    return cloneAndFreeze({
      blockers: [],
      preview: {
        kind: FODDER_REVIEW_KIND,
        safetyBoundary: FODDER_REVIEW_SAFETY_BOUNDARY,
        readOnly: true,
        canApprove: false,
        verificationState: coverage.state,
        analyzedItemCount: analysis.items.length,
        observedItemCount: items.length,
        observedAt: parseObservedAt(inventorySnapshot?.updatedAt),
        activeProjectCount: projects.length,
        uniqueHardProtectedCount: analysis.protectedItemIds.length,
        notHardProtectedCount: coverage.state === FodderReviewVerificationState.VERIFIED ? analysis.eligibleItems.length : null,
        reasonGroups,
        projectSignals,
        softConservation: {
          ratingReserves,
          specialReserves,
          projectRatingDemand: canonicalProjectDemand(conservation.projectRatingDemand),
          preferences: {
            preferDuplicates: conservation.preferDuplicates === true,
            preferSbcStorage: conservation.preferSbcStorage === true,
            preferUntradeables: conservation.preferUntradeables === true,
            preferredFodderRange: { ...conservation.preferredFodderRange }
          },
          activeTargetProjectIds: toSortedUniqueStrings(analysis.activeTargetProjectIds)
        },
        sourceCoverage: coverage.evidence,
        warnings,
        limits: {
          maxItems,
          maxActiveProjects,
          maxExamplesPerReason: maxExamples,
          maxSignalsPerProject,
          maxProjectNameLength,
          maxSpecialReserveSignals
        }
      }
    });
  };
  var buildFodderReview = ({
    gameContext,
    inventorySnapshot,
    policy,
    targetProjects = [],
    capabilitySnapshot,
    sourceEvidence,
    limits
  } = {}) => {
    const summary = summarizeFodderReview({
      inventorySnapshot,
      policy,
      targetProjects,
      sourceEvidence,
      limits
    });
    return cloneAndFreeze({
      requiredCapabilities: [...FODDER_REVIEW_CAPABILITIES],
      blockers: summary.blockers,
      fingerprints: buildFodderReviewFingerprints({
        gameContext,
        inventorySnapshot,
        policy,
        targetProjects,
        capabilitySnapshot,
        sourceEvidence
      }),
      explanation: [
        "This review reports current hard protections and soft conservation signals.",
        "It does not select fodder, optimize an SBC, change cards, or create an executable workflow."
      ],
      preview: summary.preview,
      steps: []
    });
  };

  // src/application/fc27-streamlined.js
  var FC27_STREAMLINED_LIMITS = Object.freeze({
    maxBytes: 64 * 1024,
    maxDepth: 8,
    maxObjectKeys: 24,
    maxSourcesPerField: 16,
    maxUnmappedEvidence: 32,
    maxStringBytes: 128,
    maxScore: 1e9
  });
  var Fc27EvidenceState = Object.freeze({
    VERIFIED: "VERIFIED",
    UNVERIFIED: "UNVERIFIED",
    UNKNOWN: "UNKNOWN"
  });
  var Fc27EvidenceSourceKind = Object.freeze({
    REVIEWED_FIXTURE: "REVIEWED_FIXTURE",
    UNREVIEWED_FIXTURE: "UNREVIEWED_FIXTURE",
    LIVE_OBSERVATION: "LIVE_OBSERVATION"
  });
  var Fc27EvidenceReason = Object.freeze({
    REVIEWED_FIXTURE_MATCH: "REVIEWED_FIXTURE_MATCH",
    UNREVIEWED_OBSERVATION: "UNREVIEWED_OBSERVATION",
    SHAPE_UNCLASSIFIED: "SHAPE_UNCLASSIFIED",
    FIXTURE_INSUFFICIENT: "FIXTURE_INSUFFICIENT",
    CONFLICTING_OBSERVATIONS: "CONFLICTING_OBSERVATIONS",
    ADAPTER_UNVERIFIED: "ADAPTER_UNVERIFIED",
    NOT_OBSERVED: "NOT_OBSERVED",
    FIELD_ABSENT: "FIELD_ABSENT"
  });
  var Fc27ChallengeClassification = Object.freeze({
    STREAMLINED_SCORE: "STREAMLINED_SCORE"
  });
  var Fc27UnmappedEvidenceType = Object.freeze({
    SCALAR: "SCALAR",
    ARRAY: "ARRAY",
    OBJECT: "OBJECT"
  });
  var Fc27ObservedValueKind = Object.freeze({
    CLASSIFICATION: "CLASSIFICATION",
    SAFE_ID: "SAFE_ID",
    SCORE: "SCORE",
    BOOLEAN: "BOOLEAN",
    RULE_SET_REF: "RULE_SET_REF",
    SCORE_MODEL_VERSION: "SCORE_MODEL_VERSION",
    RATING: "RATING",
    STRING_LIST: "STRING_LIST"
  });
  var VERIFIED_REASONS = Object.freeze([Fc27EvidenceReason.REVIEWED_FIXTURE_MATCH]);
  var UNVERIFIED_REASONS = Object.freeze([
    Fc27EvidenceReason.UNREVIEWED_OBSERVATION,
    Fc27EvidenceReason.SHAPE_UNCLASSIFIED,
    Fc27EvidenceReason.FIXTURE_INSUFFICIENT,
    Fc27EvidenceReason.CONFLICTING_OBSERVATIONS,
    Fc27EvidenceReason.ADAPTER_UNVERIFIED
  ]);
  var UNKNOWN_REASONS = Object.freeze([
    Fc27EvidenceReason.NOT_OBSERVED,
    Fc27EvidenceReason.FIELD_ABSENT
  ]);
  var FIELD_KINDS = Object.freeze({
    classification: Fc27ObservedValueKind.CLASSIFICATION,
    setId: Fc27ObservedValueKind.SAFE_ID,
    challengeId: Fc27ObservedValueKind.SAFE_ID,
    targetScore: Fc27ObservedValueKind.SCORE,
    currentScore: Fc27ObservedValueKind.SCORE,
    eligibility: Fc27ObservedValueKind.RULE_SET_REF,
    rarityRules: Fc27ObservedValueKind.RULE_SET_REF,
    allowsDuplicates: Fc27ObservedValueKind.BOOLEAN,
    allowsPartialSubmission: Fc27ObservedValueKind.BOOLEAN,
    scoreModelVersion: Fc27ObservedValueKind.SCORE_MODEL_VERSION
  });
  var ROOT_KEYS = Object.freeze([
    "schemaVersion",
    "contract",
    "observationId",
    "gameVersion",
    ...Object.keys(FIELD_KINDS),
    "unmappedEvidence",
    "adapterVersion",
    "eaBuild",
    "observedAt",
    "fingerprint"
  ]);

  // src/application/game-context.js
  var GameVersion = Object.freeze({ FC26: "fc26", FC27: "fc27", UNKNOWN: "unknown" });
  var GameContextState = Object.freeze({ VERIFIED: "verified", UNVERIFIED: "unverified" });
  var GameChallengeKind = Object.freeze({
    CLASSIC_SQUAD: "classic_squad",
    STREAMLINED_SCORE: "streamlined_score",
    UNKNOWN: "unknown"
  });
  var GameVersionObservation = Object.freeze({
    OBSERVED: "observed",
    COMPATIBILITY_DEFAULT: "compatibility_default",
    UNVERIFIED: "unverified"
  });
  var normalizeGameVersion = (value) => {
    const normalized = String(value || "").trim().toLowerCase().replaceAll(" ", "");
    if (["fc26", "26", "eafc26"].includes(normalized)) return GameVersion.FC26;
    if (["fc27", "27", "eafc27"].includes(normalized)) return GameVersion.FC27;
    if (["unknown", "unverified"].includes(normalized)) return GameVersion.UNKNOWN;
    throw new TypeError(`Unsupported game version: ${String(value || "missing")}`);
  };
  var createGameContext = ({
    gameVersion = GameVersion.UNKNOWN,
    state,
    challengeKind,
    gameVersionObservation,
    gameVersionSource = null,
    route = null,
    setId = null,
    setName = null,
    challengeId = null,
    challengeName = null,
    observedAt = Date.now(),
    evidence = null
  } = {}) => {
    const version = normalizeGameVersion(gameVersion);
    const requestedState = state || (version === GameVersion.FC26 ? GameContextState.VERIFIED : GameContextState.UNVERIFIED);
    if (!Object.values(GameContextState).includes(requestedState)) {
      throw new TypeError(`Unsupported game-context state: ${requestedState}`);
    }
    const resolvedState = version === GameVersion.FC26 ? requestedState : GameContextState.UNVERIFIED;
    const resolvedChallengeKind = challengeKind == null ? version === GameVersion.FC26 ? GameChallengeKind.CLASSIC_SQUAD : GameChallengeKind.UNKNOWN : String(challengeKind);
    if (!Object.values(GameChallengeKind).includes(resolvedChallengeKind)) {
      throw new TypeError(`Unsupported challenge kind: ${resolvedChallengeKind}`);
    }
    const resolvedObservation = gameVersionObservation || (version === GameVersion.UNKNOWN ? GameVersionObservation.UNVERIFIED : GameVersionObservation.OBSERVED);
    if (!Object.values(GameVersionObservation).includes(resolvedObservation)) {
      throw new TypeError(`Unsupported game-version observation: ${resolvedObservation}`);
    }
    return cloneAndFreeze({
      gameVersion: version,
      state: resolvedState,
      challengeKind: resolvedChallengeKind,
      gameVersionObservation: resolvedObservation,
      gameVersionSource: gameVersionSource == null ? null : String(gameVersionSource),
      route: route == null ? null : String(route),
      setId: setId == null ? null : String(setId),
      setName: setName == null ? null : String(setName),
      challengeId: challengeId == null ? null : String(challengeId),
      challengeName: challengeName == null ? null : String(challengeName),
      observedAt: Math.max(0, Number(observedAt) || 0),
      evidence
    });
  };

  // src/application/game-strategy-registry.js
  var GameStrategyReadiness = Object.freeze({
    VERIFIED: "verified",
    OBSERVE_ONLY: "observe_only",
    UNAVAILABLE: "unavailable"
  });
  var EXECUTABLE_GAME_STRATEGY_VERSIONS = Object.freeze([
    GameVersion.FC26
  ]);
  var isGameStrategyExecutionEnabled = (gameVersion) => EXECUTABLE_GAME_STRATEGY_VERSIONS.includes(normalizeGameVersion(gameVersion));
  var ENTRY_KEYS = /* @__PURE__ */ new Set([
    "id",
    "gameVersion",
    "goalKind",
    "challengeKind",
    "readiness",
    "canCompileSteps",
    "requiredCapabilities",
    "evidenceRevision",
    "strategy"
  ]);
  var identifier = (value, name) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
      throw new TypeError(`Invalid game-strategy ${name}`);
    }
    return normalized;
  };
  var optionalIdentifier = (value, name) => value == null ? null : identifier(value, name);
  var normalizeCapabilities = (value) => {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new TypeError("Game-strategy requiredCapabilities must be an array");
    const capabilities = value.map((entry) => identifier(entry, "capability id"));
    if (new Set(capabilities).size !== capabilities.length) {
      throw new TypeError("Game-strategy requiredCapabilities must be unique");
    }
    return capabilities.sort();
  };
  var normalizeEntry = (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Game-strategy entry must be an object");
    }
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string" || !ENTRY_KEYS.has(key)) {
        throw new TypeError(`Unsupported game-strategy field: ${String(key)}`);
      }
    }
    const gameVersion = normalizeGameVersion(input.gameVersion);
    const goalKind = identifier(input.goalKind, "goal kind");
    const challengeKind = optionalIdentifier(input.challengeKind, "challenge kind");
    const readiness = input.readiness ?? GameStrategyReadiness.VERIFIED;
    if (!Object.values(GameStrategyReadiness).includes(readiness)) {
      throw new TypeError(`Invalid game-strategy readiness: ${String(readiness)}`);
    }
    const strategy = input.strategy ?? null;
    const canCompileSteps = input.canCompileSteps ?? readiness === GameStrategyReadiness.VERIFIED;
    if (typeof canCompileSteps !== "boolean") {
      throw new TypeError("Game-strategy canCompileSteps must be a boolean");
    }
    if (readiness === GameStrategyReadiness.VERIFIED && typeof strategy !== "function") {
      throw new TypeError("A verified game strategy requires a strategy function");
    }
    if (readiness === GameStrategyReadiness.VERIFIED && !isGameStrategyExecutionEnabled(gameVersion)) {
      throw new TypeError(`Executable game strategies are not enabled for ${gameVersion}`);
    }
    if (readiness !== GameStrategyReadiness.VERIFIED && strategy !== null) {
      throw new TypeError("An unverified game strategy cannot contain a strategy function");
    }
    if (readiness !== GameStrategyReadiness.VERIFIED && canCompileSteps) {
      throw new TypeError("An unverified game strategy cannot compile steps");
    }
    return Object.freeze({
      id: identifier(input.id, "id"),
      gameVersion,
      goalKind,
      challengeKind,
      readiness,
      canCompileSteps,
      requiredCapabilities: Object.freeze(normalizeCapabilities(input.requiredCapabilities)),
      evidenceRevision: optionalIdentifier(input.evidenceRevision, "evidence revision"),
      strategy
    });
  };
  var keyFor = (gameVersion, goalKind) => `${gameVersion}\0${goalKind}`;
  var unavailableResolution = ({ gameVersion, goalKind, challengeKind, reason }) => Object.freeze({
    id: null,
    gameVersion,
    goalKind,
    challengeKind,
    readiness: GameStrategyReadiness.UNAVAILABLE,
    canCompileSteps: false,
    requiredCapabilities: Object.freeze([]),
    evidenceRevision: null,
    strategy: null,
    reason
  });
  var gameStrategyMetadata = (resolution) => cloneAndFreeze({
    id: resolution?.id ?? null,
    gameVersion: resolution?.gameVersion ?? GameVersion.UNKNOWN,
    goalKind: resolution?.goalKind ?? null,
    challengeKind: resolution?.challengeKind ?? null,
    readiness: resolution?.readiness ?? GameStrategyReadiness.UNAVAILABLE,
    canCompileSteps: resolution?.canCompileSteps === true,
    evidenceRevision: resolution?.evidenceRevision ?? null
  });
  var GameStrategyRegistry = class {
    #entries = /* @__PURE__ */ new Map();
    constructor(entries = []) {
      if (!Array.isArray(entries)) throw new TypeError("GameStrategyRegistry entries must be an array");
      for (const input of entries) {
        const entry = normalizeEntry(input);
        const key = keyFor(entry.gameVersion, entry.goalKind);
        if (this.#entries.has(key)) {
          throw new TypeError(`Duplicate game strategy for ${entry.gameVersion}/${entry.goalKind}`);
        }
        this.#entries.set(key, entry);
      }
      Object.freeze(this);
    }
    resolve({ gameVersion, goalKind, challengeKind = null } = {}) {
      const normalizedVersion = normalizeGameVersion(gameVersion);
      const normalizedGoalKind = identifier(goalKind, "goal kind");
      const normalizedChallengeKind = optionalIdentifier(challengeKind, "challenge kind");
      const entry = this.#entries.get(keyFor(normalizedVersion, normalizedGoalKind));
      if (!entry) {
        return unavailableResolution({
          gameVersion: normalizedVersion,
          goalKind: normalizedGoalKind,
          challengeKind: normalizedChallengeKind,
          reason: "No local strategy is registered for this game version and goal"
        });
      }
      if (entry.challengeKind !== null && entry.challengeKind !== normalizedChallengeKind) {
        return unavailableResolution({
          gameVersion: normalizedVersion,
          goalKind: normalizedGoalKind,
          challengeKind: normalizedChallengeKind,
          reason: "The observed challenge kind does not match the local strategy"
        });
      }
      return entry;
    }
    snapshot() {
      return cloneAndFreeze([...this.#entries.values()].map(gameStrategyMetadata).sort((left, right) => `${left.gameVersion}:${left.goalKind}`.localeCompare(
        `${right.gameVersion}:${right.goalKind}`
      )));
    }
  };
  var createLegacyFc26StrategyRegistry = (strategies = {}) => {
    if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) {
      throw new TypeError("PlanCompiler strategies must be an object");
    }
    const entries = Object.entries(strategies).flatMap(([goalKind, strategy]) => {
      const normalizedGoalKind = identifier(goalKind, "goal kind");
      return [
        {
          id: `legacy.fc26.${normalizedGoalKind}.v1`,
          gameVersion: GameVersion.FC26,
          goalKind,
          readiness: GameStrategyReadiness.VERIFIED,
          canCompileSteps: true,
          requiredCapabilities: strategy?.requiredCapabilities || [],
          evidenceRevision: "legacy-fc26-v1",
          strategy
        },
        {
          id: `builtin.fc27.${normalizedGoalKind}.observe.v1`,
          gameVersion: GameVersion.FC27,
          goalKind,
          readiness: GameStrategyReadiness.OBSERVE_ONLY,
          canCompileSteps: false,
          requiredCapabilities: [],
          evidenceRevision: "fc27-unverified-observation-v1",
          strategy: null
        }
      ];
    });
    return new GameStrategyRegistry(entries);
  };

  // src/application/plans.js
  var PlanState = Object.freeze({ READY: "ready", BLOCKED: "blocked" });
  var createPlan = ({
    goal,
    gameContext,
    steps = [],
    blockers = [],
    explanation = [],
    fingerprints = null,
    preview = null,
    strategy = null,
    compilerVersion = 1,
    createdAt = Date.now()
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
      compilerVersion
    };
    return cloneAndFreeze({
      id: stableFingerprint(body),
      createdAt: Math.max(0, Number(createdAt) || 0),
      ...body
    });
  };

  // src/application/plan-compiler.js
  var DEFAULT_FEATURES = Object.freeze({
    complete_sbc: Feature.SBC_PROJECTS,
    grind_upgrades: Feature.LOCAL_RECIPES,
    clear_duplicates: Feature.PRODUCT_SHELL,
    optimize_fodder: Feature.PRODUCT_SHELL,
    plan_evolution: Feature.EVOLUTION_PLANNING,
    optimize_club: Feature.CLUB_OPTIMIZATION
  });
  var PlanCompiler = class {
    constructor({
      capabilityRegistry,
      entitlementService,
      strategies = {},
      strategyRegistry = null,
      compilerVersion = 1
    }) {
      this.capabilities = capabilityRegistry;
      this.entitlements = entitlementService;
      if (strategyRegistry != null && typeof strategyRegistry.resolve !== "function") {
        throw new TypeError("PlanCompiler strategyRegistry must provide resolve()");
      }
      this.strategyRegistry = strategyRegistry ?? createLegacyFc26StrategyRegistry(strategies);
      this.compilerVersion = compilerVersion;
    }
    async compile(goal, gameContext) {
      const resolution = this.strategyRegistry.resolve({
        gameVersion: gameContext?.gameVersion,
        goalKind: goal?.kind,
        challengeKind: gameContext?.challengeKind ?? null
      });
      const executionEnabled = isGameStrategyExecutionEnabled(gameContext?.gameVersion);
      const strategy = executionEnabled ? resolution.strategy : null;
      const strategyMetadata = gameStrategyMetadata(resolution);
      const feature = DEFAULT_FEATURES[goal?.kind];
      const entitlement = this.entitlements.check(feature);
      const blockers = [];
      if (!entitlement.entitled) blockers.push({ code: "ENTITLEMENT_REQUIRED", feature, requiredPlan: entitlement.requiredPlan });
      if (resolution.readiness === GameStrategyReadiness.OBSERVE_ONLY) {
        blockers.push({
          code: "GAME_STRATEGY_OBSERVE_ONLY",
          goalKind: goal?.kind,
          gameVersion: gameContext?.gameVersion,
          strategyId: resolution.id
        });
      } else if (!executionEnabled || resolution.readiness !== GameStrategyReadiness.VERIFIED || typeof strategy !== "function") {
        blockers.push({
          code: "GAME_STRATEGY_UNAVAILABLE",
          goalKind: goal?.kind,
          gameVersion: gameContext?.gameVersion
        });
      }
      if (gameContext?.state !== "verified") blockers.push({ code: "GAME_CONTEXT_UNVERIFIED", gameVersion: gameContext?.gameVersion });
      const preflight = this.capabilities.require(resolution.requiredCapabilities || []);
      if (!preflight.ok) {
        blockers.push(...preflight.missing.map((id) => ({ code: "CAPABILITY_UNAVAILABLE", capabilityId: id })));
      }
      if (blockers.length) return createPlan({
        goal,
        gameContext,
        blockers,
        strategy: strategyMetadata,
        compilerVersion: this.compilerVersion
      });
      const draft = await strategy({ goal, gameContext });
      const capabilityCheck = this.capabilities.require(draft.requiredCapabilities || []);
      if (!capabilityCheck.ok) {
        blockers.push(...capabilityCheck.missing.map((id) => ({ code: "CAPABILITY_UNAVAILABLE", capabilityId: id })));
      }
      blockers.push(...draft.blockers || []);
      return createPlan({
        goal,
        gameContext,
        steps: blockers.length ? [] : draft.steps || [],
        blockers,
        explanation: draft.explanation || [],
        fingerprints: draft.fingerprints || null,
        preview: draft.preview || null,
        strategy: strategyMetadata,
        compilerVersion: this.compilerVersion
      });
    }
  };

  // src/application/pro-contracts/auth-provider.js
  var AuthState = Object.freeze({
    CHECKING: "checking",
    AUTHORIZING: "authorizing",
    SIGNED_OUT: "signed_out",
    SIGNED_IN: "signed_in",
    EXPIRED: "expired",
    OFFLINE: "offline",
    ERROR: "error",
    NOT_CONFIGURED: "not_configured"
  });
  var AuthErrorCode = Object.freeze({
    REQUIRED: "AUTH_REQUIRED",
    EXPIRED: "AUTH_EXPIRED",
    NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
    PROVIDER_ERROR: "PROVIDER_ERROR",
    PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED"
  });

  // src/application/pro-contracts/project-optimization.js
  var PROJECT_OPTIMIZATION_STATUS = Object.freeze(["complete", "partial", "infeasible"]);
  var PROJECT_CANDIDATE_LOCATIONS = Object.freeze([
    "club",
    "sbc_storage",
    "unassigned"
  ]);
  var PROJECT_CANDIDATE_TRADABILITY = Object.freeze([
    "tradable",
    "untradeable",
    "unknown"
  ]);
  var PROJECT_SPECIAL_CLASSES = Object.freeze([
    "totw",
    "tots",
    "evolution",
    "icon",
    "hero",
    "promo"
  ]);
  var PROJECT_OPTIMIZATION_REASON_CODES = Object.freeze([
    "coverage_complete",
    "coverage_gap",
    "lower_local_cost",
    "prefer_duplicate",
    "prefer_sbc_storage",
    "prefer_untradeable",
    "preserve_future_flexibility",
    "preserve_scarce_special",
    "no_feasible_allocation"
  ]);
  var PROJECT_OPTIMIZATION_WARNING_CODES = Object.freeze([
    "best_effort_not_proven_optimal",
    "input_near_contract_limit",
    "provider_degraded"
  ]);
  var PROJECT_OPTIMIZATION_OPTIMALITY_STATES = Object.freeze([
    "globally_optimal",
    "best_found",
    "infeasible"
  ]);
  var PROJECT_OPTIMIZATION_LIMITS = Object.freeze({
    maxBytes: 512e3,
    maxDepth: 10,
    maxObjectKeys: 24,
    maxCandidates: 5e3,
    maxProjects: 100,
    maxRequirements: 500,
    maxSpecialRequirementsPerSquad: 8,
    maxReasonCodes: 8,
    maxWarnings: 16,
    maxObjectiveFields: 12,
    maxHandleLength: 80,
    maxFingerprintLength: 128,
    maxModelVersionLength: 64,
    maxTtlMs: 5 * 6e4,
    maxLocalCost: 1e9
  });

  // src/application/pro-contracts/smart-route.js
  var SMART_ROUTE_STATUS = Object.freeze(["proposal", "no_proposal"]);
  var SMART_ROUTE_ACTION_KINDS = Object.freeze([
    "move_to_club",
    "move_to_sbc_storage",
    "hold_for_review",
    "candidate_for_known_recipe",
    "no_action"
  ]);
  var SMART_ROUTE_REASON_CODES = Object.freeze([
    "verified_club_destination",
    "verified_storage_destination",
    "duplicate_pressure",
    "project_reserve",
    "scarce_special",
    "tradable_opportunity_cost",
    "known_recipe_candidate",
    "no_verified_destination",
    "manual_review_required"
  ]);
  var SMART_ROUTE_WARNING_CODES = Object.freeze([
    "input_near_contract_limit",
    "provider_degraded",
    "recommendations_incomplete"
  ]);
  var SMART_ROUTE_LOCATIONS = Object.freeze([
    "club",
    "sbc_storage",
    "unassigned"
  ]);
  var SMART_ROUTE_TRADABILITY = Object.freeze([
    "tradable",
    "untradeable",
    "unknown"
  ]);
  var SMART_ROUTE_SPECIAL_CLASSES = Object.freeze([
    "totw",
    "tots",
    "evolution",
    "icon",
    "hero",
    "promo"
  ]);
  var SMART_ROUTE_DESTINATION_STATES = Object.freeze([
    "verified_available",
    "verified_unavailable",
    "unverified"
  ]);
  var SMART_ROUTE_LIMITS = Object.freeze({
    maxBytes: 256e3,
    maxDepth: 9,
    maxObjectKeys: 24,
    maxCandidates: 100,
    maxKnownRecipesPerCandidate: 32,
    maxProjectDemandSignals: 100,
    maxReasonCodes: 8,
    maxWarnings: 16,
    maxHandleLength: 80,
    maxFingerprintLength: 128,
    maxModelVersionLength: 64,
    maxTtlMs: 2 * 6e4,
    maxLocalCost: 1e9
  });

  // src/application/pro-contracts/cloud-planner-provider.js
  var CloudPlannerOperation = Object.freeze({
    OPTIMIZE_PROJECT: "optimize_project",
    SMART_ROUTE: "smart_route"
  });
  var CLOUD_PLANNER_DEADLINES = Object.freeze({
    MIN_MS: 250,
    DEFAULT_MS: 1e4,
    MAX_MS: 3e4
  });
  var ABORT_KIND = Object.freeze({ EXTERNAL: "external", TIMEOUT: "timeout" });

  // src/application/pro-contracts/compatibility-config.js
  var COMPATIBILITY_CONFIG_STATUS = Object.freeze({
    READY: "ready",
    CACHED: "cached"
  });
  var COMPATIBILITY_CONFIG_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1e3;
  var GAME_VERSIONS = Object.freeze(["fc26", "fc27"]);
  var DOWNGRADE_STATES = Object.freeze([
    CapabilityState.DEGRADED,
    CapabilityState.UNVERIFIED,
    CapabilityState.UNAVAILABLE
  ]);
  var REASON_CODES = Object.freeze([
    "ea_update",
    "feature_disabled",
    "fresh_evidence_required",
    "minimum_client_version",
    "unsupported_game_version"
  ]);
  var STATE_RANK = Object.freeze({
    [CapabilityState.AVAILABLE]: 0,
    [CapabilityState.DEGRADED]: 1,
    [CapabilityState.UNVERIFIED]: 2,
    [CapabilityState.UNAVAILABLE]: 3
  });

  // src/application/pro-contracts/entitlement-provider.js
  var EntitlementState = Object.freeze({
    CHECKING: "checking",
    READY: "ready",
    VERIFIED: "ready",
    NOT_CONFIGURED: "not_configured",
    SIGN_IN_REQUIRED: "sign_in_required",
    LOCKED: "locked",
    OFFLINE: "offline",
    SERVICE_UNAVAILABLE: "service_unavailable",
    STALE: "stale",
    EXPIRED: "stale",
    ERROR: "error"
  });
  var EntitlementErrorCode = Object.freeze({
    EXPIRED: "ENTITLEMENT_EXPIRED",
    STALE: "ENTITLEMENT_STALE",
    SIGN_IN_REQUIRED: "SIGN_IN_REQUIRED",
    LOCKED: "ENTITLEMENT_LOCKED",
    NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
    SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
    PROVIDER_ERROR: "PROVIDER_ERROR",
    PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
    INVALID_RESPONSE: "INVALID_RESPONSE"
  });
  var FREE_FEATURE_IDS = Object.freeze([
    Feature.ADVANCED_TOOLS,
    Feature.LOCAL_RECIPES,
    Feature.PRODUCT_SHELL,
    Feature.SBC_PROJECTS
  ].sort());
  var PRO_FEATURE_IDS = Object.freeze([
    .../* @__PURE__ */ new Set([
      ...FREE_FEATURE_IDS,
      Feature.CLUB_OPTIMIZATION,
      Feature.EVOLUTION_PLANNING,
      Feature.PROJECT_OPTIMIZATION,
      Feature.SMART_ROUTING,
      Feature.CLOUD_RECIPES
    ])
  ].sort());

  // src/application/pro-contracts/recipe-catalog.js
  var RECIPE_CATALOG_STATUS = Object.freeze({
    READY: "ready",
    CACHED: "cached"
  });
  var RECIPE_CATALOG_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1e3;
  var GAME_VERSIONS2 = Object.freeze(["fc26", "fc27"]);

  // src/application/pro-contracts/request-handles.js
  var HANDLE_KINDS = Object.freeze({
    ITEM: "item",
    PLAYER_GROUP: "player_group",
    VERSION_GROUP: "version_group",
    PROJECT: "project",
    REQUIREMENT: "requirement",
    RECIPE: "recipe"
  });
  var HANDLE_PREFIX = Object.freeze({
    [HANDLE_KINDS.ITEM]: "itm",
    [HANDLE_KINDS.PLAYER_GROUP]: "ply",
    [HANDLE_KINDS.VERSION_GROUP]: "ver",
    [HANDLE_KINDS.PROJECT]: "prj",
    [HANDLE_KINDS.REQUIREMENT]: "req",
    [HANDLE_KINDS.RECIPE]: "rcp"
  });

  // src/application/item-score-provider.js
  var ITEM_SCORE_LIMITS = Object.freeze({
    maxBytes: 256 * 1024,
    maxDepth: 9,
    maxObjectKeys: 20,
    maxItems: 100,
    maxTtlMs: 2 * 6e4,
    maxScore: 1e9
  });
  var ItemScoreProviderState = Object.freeze({
    READY: "READY",
    UNVERIFIED: "UNVERIFIED",
    NOT_CONFIGURED: "NOT_CONFIGURED"
  });
  var ItemScoreResponseStatus = Object.freeze({
    SCORED: "SCORED"
  });
  var ItemScoreFeatureCode = Object.freeze({
    RATING: "rating",
    RARITY_ID: "rarity_id",
    CARD_TYPE: "card_type",
    SPECIAL_GROUPS: "special_groups"
  });
  var FEATURE_KINDS = Object.freeze({
    rating: Fc27ObservedValueKind.RATING,
    rarityId: Fc27ObservedValueKind.SAFE_ID,
    cardType: Fc27ObservedValueKind.SAFE_ID,
    specialGroups: Fc27ObservedValueKind.STRING_LIST
  });
  var FEATURE_FIELD_BY_CODE = Object.freeze({
    [ItemScoreFeatureCode.RATING]: "rating",
    [ItemScoreFeatureCode.RARITY_ID]: "rarityId",
    [ItemScoreFeatureCode.CARD_TYPE]: "cardType",
    [ItemScoreFeatureCode.SPECIAL_GROUPS]: "specialGroups"
  });

  // src/application/router-next-action.js
  var ROUTER_NEXT_ACTION_KIND = "ROUTER_NEXT_ACTION_V1";
  var ROUTER_NEXT_ACTION_SCHEMA_VERSION = 1;
  var ROUTER_NEXT_ACTION_SAFETY_BOUNDARY = "READ_ONLY_ONE_RECOMMENDATION";
  var ROUTER_NEXT_ACTION_LIMITS = Object.freeze({
    maxItems: 5e3,
    maxUnassignedItems: 100,
    maxStorageItems: 100
  });
  var RouterNextActionState = Object.freeze({
    READY: "READY",
    ATTENTION: "ATTENTION",
    CLEAR: "CLEAR",
    BLOCKED: "BLOCKED"
  });
  var RouterNextActionKind = Object.freeze({
    KEEP: "KEEP",
    MOVE_TO_CLUB: "MOVE_TO_CLUB",
    MOVE_TO_SBC_STORAGE: "MOVE_TO_SBC_STORAGE",
    RESERVE: "RESERVE",
    PAUSE: "PAUSE",
    ASK_USER: "ASK_USER"
  });
  var RouterActivityGuardState = Object.freeze({
    IDLE: "IDLE",
    NON_IDLE: "NON_IDLE",
    UNKNOWN: "UNKNOWN"
  });
  var RouterNextActionReason = Object.freeze({
    UNASSIGNED_CLEAR: "UNASSIGNED_CLEAR",
    EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED: "EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED",
    UNIQUE_CLUB_MOVE_VERIFIED: "UNIQUE_CLUB_MOVE_VERIFIED",
    TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE: "TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE",
    UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION: "UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION",
    DUPLICATE_IDENTITY_UNVERIFIED: "DUPLICATE_IDENTITY_UNVERIFIED",
    CLUB_MOVE_EVIDENCE_UNVERIFIED: "CLUB_MOVE_EVIDENCE_UNVERIFIED",
    STORAGE_MOVE_EVIDENCE_UNVERIFIED: "STORAGE_MOVE_EVIDENCE_UNVERIFIED",
    TRADABILITY_EVIDENCE_UNVERIFIED: "TRADABILITY_EVIDENCE_UNVERIFIED",
    STORAGE_CAPACITY_UNVERIFIED: "STORAGE_CAPACITY_UNVERIFIED",
    ITEM_EXPLICITLY_NOT_MOVABLE: "ITEM_EXPLICITLY_NOT_MOVABLE",
    ROUTE_EVIDENCE_MISSING: "ROUTE_EVIDENCE_MISSING",
    ROUTE_EVIDENCE_CONFLICT: "ROUTE_EVIDENCE_CONFLICT",
    INVENTORY_SNAPSHOT_INVALID: "INVENTORY_SNAPSHOT_INVALID",
    INPUT_LIMIT_EXCEEDED: "INPUT_LIMIT_EXCEEDED",
    GAME_CONTEXT_UNVERIFIED: "GAME_CONTEXT_UNVERIFIED",
    READ_CAPABILITY_UNAVAILABLE: "READ_CAPABILITY_UNAVAILABLE",
    MOVE_CAPABILITY_UNAVAILABLE: "MOVE_CAPABILITY_UNAVAILABLE",
    ACTIVITY_GUARD_NOT_IDLE: "ACTIVITY_GUARD_NOT_IDLE",
    ACTIVITY_GUARD_UNVERIFIED: "ACTIVITY_GUARD_UNVERIFIED"
  });
  var ROUTER_NEXT_ACTION_CAPABILITIES = Object.freeze([
    "ea.inventory.read",
    "ea.unassigned.read",
    "ea.items.move"
  ]);
  var ROUTER_NEXT_ACTION_OBJECTIVE_FIELDS = Object.freeze([
    "protected_item_violations",
    "unresolved_blocking_duplicates",
    "active_project_damage",
    "scarce_special_consumption",
    "tradable_opportunity_cost",
    "replacement_value",
    "future_flexibility_loss",
    "unassigned_items_after",
    "interaction_friction",
    "action_rank",
    "exact_identity_key",
    "owned_item_id"
  ]);
  var ROUTER_VERSION = 1;
  var TIE_RULE_VERSION = 1;
  var compareText = (left, right) => {
    const a = String(left ?? "");
    const b = String(right ?? "");
    return a < b ? -1 : a > b ? 1 : 0;
  };
  var compareTuples = (left, right) => {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const a = left[index];
      const b = right[index];
      const comparison = typeof a === "number" && typeof b === "number" ? a - b : compareText(a, b);
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
  var canonicalValue2 = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalValue2(entry)).sort((left, right) => compareText(stableStringify(left), stableStringify(right)));
    }
    if (!value || typeof value !== "object") return value ?? null;
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalValue2(value[key])])
    );
  };
  var sourceItems = (snapshot, sourceName) => {
    const source = snapshot?.[sourceName];
    return Array.isArray(source?.items) ? source.items : null;
  };
  var allSnapshotItems = (snapshot) => {
    const club = sourceItems(snapshot, "club");
    const storage = sourceItems(snapshot, "storage");
    const unassigned = sourceItems(snapshot, "unassigned");
    if (!club || !storage || !unassigned) return null;
    return { club, storage, unassigned, all: [...club, ...storage, ...unassigned] };
  };
  var canonicalItem = (item = {}) => ({
    itemId: String(item.itemId ?? item.id ?? ""),
    resourceId: item.resourceId == null ? null : String(item.resourceId),
    definitionId: item.definitionId == null ? null : String(item.definitionId),
    assetId: item.assetId == null ? null : String(item.assetId),
    baseId: item.baseId == null ? null : String(item.baseId),
    location: item.location == null ? null : String(item.location),
    rating: Number(item.rating || 0),
    name: item.name == null ? null : String(item.name),
    cardType: item.cardType == null ? null : String(item.cardType),
    rarityId: item.rarityId == null ? null : String(item.rarityId),
    rarityName: item.rarityName == null ? null : String(item.rarityName),
    specialGroups: [...Array.isArray(item.specialGroups) ? item.specialGroups : []].map(String).sort(compareText),
    isSpecial: item.isSpecial ?? null,
    isTradable: item.isTradable ?? item.isTradeable ?? null,
    isDuplicate: item.isDuplicate ?? null,
    isMovable: item.isMovable ?? null,
    isStorable: item.isStorable ?? null,
    isLocked: item.isLocked ?? item.locked ?? null,
    isProtected: item.isProtected ?? null,
    isFavorite: item.isFavorite ?? item.isFavourite ?? null,
    isInStartingSquad: item.isInStartingSquad ?? item.isInActive11 ?? null,
    hasMovableEvidence: item.hasMovableEvidence ?? null,
    hasStorableEvidence: item.hasStorableEvidence ?? null,
    hasTradabilityEvidence: item.hasTradabilityEvidence ?? null,
    hasLockedEvidence: item.hasLockedEvidence ?? null,
    hasProtectedEvidence: item.hasProtectedEvidence ?? null,
    hasFavoriteEvidence: item.hasFavoriteEvidence ?? null,
    hasStartingSquadEvidence: item.hasStartingSquadEvidence ?? null,
    hasSpecialEvidence: item.hasSpecialEvidence ?? null
  });
  var canonicalInventory3 = (snapshot, sources) => ({
    storageCapacity: snapshot?.storageCapacity ?? null,
    items: sources.all.map(canonicalItem).sort((left, right) => compareText(left.itemId, right.itemId))
  });
  var canonicalRouteAction = (action = {}) => ({
    itemId: String(action.itemId ?? ""),
    type: String(action.type ?? ""),
    from: String(action.from ?? ""),
    to: String(action.to ?? ""),
    reason: String(action.reason ?? "")
  });
  var canonicalRouteEvidence = (routeSummary) => ({
    actions: (Array.isArray(routeSummary?.routeActions) ? routeSummary.routeActions : []).map(canonicalRouteAction).sort((left, right) => compareText(left.itemId, right.itemId) || compareText(left.type, right.type) || compareText(left.to, right.to))
  });
  var canonicalCapabilities3 = (snapshot = {}) => ({
    capabilities: ROUTER_NEXT_ACTION_CAPABILITIES.map((id) => {
      const record = (snapshot.capabilities || []).find((entry) => entry?.id === id);
      return {
        id,
        state: record?.state ?? "unverified",
        evidence: canonicalValue2(record?.evidence ?? null)
      };
    })
  });
  var canonicalContext2 = (context = {}) => ({
    gameVersion: String(context.gameVersion ?? "unknown").toLowerCase(),
    state: String(context.state ?? "unverified").toLowerCase(),
    route: context.route == null ? null : String(context.route),
    evidence: canonicalValue2(context.evidence ?? null)
  });
  var normalizedGuard = (guard) => {
    const state = String(guard?.state ?? RouterActivityGuardState.UNKNOWN).toUpperCase();
    if (state === RouterActivityGuardState.IDLE) {
      return { state: RouterActivityGuardState.IDLE, evidence: canonicalValue2(guard?.evidence ?? null) };
    }
    if (state === RouterActivityGuardState.UNKNOWN) {
      return { state: RouterActivityGuardState.UNKNOWN, evidence: canonicalValue2(guard?.evidence ?? null) };
    }
    return { state: RouterActivityGuardState.NON_IDLE, evidence: canonicalValue2(guard?.evidence ?? null) };
  };
  var capabilityState = (snapshot, id) => (snapshot?.capabilities || []).find((entry) => entry?.id === id)?.state ?? "unverified";
  var displayItem = (item = {}) => ({
    name: item.name == null ? null : String(item.name),
    rating: Number(item.rating || 0),
    isSpecial: Boolean(item.isSpecial),
    isTradable: item.hasTradabilityEvidence === true ? Boolean(item.isTradable) : null,
    location: "unassigned"
  });
  var makeFingerprints = ({
    inventory = null,
    routeEvidence = null,
    capabilities,
    context,
    guard,
    protectionAnalysis,
    conservationPolicy,
    duplicatePolicy,
    failure = null
  }) => {
    const components = {
      inventory: stableFingerprint(inventory ?? { unavailable: true }),
      routeEvidence: stableFingerprint(routeEvidence ?? { unavailable: true }),
      capabilities: stableFingerprint(capabilities),
      gameContext: stableFingerprint(context),
      activityGuard: stableFingerprint(guard),
      protection: stableFingerprint({
        analysis: canonicalValue2(protectionAnalysis ?? null),
        conservationPolicy: canonicalValue2(conservationPolicy ?? null)
      }),
      policy: stableFingerprint(canonicalValue2(duplicatePolicy ?? null)),
      version: stableFingerprint({
        kind: ROUTER_NEXT_ACTION_KIND,
        schemaVersion: ROUTER_NEXT_ACTION_SCHEMA_VERSION,
        routerVersion: ROUTER_VERSION,
        tieRuleVersion: TIE_RULE_VERSION
      }),
      failure: stableFingerprint(failure)
    };
    return {
      ...components,
      input: stableFingerprint(components)
    };
  };
  var outcomeFor = ({ kind, reasonCode, item = null, duplicateKey = null, destination = null, tuple = [] }) => ({
    kind,
    reasonCode,
    destination,
    display: item ? displayItem(item) : null,
    binding: item ? {
      itemId: String(item.itemId),
      expectedFrom: "unassigned",
      exactDuplicateKey: duplicateKey
    } : null,
    objectiveTuple: [...tuple]
  });
  var finalize = ({ state, outcome: outcome2, fingerprints, observedAt, counts }) => {
    const decisionFingerprint = stableFingerprint({
      input: fingerprints.input,
      kind: outcome2.kind,
      reasonCode: outcome2.reasonCode,
      destination: outcome2.destination,
      binding: outcome2.binding,
      objectiveTuple: outcome2.objectiveTuple
    });
    return cloneAndFreeze({
      kind: ROUTER_NEXT_ACTION_KIND,
      schemaVersion: ROUTER_NEXT_ACTION_SCHEMA_VERSION,
      state,
      safetyBoundary: ROUTER_NEXT_ACTION_SAFETY_BOUNDARY,
      readOnly: true,
      canExecute: false,
      outcome: outcome2,
      counts,
      observedAt,
      fingerprints: { ...fingerprints, decision: decisionFingerprint }
    });
  };
  var blocked = ({ reasonCode, fingerprints, observedAt, counts }) => finalize({
    state: RouterNextActionState.BLOCKED,
    outcome: outcomeFor({ kind: RouterNextActionKind.PAUSE, reasonCode }),
    fingerprints,
    observedAt,
    counts
  });
  var routeMapFor = (routeEvidence, unassignedIds) => {
    const map = /* @__PURE__ */ new Map();
    let conflict = false;
    for (const action of routeEvidence.actions) {
      if (!unassignedIds.has(action.itemId) || map.has(action.itemId)) {
        conflict = true;
        continue;
      }
      map.set(action.itemId, action);
    }
    if (map.size !== unassignedIds.size) conflict = true;
    return { map, conflict };
  };
  var attentionReason = (item, action, duplicateKey, exactDuplicate, capacityKnown) => {
    if ((item.isDuplicate === true || action?.reason === "duplicate_identity_ambiguous") && !duplicateKey) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.DUPLICATE_IDENTITY_UNVERIFIED, severity: 0 };
    }
    if (action?.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE && action.reason === "unassigned_item_not_movable") {
      return {
        kind: RouterNextActionKind.PAUSE,
        reasonCode: item.hasMovableEvidence === true ? RouterNextActionReason.ITEM_EXPLICITLY_NOT_MOVABLE : RouterNextActionReason.CLUB_MOVE_EVIDENCE_UNVERIFIED,
        severity: 1
      };
    }
    if (action?.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB) {
      if (exactDuplicate) {
        return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 0 };
      }
      if (item.hasMovableEvidence !== true) {
        return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.CLUB_MOVE_EVIDENCE_UNVERIFIED, severity: 1 };
      }
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ITEM_EXPLICITLY_NOT_MOVABLE, severity: 2 };
    }
    if (action?.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE) {
      if (!exactDuplicate) {
        return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 0 };
      }
      if (!capacityKnown) {
        return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_CAPACITY_UNVERIFIED, severity: 1 };
      }
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_MOVE_EVIDENCE_UNVERIFIED, severity: 1 };
    }
    if (exactDuplicate && !capacityKnown) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.STORAGE_CAPACITY_UNVERIFIED, severity: 1 };
    }
    if (exactDuplicate && item.hasTradabilityEvidence !== true) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.TRADABILITY_EVIDENCE_UNVERIFIED, severity: 3 };
    }
    if (exactDuplicate && item.isTradable === true) {
      return { kind: RouterNextActionKind.ASK_USER, reasonCode: RouterNextActionReason.TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE, severity: 5 };
    }
    if (exactDuplicate) {
      return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION, severity: 2 };
    }
    return { kind: RouterNextActionKind.PAUSE, reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT, severity: 1 };
  };
  var recommendRouterNextAction = (input = {}) => {
    const observedAt = input.observedAt ?? input.inventorySnapshot?.updatedAt ?? null;
    const guard = normalizedGuard(input.activityGuard);
    const capabilities = canonicalCapabilities3(input.capabilitySnapshot);
    const context = canonicalContext2(input.gameContext);
    const initialCounts = { totalItems: 0, unassignedItems: 0, safeCandidates: 0, attentionCandidates: 0 };
    const earlyFingerprints = (failure) => makeFingerprints({
      capabilities,
      context,
      guard,
      protectionAnalysis: input.protectionAnalysis,
      conservationPolicy: input.conservationPolicy,
      duplicatePolicy: input.duplicatePolicy,
      failure
    });
    if (guard.state !== RouterActivityGuardState.IDLE) {
      const reasonCode = guard.state === RouterActivityGuardState.UNKNOWN ? RouterNextActionReason.ACTIVITY_GUARD_UNVERIFIED : RouterNextActionReason.ACTIVITY_GUARD_NOT_IDLE;
      return blocked({
        reasonCode,
        fingerprints: earlyFingerprints({ reasonCode }),
        observedAt,
        counts: initialCounts
      });
    }
    const sources = allSnapshotItems(input.inventorySnapshot);
    const totalCount = sources?.all.length ?? 0;
    const unassignedCount = sources?.unassigned.length ?? 0;
    const counts = { ...initialCounts, totalItems: totalCount, unassignedItems: unassignedCount };
    if (!sources) {
      const reasonCode = RouterNextActionReason.INVENTORY_SNAPSHOT_INVALID;
      return blocked({ reasonCode, fingerprints: earlyFingerprints({ reasonCode }), observedAt, counts });
    }
    if (totalCount > ROUTER_NEXT_ACTION_LIMITS.maxItems || unassignedCount > ROUTER_NEXT_ACTION_LIMITS.maxUnassignedItems || sources.storage.length > ROUTER_NEXT_ACTION_LIMITS.maxStorageItems) {
      const reasonCode = RouterNextActionReason.INPUT_LIMIT_EXCEEDED;
      return blocked({
        reasonCode,
        fingerprints: earlyFingerprints({ reasonCode, totalCount, unassignedCount, storageCount: sources.storage.length }),
        observedAt,
        counts
      });
    }
    const expectedLocations = [
      [sources.club, "club"],
      [sources.storage, "sbc_storage"],
      [sources.unassigned, "unassigned"]
    ];
    const ids = /* @__PURE__ */ new Set();
    let invalidInventory = false;
    for (const [items, location2] of expectedLocations) {
      for (const item of items) {
        const itemId = String(item?.itemId ?? "");
        if (!itemId || ids.has(itemId) || String(item?.location ?? "") !== location2) {
          invalidInventory = true;
        }
        ids.add(itemId);
      }
    }
    if (Array.isArray(input.inventorySnapshot?.items)) {
      const aggregateIds = input.inventorySnapshot.items.map((item) => String(item?.itemId ?? "")).sort(compareText);
      const sourceIds = [...ids].sort(compareText);
      if (stableStringify(aggregateIds) !== stableStringify(sourceIds)) invalidInventory = true;
    }
    const inventory = canonicalInventory3(input.inventorySnapshot, sources);
    const routeEvidence = canonicalRouteEvidence(input.routeSummary);
    const fingerprints = makeFingerprints({
      inventory,
      routeEvidence,
      capabilities,
      context,
      guard,
      protectionAnalysis: input.protectionAnalysis,
      conservationPolicy: input.conservationPolicy,
      duplicatePolicy: input.duplicatePolicy
    });
    if (invalidInventory) {
      return blocked({
        reasonCode: RouterNextActionReason.INVENTORY_SNAPSHOT_INVALID,
        fingerprints,
        observedAt,
        counts
      });
    }
    if (context.gameVersion !== "fc26" || context.state !== "verified") {
      return blocked({
        reasonCode: RouterNextActionReason.GAME_CONTEXT_UNVERIFIED,
        fingerprints,
        observedAt,
        counts
      });
    }
    if (capabilityState(input.capabilitySnapshot, "ea.inventory.read") !== "available" || capabilityState(input.capabilitySnapshot, "ea.unassigned.read") !== "available") {
      return blocked({
        reasonCode: RouterNextActionReason.READ_CAPABILITY_UNAVAILABLE,
        fingerprints,
        observedAt,
        counts
      });
    }
    if (unassignedCount === 0) {
      return finalize({
        state: RouterNextActionState.CLEAR,
        outcome: outcomeFor({
          kind: RouterNextActionKind.KEEP,
          reasonCode: RouterNextActionReason.UNASSIGNED_CLEAR
        }),
        fingerprints,
        observedAt,
        counts
      });
    }
    const unassignedIds = new Set(sources.unassigned.map((item) => String(item.itemId)));
    const { map: routeByItemId, conflict: routeConflict } = routeMapFor(routeEvidence, unassignedIds);
    if (!Array.isArray(input.routeSummary?.routeActions)) {
      return blocked({
        reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_MISSING,
        fingerprints,
        observedAt,
        counts
      });
    }
    if (routeConflict) {
      return blocked({
        reasonCode: RouterNextActionReason.ROUTE_EVIDENCE_CONFLICT,
        fingerprints,
        observedAt,
        counts
      });
    }
    const capacity = input.inventorySnapshot.storageCapacity;
    const capacityKnown = Number.isInteger(capacity) && capacity >= 0 && capacity <= 100;
    const hasStorageSlot = capacityKnown && sources.storage.length < capacity;
    const occupiedKeys = new Set(
      [...sources.club, ...sources.storage].map(getDuplicateKey).filter(Boolean)
    );
    const blockingDuplicateCount = sources.unassigned.reduce((count, item) => {
      const key = getDuplicateKey(item);
      return count + Number(Boolean(key && occupiedKeys.has(key)));
    }, 0);
    const safeCandidates = [];
    const attentionCandidates = [];
    for (const item of sources.unassigned) {
      const itemId = String(item.itemId);
      const action = routeByItemId.get(itemId);
      const duplicateKey = getDuplicateKey(item);
      const exactDuplicate = Boolean(duplicateKey && occupiedKeys.has(duplicateKey));
      let safe = null;
      if (action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB && action.from === "unassigned" && action.to === "club" && action.reason === "not_duplicate" && !exactDuplicate && item.hasMovableEvidence === true && item.isMovable === true) {
        safe = {
          item,
          duplicateKey,
          kind: RouterNextActionKind.MOVE_TO_CLUB,
          reasonCode: RouterNextActionReason.UNIQUE_CLUB_MOVE_VERIFIED,
          destination: "club",
          tuple: [0, blockingDuplicateCount, 0, 0, 0, 0, 0, Math.max(0, unassignedCount - 1), 1, 1, duplicateKey ?? "", itemId]
        };
      }
      if (action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE && action.from === "unassigned" && action.to === "sbc_storage" && action.reason === "duplicate_storage_available" && exactDuplicate && hasStorageSlot && item.hasMovableEvidence === true && item.isMovable === false && item.hasStorableEvidence === true && item.isStorable === true) {
        const tradableRank = item.hasTradabilityEvidence === true ? item.isTradable === true ? 1 : 0 : 2;
        safe = {
          item,
          duplicateKey,
          kind: RouterNextActionKind.MOVE_TO_SBC_STORAGE,
          reasonCode: RouterNextActionReason.EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED,
          destination: "sbc_storage",
          tuple: [0, Math.max(0, blockingDuplicateCount - 1), 0, 0, tradableRank, 0, 1, Math.max(0, unassignedCount - 1), 1, 0, duplicateKey, itemId]
        };
      }
      if (safe) {
        safeCandidates.push(safe);
        continue;
      }
      const attention = attentionReason(item, action, duplicateKey, exactDuplicate, capacityKnown);
      attentionCandidates.push({
        item,
        duplicateKey,
        ...attention,
        tuple: [attention.severity, duplicateKey ?? "", itemId]
      });
    }
    const resultCounts = {
      ...counts,
      safeCandidates: safeCandidates.length,
      attentionCandidates: attentionCandidates.length
    };
    if (safeCandidates.length > 0) {
      if (capabilityState(input.capabilitySnapshot, "ea.items.move") !== "available") {
        return blocked({
          reasonCode: RouterNextActionReason.MOVE_CAPABILITY_UNAVAILABLE,
          fingerprints,
          observedAt,
          counts: resultCounts
        });
      }
      const selected4 = safeCandidates.sort((left, right) => compareTuples(left.tuple, right.tuple))[0];
      return finalize({
        state: RouterNextActionState.READY,
        outcome: outcomeFor(selected4),
        fingerprints,
        observedAt,
        counts: resultCounts
      });
    }
    const selected3 = attentionCandidates.sort((left, right) => compareTuples(left.tuple, right.tuple))[0];
    return finalize({
      state: RouterNextActionState.ATTENTION,
      outcome: outcomeFor(selected3),
      fingerprints,
      observedAt,
      counts: resultCounts
    });
  };

  // src/application/solver-presets.js
  var SolverPresetId = Object.freeze({
    BALANCED: "BALANCED",
    CONSERVATIVE: "CONSERVATIVE",
    DUPLICATES_FIRST: "DUPLICATES_FIRST",
    STORAGE_FIRST: "STORAGE_FIRST"
  });
  var SbcStorageMode = Object.freeze({
    SMART: "SMART",
    PREFER: "PREFER",
    ONLY: "ONLY",
    AVOID: "AVOID"
  });
  var PRESETS = Object.freeze({
    BALANCED: Object.freeze({ id: "BALANCED", translationKey: "solver.preset.balanced", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: false }), storageMode: "SMART" }),
    CONSERVATIVE: Object.freeze({ id: "CONSERVATIVE", translationKey: "solver.preset.conservative", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: true }), storageMode: "SMART" }),
    DUPLICATES_FIRST: Object.freeze({ id: "DUPLICATES_FIRST", translationKey: "solver.preset.duplicatesFirst", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: false, preferUntradeables: true, protectTradables: false }), storageMode: "AVOID" }),
    STORAGE_FIRST: Object.freeze({ id: "STORAGE_FIRST", translationKey: "solver.preset.storageFirst", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: false }), storageMode: "PREFER" })
  });

  // src/application/surface-slot-registry.js
  var SurfaceSlot = Object.freeze({
    PACK_ACTIONS: "ea.pack.actions",
    ITEMS_HEADER: "ea.items.header",
    SBC_HEADER: "ea.sbc.header",
    GLOBAL_HEADER: "ea.global.header"
  });

  // src/routing/routing-rule.js
  var RoutingDestination = Object.freeze({
    CLUB: "CLUB",
    SBC_STORAGE: "SBC_STORAGE",
    TRANSFER_LIST: "TRANSFER_LIST",
    ACTIVE_RECIPE: "ACTIVE_RECIPE",
    KEEP_UNASSIGNED: "KEEP_UNASSIGNED",
    ASK_USER: "ASK_USER"
  });
  var RoutingEffect = Object.freeze({
    PRESERVE: "preserve",
    CONSUME: "consume",
    MANUAL: "manual"
  });
  var RoutingTradeability = Object.freeze({
    TRADEABLE: "tradeable",
    UNTRADEABLE: "untradeable",
    UNKNOWN: "unknown"
  });
  var DESTINATIONS = new Set(Object.values(RoutingDestination));
  var CRITERIA_KEYS = /* @__PURE__ */ new Set([
    "locations",
    "duplicate",
    "tradeability",
    "minRating",
    "maxRating",
    "rarities",
    "cardTypes",
    "itemTypes"
  ]);
  var RULE_KEYS = /* @__PURE__ */ new Set(["id", "priority", "destination", "criteria", "enabled"]);
  var exactKeys = (value, allowed, path) => {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`);
    }
  };
  var stringList = (value, field) => {
    if (value == null) return Object.freeze([]);
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
      throw new TypeError(`${field} must be an array of non-empty strings`);
    }
    return Object.freeze([...new Set(value.map((entry) => entry.trim()))].sort());
  };
  function normalizeRoutingRule(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Routing rule must be an object");
    }
    exactKeys(input, RULE_KEYS, "$routingRule");
    if (typeof input.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.id)) {
      throw new TypeError("Routing rule id must be a safe identifier");
    }
    if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 1e4) {
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
      tradeability: rawCriteria.tradeability == null ? null : String(rawCriteria.tradeability).toLowerCase(),
      minRating: number(rawCriteria.minRating, "criteria.minRating"),
      maxRating: number(rawCriteria.maxRating, "criteria.maxRating"),
      rarities: stringList(rawCriteria.rarities, "criteria.rarities"),
      cardTypes: stringList(rawCriteria.cardTypes, "criteria.cardTypes"),
      itemTypes: stringList(rawCriteria.itemTypes, "criteria.itemTypes")
    });
    if (criteria.tradeability != null && !Object.values(RoutingTradeability).includes(criteria.tradeability)) {
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
      enabled: input.enabled !== false
    });
  }
  function routingRuleMatches(rule, context) {
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

  // src/routing/routing-ruleset.js
  var ROUTING_RULESET_SCHEMA_VERSION = 1;
  var ROUTING_LIMITS = Object.freeze({ maxRules: 100, maxItems: 5e3 });
  function normalizeRoutingRuleset(input = {}) {
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
    const ids = /* @__PURE__ */ new Set();
    for (const rule of rules) {
      if (ids.has(rule.id)) throw new TypeError(`Duplicate routing rule id: ${rule.id}`);
      ids.add(rule.id);
    }
    rules.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    return Object.freeze({
      schemaVersion: ROUTING_RULESET_SCHEMA_VERSION,
      id: input.id,
      rules: Object.freeze(rules)
    });
  }

  // src/inventory/duplicate-relations.js
  var LOCATION_BUCKET = Object.freeze({
    club: "club",
    sbc_storage: "sbcStorage",
    unassigned: "unassigned"
  });
  var freezeRef = (item) => Object.freeze({
    itemId: String(item.itemId),
    location: String(item.location),
    resourceId: item.resourceId == null ? null : String(item.resourceId),
    definitionId: item.definitionId == null ? null : String(item.definitionId)
  });
  var byItemId = (left, right) => left.itemId.localeCompare(right.itemId);
  function buildDuplicateRelations(snapshot = {}) {
    const items = Array.isArray(snapshot.items) ? snapshot.items : [
      ...snapshot.club?.items ?? [],
      ...snapshot.storage?.items ?? [],
      ...snapshot.unassigned?.items ?? []
    ];
    const groups = /* @__PURE__ */ new Map();
    const ambiguousItemRefs = [];
    for (const item of items) {
      if (!item?.itemId) continue;
      const key = getDuplicateKey(item);
      if (!key) {
        if (item.isDuplicate === true) ambiguousItemRefs.push(freezeRef(item));
        continue;
      }
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    const relations = [];
    for (const [relationKey, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const shouldInclude = group.length > 1 || group.some(
        (item) => item.location === "unassigned" && item.isDuplicate === true
      );
      if (!shouldInclude) continue;
      const copies = { club: [], sbcStorage: [], unassigned: [] };
      for (const item of group) {
        const bucket = LOCATION_BUCKET[item.location];
        if (bucket) copies[bucket].push(freezeRef(item));
      }
      for (const bucket of Object.values(copies)) bucket.sort(byItemId);
      const unassigned = copies.unassigned;
      relations.push(Object.freeze({
        relationKey,
        resourceId: group[0]?.resourceId == null ? null : String(group[0].resourceId),
        definitionId: group[0]?.definitionId == null ? null : String(group[0].definitionId),
        copies: Object.freeze({
          club: Object.freeze(copies.club),
          sbcStorage: Object.freeze(copies.sbcStorage),
          unassigned: Object.freeze(unassigned),
          transfer: null
        }),
        blockingUnassignedItemIds: Object.freeze(unassigned.map(({ itemId }) => itemId)),
        evidenceState: group.length > 1 ? "verified" : "reported_only"
      }));
    }
    return Object.freeze({
      schemaVersion: 1,
      inventoryGeneration: Number.isSafeInteger(snapshot.generation) ? snapshot.generation : null,
      relations: Object.freeze(relations),
      ambiguousItemRefs: Object.freeze(ambiguousItemRefs.sort(byItemId)),
      transferSourceAvailable: false
    });
  }

  // src/routing/routing-explainer.js
  var RoutingReason = Object.freeze({
    RULE_MATCHED: "RULE_MATCHED",
    PROTECTED_FROM_CONSUMPTION: "PROTECTED_FROM_CONSUMPTION",
    DUPLICATE_IDENTITY_AMBIGUOUS: "DUPLICATE_IDENTITY_AMBIGUOUS",
    MOVE_EVIDENCE_MISSING: "MOVE_EVIDENCE_MISSING",
    STORAGE_EVIDENCE_MISSING: "STORAGE_EVIDENCE_MISSING",
    STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
    TRADEABILITY_UNVERIFIED: "TRADEABILITY_UNVERIFIED",
    TRANSFER_SOURCE_UNAVAILABLE: "TRANSFER_SOURCE_UNAVAILABLE",
    RECIPE_UNVERIFIED: "RECIPE_UNVERIFIED",
    NON_DUPLICATE_TO_CLUB: "NON_DUPLICATE_TO_CLUB",
    DUPLICATE_TO_STORAGE: "DUPLICATE_TO_STORAGE",
    TRADEABLE_DUPLICATE_PRESERVED: "TRADEABLE_DUPLICATE_PRESERVED",
    USER_DECISION_REQUIRED: "USER_DECISION_REQUIRED",
    ACTIVITY_GUARD_BLOCKED: "ACTIVITY_GUARD_BLOCKED"
  });
  var COPY = Object.freeze({
    [RoutingReason.RULE_MATCHED]: "Matched the first eligible routing rule.",
    [RoutingReason.PROTECTED_FROM_CONSUMPTION]: "This item is protected from consuming routes.",
    [RoutingReason.DUPLICATE_IDENTITY_AMBIGUOUS]: "Duplicate identity could not be verified.",
    [RoutingReason.MOVE_EVIDENCE_MISSING]: "FUT Magic could not verify that this item can move.",
    [RoutingReason.STORAGE_EVIDENCE_MISSING]: "SBC Storage eligibility is unverified.",
    [RoutingReason.STORAGE_UNAVAILABLE]: "SBC Storage has no verified free slot.",
    [RoutingReason.TRADEABILITY_UNVERIFIED]: "Tradeability evidence is missing.",
    [RoutingReason.TRANSFER_SOURCE_UNAVAILABLE]: "Transfer List state is not part of the verified inventory snapshot.",
    [RoutingReason.RECIPE_UNVERIFIED]: "No verified active recipe accepts this item.",
    [RoutingReason.NON_DUPLICATE_TO_CLUB]: "This verified non-duplicate can move to Club.",
    [RoutingReason.DUPLICATE_TO_STORAGE]: "This duplicate has a verified SBC Storage destination.",
    [RoutingReason.TRADEABLE_DUPLICATE_PRESERVED]: "This tradeable duplicate is preserved for a user decision.",
    [RoutingReason.USER_DECISION_REQUIRED]: "FUT Magic needs a user decision before continuing.",
    [RoutingReason.ACTIVITY_GUARD_BLOCKED]: "Activity Guard is not ready for another planned action."
  });
  function explainRoutingDecision(reasonCodes = []) {
    const unique = [...new Set(reasonCodes)];
    return Object.freeze(unique.map((code) => Object.freeze({
      code,
      message: COPY[code] ?? COPY[RoutingReason.USER_DECISION_REQUIRED]
    })));
  }

  // src/routing/routing-validator.js
  var guardAllowsAdvice = (guard) => {
    const state = String(guard?.state ?? "UNKNOWN").toUpperCase();
    return ["IDLE", "NORMAL"].includes(state);
  };
  function validateRoutingDestination(destination, context) {
    if (!guardAllowsAdvice(context.activityGuard)) {
      return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.ACTIVITY_GUARD_BLOCKED };
    }
    if (destination === RoutingDestination.CLUB) {
      return context.item.hasMovableEvidence === true && context.item.isMovable === true ? { valid: true, effect: RoutingEffect.PRESERVE } : { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.MOVE_EVIDENCE_MISSING };
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
      return context.transferSourceAvailable === true ? { valid: true, effect: RoutingEffect.PRESERVE } : { valid: false, fallback: RoutingDestination.KEEP_UNASSIGNED, reason: RoutingReason.TRANSFER_SOURCE_UNAVAILABLE };
    }
    if (destination === RoutingDestination.ACTIVE_RECIPE) {
      if (context.protectedItemIds.has(context.item.itemId)) {
        return { valid: false, fallback: RoutingDestination.ASK_USER, reason: RoutingReason.PROTECTED_FROM_CONSUMPTION };
      }
      const evidenceReady = [
        "hasTradabilityEvidence",
        "hasLockedEvidence",
        "hasProtectedEvidence",
        "hasStartingSquadEvidence",
        "hasSpecialEvidence"
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

  // src/routing/routing-engine.js
  var stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  var fingerprint = (value) => {
    const input = stable(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };
  var defaultDecision = (context) => {
    if (context.ambiguousDuplicate) {
      return [RoutingDestination.ASK_USER, RoutingReason.DUPLICATE_IDENTITY_AMBIGUOUS];
    }
    if (!context.duplicate) {
      return [RoutingDestination.CLUB, RoutingReason.NON_DUPLICATE_TO_CLUB];
    }
    if (context.tradeability === RoutingTradeability.UNTRADEABLE && context.storageFreeSlots > 0) {
      return [RoutingDestination.SBC_STORAGE, RoutingReason.DUPLICATE_TO_STORAGE];
    }
    if (context.tradeability === RoutingTradeability.TRADEABLE) {
      return [RoutingDestination.KEEP_UNASSIGNED, RoutingReason.TRADEABLE_DUPLICATE_PRESERVED];
    }
    return [RoutingDestination.ASK_USER, RoutingReason.TRADEABILITY_UNVERIFIED];
  };
  var tradeabilityOf = (item) => item.hasTradabilityEvidence !== true ? RoutingTradeability.UNKNOWN : item.isTradable === true ? RoutingTradeability.TRADEABLE : RoutingTradeability.UNTRADEABLE;
  var RoutingEngine = class {
    plan({
      inventorySnapshot,
      ruleset,
      duplicateRelations = null,
      protectionAnalysis = {},
      recipeCandidates = [],
      activityGuard = { state: "NORMAL" }
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
        [...protectionAnalysis.protectedItemIds ?? []].map(String)
      );
      const verifiedRecipeItems = new Set(
        recipeCandidates.filter((entry) => entry?.verified === true).flatMap((entry) => entry.acceptedItemIds ?? []).map(String)
      );
      const capacity = Number.isSafeInteger(inventorySnapshot.storageCapacity) ? inventorySnapshot.storageCapacity : null;
      let storageFreeSlots = capacity == null ? 0 : Math.max(0, capacity - (inventorySnapshot.storage?.items?.length ?? 0));
      const decisions = [];
      const items = [...inventorySnapshot.unassigned?.items ?? []].sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)));
      for (const item of items) {
        const key = getDuplicateKey(item);
        const relation = key ? relationByKey.get(key) : null;
        const duplicate = Boolean(
          item.isDuplicate === true || relation && relation.copies.club.length + relation.copies.sbcStorage.length + relation.copies.unassigned.length > 1
        );
        const context = {
          item,
          location: item.location,
          duplicate,
          ambiguousDuplicate: ambiguousIds.has(String(item.itemId)) || item.isDuplicate === true && !key,
          tradeability: tradeabilityOf(item),
          rating: Number(item.rating || 0),
          rarity: item.rarityName ?? item.rarityId ?? "",
          cardType: item.cardType ?? "",
          itemType: item.itemType ?? "player",
          storageFreeSlots,
          transferSourceAvailable: relations.transferSourceAvailable,
          protectedItemIds,
          recipeVerified: verifiedRecipeItems.has(String(item.itemId)),
          activityGuard
        };
        const matched = normalizedRuleset.rules.find(
          (rule) => rule.enabled && routingRuleMatches(rule, context)
        );
        let [destination, reason] = matched ? [matched.destination, RoutingReason.RULE_MATCHED] : defaultDecision(context);
        const validation = validateRoutingDestination(destination, context);
        if (!validation.valid) {
          destination = validation.fallback;
          reason = validation.reason;
        }
        if (destination === RoutingDestination.SBC_STORAGE) storageFreeSlots -= 1;
        decisions.push(Object.freeze({
          itemRef: Object.freeze({
            itemId: String(item.itemId),
            generation: inventorySnapshot.generation
          }),
          destination,
          effect: validation.valid ? validation.effect : destination === RoutingDestination.KEEP_UNASSIGNED ? RoutingEffect.PRESERVE : RoutingEffect.MANUAL,
          ruleId: matched?.id ?? null,
          reasonCodes: Object.freeze([reason]),
          explanation: explainRoutingDecision([reason])
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
          hasTradabilityEvidence: item.hasTradabilityEvidence
        })),
        storageCapacity: inventorySnapshot.storageCapacity
      });
      const rulesetFingerprint = fingerprint(normalizedRuleset);
      return Object.freeze({
        schemaVersion: 1,
        inventoryGeneration: inventorySnapshot.generation,
        inventoryFingerprint,
        rulesetFingerprint,
        rulesetId: normalizedRuleset.id,
        decisions: Object.freeze(decisions),
        blockers: Object.freeze(decisions.filter(({ destination }) => destination === RoutingDestination.ASK_USER).map(({ itemRef, reasonCodes }) => Object.freeze({ itemRef, reasonCodes }))),
        canExecute: false,
        readOnly: true
      });
    }
  };

  // src/dev/limits.js
  var DEV_LIMITS = Object.freeze({
    maxClasses: 500,
    maxMethodsPerClass: 192,
    maxCapabilities: 128,
    maxSnapshots: 5,
    maxSnapshotBytes: 256 * 1024,
    maxSnapshotHistoryBytes: 768 * 1024,
    maxDiffItems: 750,
    maxRoutes: 100,
    maxNetworkRecords: 200,
    maxLogs: 250,
    maxCollectionItems: 250,
    maxObjectKeys: 100,
    maxDepth: 6,
    maxStringLength: 1e3,
    maxExportBytes: 512 * 1024
  });
  var MIN_LIMIT = 1;
  var MAX_LIMIT = 1e7;
  var BYTE_LIMIT_KEYS = /* @__PURE__ */ new Set([
    "maxSnapshotBytes",
    "maxSnapshotHistoryBytes",
    "maxExportBytes"
  ]);
  function clampLimit(value, fallback, minimum = MIN_LIMIT) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(MAX_LIMIT, Math.max(minimum, Math.floor(numeric)));
  }
  function resolveDevLimits(overrides = {}) {
    const resolved = {};
    for (const [key, fallback] of Object.entries(DEV_LIMITS)) {
      resolved[key] = clampLimit(
        overrides?.[key],
        fallback,
        BYTE_LIMIT_KEYS.has(key) ? 1024 : MIN_LIMIT
      );
    }
    return Object.freeze(resolved);
  }
  function utf8ByteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  }
  function jsonByteLength(value) {
    try {
      return utf8ByteLength(JSON.stringify(value));
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  // src/dev/redaction.js
  var REDACTED2 = "[REDACTED]";
  var OMITTED_ACCESSOR2 = "[Accessor omitted]";
  var SECRET_KEY_PARTS = Object.freeze([
    "authorization",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "authtoken",
    "sessiontoken",
    "sessionid",
    "password",
    "passwd",
    "clientsecret",
    "apikey",
    "apiSecret",
    "cookie",
    "setcookie",
    "csrf",
    "xsrf"
  ]);
  function normalizeKey(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function isSensitiveKey(key) {
    const normalized = normalizeKey(key);
    if ([
      "auth",
      "credential",
      "credentials",
      "session",
      "sid",
      "token",
      "secret",
      "xutsid"
    ].includes(normalized) || normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password") || normalized.endsWith("cookie") || normalized.endsWith("sid")) {
      return true;
    }
    return SECRET_KEY_PARTS.some((part) => normalized.includes(part.toLowerCase()));
  }
  function truncateDiagnosticString(value, maxLength = DEV_LIMITS.maxStringLength) {
    const text = String(value);
    const limit = clampLimit(maxLength, DEV_LIMITS.maxStringLength);
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
  }
  function redactSecretText(value, maxLength = DEV_LIMITS.maxStringLength) {
    let text = String(value);
    text = text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, REDACTED2);
    text = text.replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      REDACTED2
    );
    text = text.replace(
      /([?&](?:access_token|refresh_token|id_token|token|session|sid|x-ut-sid|code|password|secret)=)[^&#\s]*/gi,
      `$1${REDACTED2}`
    );
    text = text.replace(
      /\b((?:access_token|refresh_token|id_token|token|session|sid|x-ut-sid|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED2}`
    );
    return truncateDiagnosticString(text, maxLength);
  }
  function normalizeOptions(options = {}) {
    return {
      maxDepth: clampLimit(options.maxDepth, DEV_LIMITS.maxDepth),
      maxItems: clampLimit(options.maxItems, DEV_LIMITS.maxCollectionItems),
      maxKeys: clampLimit(options.maxKeys, DEV_LIMITS.maxObjectKeys),
      maxStringLength: clampLimit(
        options.maxStringLength,
        DEV_LIMITS.maxStringLength
      )
    };
  }
  function sanitizeInternal(value, options, depth, seen) {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      return redactSecretText(value, options.maxStringLength);
    }
    if (typeof value === "bigint") return truncateDiagnosticString(value, options.maxStringLength);
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      return void 0;
    }
    if (depth >= options.maxDepth) return "[Maximum depth reached]";
    if (seen.has(value)) return "[Circular]";
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (value instanceof Error) {
      return {
        name: truncateDiagnosticString(value.name || "Error", 100),
        message: redactSecretText(value.message || "", options.maxStringLength)
      };
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const result2 = [];
        let descriptors2;
        try {
          descriptors2 = Object.getOwnPropertyDescriptors(value);
        } catch {
          return "[Unreadable object]";
        }
        const length = Math.min(
          Number.isSafeInteger(descriptors2.length?.value) ? descriptors2.length.value : 0,
          options.maxItems
        );
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors2[index];
          if (!descriptor) continue;
          if (!("value" in descriptor)) {
            result2.push(OMITTED_ACCESSOR2);
            continue;
          }
          const sanitized = sanitizeInternal(
            descriptor.value,
            options,
            depth + 1,
            seen
          );
          if (sanitized !== void 0) result2.push(sanitized);
        }
        return result2;
      }
      let descriptors;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        return "[Unreadable object]";
      }
      const result = {};
      const keys = Object.keys(descriptors).sort().slice(0, options.maxKeys);
      for (const key of keys) {
        const safeKey = truncateDiagnosticString(key, 200);
        if (isSensitiveKey(key)) {
          result[safeKey] = REDACTED2;
          continue;
        }
        const descriptor = descriptors[key];
        if (!("value" in descriptor)) {
          result[safeKey] = OMITTED_ACCESSOR2;
          continue;
        }
        const sanitized = sanitizeInternal(
          descriptor.value,
          options,
          depth + 1,
          seen
        );
        if (sanitized !== void 0) result[safeKey] = sanitized;
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }
  function sanitizeDiagnosticValue(value, options = {}) {
    try {
      return sanitizeInternal(value, normalizeOptions(options), 0, /* @__PURE__ */ new WeakSet());
    } catch {
      return "[Unreadable object]";
    }
  }

  // src/dev/class-discovery.js
  var UT_CLASS_PATTERN = /^UT[A-Z][A-Za-z0-9_$]*$/;
  var STATIC_IGNORES = /* @__PURE__ */ new Set([
    "arguments",
    "caller",
    "length",
    "name",
    "prototype"
  ]);
  function safeOwnPropertyNames(value) {
    try {
      return Object.getOwnPropertyNames(value);
    } catch {
      return [];
    }
  }
  function safeDescriptor(value, key) {
    try {
      return Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return void 0;
    }
  }
  function describeMembers(target, ignoredNames, maxItems) {
    if (!target || typeof target !== "object" && typeof target !== "function") {
      return [];
    }
    const members = [];
    for (const name of safeOwnPropertyNames(target).sort()) {
      if (ignoredNames.has(name)) continue;
      const descriptor = safeDescriptor(target, name);
      if (!descriptor) continue;
      if (typeof descriptor.value === "function") {
        members.push({
          name: truncateDiagnosticString(name, 160),
          kind: "method",
          arity: Math.max(0, Math.floor(descriptor.value.length || 0))
        });
      } else if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        members.push({
          name: truncateDiagnosticString(name, 160),
          kind: "accessor",
          getter: typeof descriptor.get === "function",
          setter: typeof descriptor.set === "function"
        });
      }
      if (members.length >= maxItems) break;
    }
    return members;
  }
  function getDataDescriptorValue(target, key) {
    const descriptor = safeDescriptor(target, key);
    if (!descriptor || !("value" in descriptor)) {
      return { ok: false, accessor: !!descriptor };
    }
    return { ok: true, value: descriptor.value };
  }
  function discoverUTClasses(root = globalThis, options = {}) {
    const limits = resolveDevLimits(options);
    const matchingNames = safeOwnPropertyNames(root).filter((name) => UT_CLASS_PATTERN.test(name)).sort();
    const classes = [];
    for (const name of matchingNames.slice(0, limits.maxClasses)) {
      const rootValue = getDataDescriptorValue(root, name);
      if (!rootValue.ok || typeof rootValue.value !== "function") continue;
      const constructor = rootValue.value;
      const prototypeValue = getDataDescriptorValue(constructor, "prototype");
      classes.push({
        name,
        prototypeMembers: prototypeValue.ok ? describeMembers(
          prototypeValue.value,
          /* @__PURE__ */ new Set(["constructor"]),
          limits.maxMethodsPerClass
        ) : [],
        staticMembers: describeMembers(
          constructor,
          STATIC_IGNORES,
          limits.maxMethodsPerClass
        )
      });
    }
    return {
      classes,
      totalMatchingGlobals: matchingNames.length,
      truncated: matchingNames.length > limits.maxClasses
    };
  }
  function normalizeCapabilityPath(path) {
    const parts = Array.isArray(path) ? path : String(path || "").split(".");
    return parts.map((part) => String(part).trim()).filter(Boolean).slice(0, 16);
  }
  function inspectPath(root, path) {
    let current = root;
    for (const segment of path) {
      if (current === null || typeof current !== "object" && typeof current !== "function") {
        return { available: false, reason: "parent_missing", valueType: "undefined" };
      }
      const descriptor = safeDescriptor(current, segment);
      if (!descriptor) {
        return { available: false, reason: "missing", valueType: "undefined" };
      }
      if (!("value" in descriptor)) {
        return { available: false, reason: "accessor_blocked", valueType: "accessor" };
      }
      current = descriptor.value;
    }
    return { available: true, reason: null, valueType: typeof current };
  }
  function discoverCapabilities(root = globalThis, definitions = [], options = {}) {
    const limits = resolveDevLimits(options);
    const normalizedDefinitions = Array.isArray(definitions) ? definitions.slice(0, limits.maxCapabilities) : [];
    return normalizedDefinitions.map((definition, index) => {
      const path = normalizeCapabilityPath(definition?.path);
      const id = truncateDiagnosticString(
        definition?.id || path.join(".") || `capability-${index + 1}`,
        160
      );
      if (path.length === 0) {
        return { id, path: [], available: false, reason: "invalid_path", valueType: "undefined" };
      }
      const inspected = inspectPath(root, path);
      const expectedType = definition?.expectedType ? truncateDiagnosticString(definition.expectedType, 40) : null;
      const matchesExpectedType = !expectedType || inspected.available && inspected.valueType === expectedType;
      return {
        id,
        path,
        available: inspected.available && matchesExpectedType,
        reason: matchesExpectedType ? inspected.reason : "type_mismatch",
        valueType: inspected.valueType,
        expectedType
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  var DEFAULT_DISCOVERY_LIMITS = Object.freeze({
    maxClasses: DEV_LIMITS.maxClasses,
    maxMethodsPerClass: DEV_LIMITS.maxMethodsPerClass,
    maxCapabilities: DEV_LIMITS.maxCapabilities
  });

  // src/dev/metadata.js
  var ROUTE_TYPES = /* @__PURE__ */ new Set([
    "adapter",
    "hashchange",
    "navigation",
    "popstate",
    "pushState",
    "replaceState"
  ]);
  function parseHttpUrl(value, baseUrl) {
    try {
      const raw = String(value || "");
      const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
      if (!isAbsolute && !baseUrl) return null;
      const url = new URL(raw, baseUrl);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }
  function safePathname(url) {
    const decoded = (() => {
      try {
        return decodeURIComponent(url.pathname);
      } catch {
        return url.pathname;
      }
    })();
    return redactSecretText(decoded || "/", 500);
  }
  function sanitizeUrl(value, options = {}) {
    let url;
    if (value && typeof value === "object" && typeof value.origin === "string" && typeof value.pathname === "string") {
      url = parseHttpUrl(value.origin);
      if (url) url.pathname = value.pathname;
    } else {
      url = parseHttpUrl(value, options.baseUrl);
    }
    if (!url) return null;
    return {
      origin: url.origin,
      pathname: safePathname(url)
    };
  }
  function sanitizeRouteMetadata(input = {}, options = {}) {
    const from = sanitizeUrl(input.from, options);
    const to = sanitizeUrl(input.to, options);
    if (!from && !to) return null;
    const rawType = String(input.type || "navigation");
    return {
      timestamp: Number.isFinite(Number(input.timestamp)) ? Math.max(0, Math.floor(Number(input.timestamp))) : null,
      type: ROUTE_TYPES.has(rawType) ? rawType : "navigation",
      from,
      to,
      source: redactSecretText(input.source || "webapp", 80)
    };
  }
  function normalizeAllowedOrigins(values) {
    const origins = /* @__PURE__ */ new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const parsed = parseHttpUrl(value);
      if (parsed) origins.add(parsed.origin);
    }
    return origins;
  }
  function finiteInteger(value, minimum, maximum, fallback = null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(numeric)));
  }
  function sanitizeNetworkMetadata(input = {}, options = {}) {
    const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
    if (allowedOrigins.size === 0) return null;
    let url;
    if (typeof input.origin === "string" && typeof input.pathname === "string") {
      url = parseHttpUrl(input.origin);
      if (url) url.pathname = input.pathname;
    } else {
      url = parseHttpUrl(input.url || input.endpoint, options.baseUrl);
    }
    if (!url || !allowedOrigins.has(url.origin)) return null;
    const rawMethod = String(input.method || "GET").toUpperCase();
    const method = /^[A-Z]{1,12}$/.test(rawMethod) ? rawMethod : "OTHER";
    const status = finiteInteger(input.status, 0, 599, 0);
    const durationMs = Number(input.durationMs);
    const sizeBytes = Number(input.sizeBytes ?? input.size);
    return {
      timestamp: finiteInteger(input.timestamp ?? input.ts, 0, Number.MAX_SAFE_INTEGER),
      requestId: redactSecretText(input.requestId ?? input.id ?? "", 100),
      origin: url.origin,
      pathname: safePathname(url),
      method,
      status,
      ok: typeof input.ok === "boolean" ? input.ok : status >= 200 && status < 400,
      durationMs: Number.isFinite(durationMs) ? Math.min(6e5, Math.max(0, Math.round(durationMs * 100) / 100)) : null,
      sizeBytes: Number.isFinite(sizeBytes) ? Math.min(1e8, Math.max(0, Math.floor(sizeBytes))) : null,
      transport: ["adapter", "fetch", "xhr"].includes(input.transport) ? input.transport : "adapter",
      errorCode: input.errorCode ? redactSecretText(input.errorCode, 100) : null
    };
  }
  function sanitizeRouteBatch(records, options = {}) {
    const limit = clampLimit(options.maxItems, DEV_LIMITS.maxRoutes);
    return (Array.isArray(records) ? records : []).slice(-limit).map((record) => sanitizeRouteMetadata(record, options)).filter(Boolean);
  }
  function sanitizeNetworkBatch(records, options = {}) {
    const limit = clampLimit(options.maxItems, DEV_LIMITS.maxNetworkRecords);
    return (Array.isArray(records) ? records : []).slice(-limit).map((record) => sanitizeNetworkMetadata(record, options)).filter(Boolean);
  }

  // src/dev/diagnostics-export.js
  function sanitizeLogs(logs, limits) {
    return (Array.isArray(logs) ? logs : []).slice(-limits.maxLogs).map((entry) => {
      const safe = sanitizeDiagnosticValue(entry, {
        maxDepth: 5,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 750
      });
      return {
        timestamp: typeof safe?.timestamp === "string" ? safe.timestamp : null,
        level: ["debug", "info", "warn", "error"].includes(safe?.level) ? safe.level : null,
        action: typeof safe?.action === "string" ? truncateDiagnosticString(safe.action, 100) : null,
        code: typeof safe?.data?.code === "string" ? truncateDiagnosticString(safe.data.code, 100) : null
      };
    });
  }
  function sanitizeHealthChecks(checks, limits) {
    return (Array.isArray(checks) ? checks : []).slice(-Math.min(100, limits.maxCollectionItems)).map((entry) => {
      const safe = sanitizeDiagnosticValue(entry, {
        maxDepth: 4,
        maxItems: 100,
        maxKeys: 50,
        maxStringLength: 200
      });
      const capabilities = Array.isArray(safe?.capabilities) ? safe.capabilities.slice(0, 100).map((capability) => ({
        id: typeof capability?.id === "string" ? truncateDiagnosticString(capability.id, 100) : null,
        state: typeof capability?.state === "string" ? truncateDiagnosticString(capability.state, 50) : typeof capability?.status === "string" ? truncateDiagnosticString(capability.status, 50) : null
      })) : [];
      return {
        status: typeof safe?.status === "string" ? truncateDiagnosticString(safe.status, 50) : typeof safe?.state === "string" ? truncateDiagnosticString(safe.state, 50) : null,
        capabilities
      };
    });
  }
  function trimExportToLimit(bundle, maxBytes) {
    const trimOrder = [
      bundle.network,
      bundle.navigation,
      bundle.logs,
      bundle.healthChecks
    ];
    let changed = false;
    for (const collection of trimOrder) {
      while (jsonByteLength(bundle) > maxBytes && collection.length > 0) {
        collection.shift();
        changed = true;
      }
    }
    while (jsonByteLength(bundle) > maxBytes && Array.isArray(bundle.latestSnapshot?.classes) && bundle.latestSnapshot.classes.length > 0) {
      bundle.latestSnapshot.classes.pop();
      changed = true;
    }
    while (jsonByteLength(bundle) > maxBytes && Array.isArray(bundle.latestSnapshot?.capabilities) && bundle.latestSnapshot.capabilities.length > 0) {
      bundle.latestSnapshot.capabilities.pop();
      changed = true;
    }
    if (jsonByteLength(bundle) > maxBytes) {
      bundle.latestSnapshot = null;
      bundle.snapshotDiff = null;
      changed = true;
    }
    if (jsonByteLength(bundle) > maxBytes) {
      bundle.developerMode = { enabled: !!bundle.developerMode?.enabled };
      changed = true;
    }
    bundle.truncated = bundle.truncated || changed;
    return bundle;
  }
  function createDiagnosticsExport(input = {}, options = {}) {
    const limits = resolveDevLimits(options);
    const bundle = {
      schemaVersion: 1,
      product: truncateDiagnosticString(input.product || "FUT Magic", 100),
      extensionVersion: truncateDiagnosticString(input.extensionVersion || "unknown", 80),
      generatedAt: Number.isFinite(Number(input.generatedAt)) ? Math.max(0, Math.floor(Number(input.generatedAt))) : 0,
      developerMode: sanitizeDiagnosticValue(input.developerMode ?? { enabled: false }, {
        maxDepth: 3,
        maxItems: 20,
        maxKeys: 20,
        maxStringLength: 200
      }),
      latestSnapshot: sanitizeDiagnosticValue(input.latestSnapshot ?? null, {
        maxDepth: limits.maxDepth,
        maxItems: Math.max(limits.maxClasses, limits.maxMethodsPerClass),
        maxKeys: limits.maxObjectKeys,
        maxStringLength: limits.maxStringLength
      }),
      snapshotDiff: sanitizeDiagnosticValue(input.snapshotDiff ?? null, {
        maxDepth: limits.maxDepth,
        maxItems: limits.maxDiffItems,
        maxKeys: limits.maxObjectKeys,
        maxStringLength: limits.maxStringLength
      }),
      navigation: sanitizeRouteBatch(input.navigation, {
        ...options,
        maxItems: limits.maxRoutes
      }),
      network: sanitizeNetworkBatch(input.network, {
        ...options,
        maxItems: limits.maxNetworkRecords
      }),
      logs: sanitizeLogs(input.logs, limits),
      healthChecks: sanitizeHealthChecks(input.healthChecks, limits),
      truncated: false
    };
    return trimExportToLimit(bundle, limits.maxExportBytes);
  }

  // src/dev/snapshot.js
  function finiteTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  }
  function normalizeMember(member) {
    if (!member || typeof member !== "object") return null;
    const kind = member.kind === "accessor" ? "accessor" : "method";
    const normalized = {
      name: truncateDiagnosticString(member.name || "unknown", 160),
      kind
    };
    if (kind === "method") {
      normalized.arity = Number.isFinite(Number(member.arity)) ? Math.max(0, Math.floor(Number(member.arity))) : 0;
    } else {
      normalized.getter = !!member.getter;
      normalized.setter = !!member.setter;
    }
    return normalized;
  }
  function normalizeMembers(members, limit) {
    return (Array.isArray(members) ? members : []).slice(0, limit).map(normalizeMember).filter(Boolean).sort((a, b) => `${a.name}:${a.kind}`.localeCompare(`${b.name}:${b.kind}`));
  }
  function normalizeClasses(classes, limits) {
    return (Array.isArray(classes) ? classes : []).slice(0, limits.maxClasses).map((entry) => ({
      name: truncateDiagnosticString(entry?.name || "unknown", 160),
      prototypeMembers: normalizeMembers(
        entry?.prototypeMembers,
        limits.maxMethodsPerClass
      ),
      staticMembers: normalizeMembers(entry?.staticMembers, limits.maxMethodsPerClass)
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  function normalizeCapabilities2(capabilities, limits) {
    return (Array.isArray(capabilities) ? capabilities : []).slice(0, limits.maxCapabilities).map((entry, index) => ({
      id: truncateDiagnosticString(entry?.id || `capability-${index + 1}`, 160),
      path: (Array.isArray(entry?.path) ? entry.path : []).slice(0, 16).map((part) => truncateDiagnosticString(part, 100)),
      available: !!entry?.available,
      reason: entry?.reason ? truncateDiagnosticString(entry.reason, 80) : null,
      valueType: truncateDiagnosticString(entry?.valueType || "undefined", 40),
      expectedType: entry?.expectedType ? truncateDiagnosticString(entry.expectedType, 40) : null
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
  function trimSnapshotToByteLimit(snapshot, maxBytes) {
    const result = snapshot;
    while (jsonByteLength(result) > maxBytes && result.classes.length > 0) {
      result.classes.pop();
      result.truncated.classes = true;
      result.truncated.bytes = true;
    }
    while (jsonByteLength(result) > maxBytes && result.capabilities.length > 0) {
      result.capabilities.pop();
      result.truncated.capabilities = true;
      result.truncated.bytes = true;
    }
    if (jsonByteLength(result) > maxBytes) {
      result.bridgeHealth = null;
      result.selectors = null;
      result.route = null;
      result.truncated.bytes = true;
    }
    return result;
  }
  function createWebAppSnapshot(input = {}, options = {}) {
    const limits = resolveDevLimits(options);
    const sourceClasses = Array.isArray(input.classes) ? input.classes : [];
    const sourceCapabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
    const snapshot = {
      schemaVersion: 1,
      capturedAt: finiteTimestamp(input.capturedAt),
      extensionVersion: truncateDiagnosticString(input.extensionVersion || "unknown", 80),
      webAppVersion: truncateDiagnosticString(input.webAppVersion || "unknown", 120),
      classes: normalizeClasses(sourceClasses, limits),
      capabilities: normalizeCapabilities2(sourceCapabilities, limits),
      bridgeHealth: sanitizeDiagnosticValue(input.bridgeHealth ?? null, {
        maxDepth: 4,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 500
      }),
      selectors: sanitizeDiagnosticValue(input.selectors ?? null, {
        maxDepth: 3,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 300
      }),
      route: sanitizeDiagnosticValue(input.route ?? null, {
        maxDepth: 3,
        maxItems: 20,
        maxKeys: 20,
        maxStringLength: 500
      }),
      truncated: {
        classes: sourceClasses.length > limits.maxClasses,
        capabilities: sourceCapabilities.length > limits.maxCapabilities,
        bytes: false
      }
    };
    return trimSnapshotToByteLimit(snapshot, limits.maxSnapshotBytes);
  }
  function memberIdentity(member) {
    if (!member || typeof member !== "object") return null;
    return member.kind === "accessor" ? `${member.name}:accessor:${member.getter ? 1 : 0}:${member.setter ? 1 : 0}` : `${member.name}:method:${member.arity}`;
  }
  function difference(left, right) {
    const filteredLeft = left.filter(Boolean);
    const rightSet = new Set(right.filter(Boolean));
    return filteredLeft.filter((value) => !rightSet.has(value));
  }
  function classMap(snapshot) {
    return new Map(
      (Array.isArray(snapshot?.classes) ? snapshot.classes : []).map((entry) => [
        String(entry.name),
        entry
      ])
    );
  }
  function capabilityMap(snapshot) {
    return new Map(
      (Array.isArray(snapshot?.capabilities) ? snapshot.capabilities : []).map((entry) => [
        String(entry.id),
        entry
      ])
    );
  }
  function comparableCapability(entry) {
    return JSON.stringify({
      available: !!entry?.available,
      reason: entry?.reason ?? null,
      valueType: entry?.valueType ?? "undefined",
      expectedType: entry?.expectedType ?? null
    });
  }
  function diffWebAppSnapshots(previous = {}, current = {}, options = {}) {
    const limits = resolveDevLimits(options);
    const beforeClasses = classMap(previous);
    const afterClasses = classMap(current);
    const allClassNames = [.../* @__PURE__ */ new Set([...beforeClasses.keys(), ...afterClasses.keys()])].sort();
    const addedClasses = [];
    const removedClasses = [];
    const changedClasses = [];
    for (const name of allClassNames) {
      const before = beforeClasses.get(name);
      const after = afterClasses.get(name);
      if (!before) {
        addedClasses.push(name);
        continue;
      }
      if (!after) {
        removedClasses.push(name);
        continue;
      }
      const beforePrototype = (before.prototypeMembers || []).map(memberIdentity);
      const afterPrototype = (after.prototypeMembers || []).map(memberIdentity);
      const beforeStatic = (before.staticMembers || []).map(memberIdentity);
      const afterStatic = (after.staticMembers || []).map(memberIdentity);
      const changes = {
        name,
        prototypeAdded: difference(afterPrototype, beforePrototype),
        prototypeRemoved: difference(beforePrototype, afterPrototype),
        staticAdded: difference(afterStatic, beforeStatic),
        staticRemoved: difference(beforeStatic, afterStatic)
      };
      if (changes.prototypeAdded.length || changes.prototypeRemoved.length || changes.staticAdded.length || changes.staticRemoved.length) {
        changedClasses.push(changes);
      }
    }
    const beforeCapabilities = capabilityMap(previous);
    const afterCapabilities = capabilityMap(current);
    const capabilityChanges = [];
    for (const id of [.../* @__PURE__ */ new Set([...beforeCapabilities.keys(), ...afterCapabilities.keys()])].sort()) {
      const before = beforeCapabilities.get(id) ?? null;
      const after = afterCapabilities.get(id) ?? null;
      if (!before || !after || comparableCapability(before) !== comparableCapability(after)) {
        capabilityChanges.push({
          id,
          before: before ? { available: !!before.available, reason: before.reason ?? null, valueType: before.valueType } : null,
          after: after ? { available: !!after.available, reason: after.reason ?? null, valueType: after.valueType } : null
        });
      }
    }
    const totals = {
      addedClasses: addedClasses.length,
      removedClasses: removedClasses.length,
      changedClasses: changedClasses.length,
      capabilityChanges: capabilityChanges.length
    };
    let remaining = limits.maxDiffItems;
    const take = (values) => {
      const result2 = values.slice(0, remaining);
      remaining -= result2.length;
      return result2;
    };
    const result = {
      schemaVersion: 1,
      previousCapturedAt: finiteTimestamp(previous?.capturedAt),
      currentCapturedAt: finiteTimestamp(current?.capturedAt),
      addedClasses: take(addedClasses),
      removedClasses: take(removedClasses),
      changedClasses: take(changedClasses),
      capabilityChanges: take(capabilityChanges),
      totals,
      truncated: totals.addedClasses + totals.removedClasses + totals.changedClasses + totals.capabilityChanges > limits.maxDiffItems
    };
    while (jsonByteLength(result) > limits.maxSnapshotBytes && result.changedClasses.length) {
      result.changedClasses.pop();
      result.truncated = true;
    }
    while (jsonByteLength(result) > limits.maxSnapshotBytes && result.capabilityChanges.length) {
      result.capabilityChanges.pop();
      result.truncated = true;
    }
    while (jsonByteLength(result) > limits.maxSnapshotBytes && result.addedClasses.length) {
      result.addedClasses.pop();
      result.truncated = true;
    }
    while (jsonByteLength(result) > limits.maxSnapshotBytes && result.removedClasses.length) {
      result.removedClasses.pop();
      result.truncated = true;
    }
    return result;
  }
  function appendBoundedSnapshot(history, snapshot, options = {}) {
    const limits = resolveDevLimits(options);
    const next = [...Array.isArray(history) ? history : [], snapshot].slice(
      -limits.maxSnapshots
    );
    while (next.length > 0 && next.reduce((total, entry) => total + jsonByteLength(entry), 0) > limits.maxSnapshotHistoryBytes) {
      next.shift();
    }
    return next;
  }
  var DEFAULT_SNAPSHOT_LIMITS = Object.freeze({
    maxSnapshots: DEV_LIMITS.maxSnapshots,
    maxSnapshotBytes: DEV_LIMITS.maxSnapshotBytes,
    maxSnapshotHistoryBytes: DEV_LIMITS.maxSnapshotHistoryBytes
  });

  // src/dev/debug-mode.js
  var DeveloperModeDisabledError = class extends Error {
    constructor() {
      super("Developer Mode is disabled");
      this.name = "DeveloperModeDisabledError";
      this.code = "DEVELOPER_MODE_DISABLED";
    }
  };
  function assertEnabled(enabled) {
    if (!enabled) throw new DeveloperModeDisabledError();
  }
  function createDeveloperMode(options = {}) {
    const root = options.root ?? globalThis;
    const limits = resolveDevLimits(options.limits);
    const capabilityDefinitions = Array.isArray(options.capabilityDefinitions) ? options.capabilityDefinitions : [];
    const allowedNetworkOrigins = Array.isArray(options.allowedNetworkOrigins) ? [...options.allowedNetworkOrigins] : [];
    const now = typeof options.now === "function" ? options.now : Date.now;
    let enabled = false;
    let snapshots = [];
    let navigation = [];
    let network = [];
    let logs = [];
    function enable() {
      enabled = true;
      return getStatus();
    }
    function disable({ clearEphemeral = true } = {}) {
      enabled = false;
      if (clearEphemeral) {
        navigation = [];
        network = [];
        logs = [];
      }
      return getStatus();
    }
    function getStatus() {
      return {
        enabled,
        instrumentation: "read-only-on-demand",
        hooksInstalled: false,
        snapshotCount: snapshots.length,
        routeCount: navigation.length,
        networkCount: network.length,
        logCount: logs.length
      };
    }
    function discover() {
      assertEnabled(enabled);
      const classDiscovery = discoverUTClasses(root, limits);
      return {
        ...classDiscovery,
        capabilities: discoverCapabilities(root, capabilityDefinitions, limits)
      };
    }
    function captureSnapshot(details = {}) {
      assertEnabled(enabled);
      const discovery = discover();
      const snapshot = createWebAppSnapshot(
        {
          capturedAt: details.capturedAt ?? now(),
          extensionVersion: options.extensionVersion,
          webAppVersion: details.webAppVersion ?? options.webAppVersion,
          classes: discovery.classes,
          capabilities: discovery.capabilities,
          bridgeHealth: details.bridgeHealth,
          selectors: details.selectors,
          route: details.route
        },
        limits
      );
      snapshots = appendBoundedSnapshot(snapshots, snapshot, limits);
      return sanitizeDiagnosticValue(snapshot, {
        maxDepth: limits.maxDepth,
        maxItems: Math.max(limits.maxClasses, limits.maxMethodsPerClass),
        maxKeys: limits.maxObjectKeys,
        maxStringLength: limits.maxStringLength
      });
    }
    function compareLatestSnapshots() {
      if (snapshots.length < 2) return null;
      return diffWebAppSnapshots(
        snapshots[snapshots.length - 2],
        snapshots[snapshots.length - 1],
        limits
      );
    }
    function recordRoute(input) {
      if (!enabled) return false;
      const sanitized = sanitizeRouteMetadata(input);
      if (!sanitized) return false;
      navigation = [...navigation, sanitized].slice(-limits.maxRoutes);
      return true;
    }
    function recordNetwork(input) {
      if (!enabled) return false;
      const sanitized = sanitizeNetworkMetadata(input, {
        allowedOrigins: allowedNetworkOrigins
      });
      if (!sanitized) return false;
      network = [...network, sanitized].slice(-limits.maxNetworkRecords);
      return true;
    }
    function recordLog(input) {
      if (!enabled) return false;
      const sanitized = sanitizeDiagnosticValue(input, {
        maxDepth: 5,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 750
      });
      logs = [...logs, sanitized].slice(-limits.maxLogs);
      return true;
    }
    function exportDiagnostics(details = {}) {
      return createDiagnosticsExport(
        {
          ...details,
          generatedAt: details.generatedAt ?? now(),
          extensionVersion: options.extensionVersion,
          developerMode: getStatus(),
          latestSnapshot: snapshots.at(-1) ?? null,
          snapshotDiff: compareLatestSnapshots(),
          navigation,
          network,
          logs
        },
        { ...limits, allowedOrigins: allowedNetworkOrigins }
      );
    }
    function clearSnapshots() {
      snapshots = [];
    }
    return Object.freeze({
      enable,
      disable,
      isEnabled: () => enabled,
      getStatus,
      discover,
      captureSnapshot,
      compareLatestSnapshots,
      recordRoute,
      recordNetwork,
      recordLog,
      exportDiagnostics,
      clearSnapshots
    });
  }

  // src/ea/controller-adapter.js
  var requireBridge = () => {
    const bridge = globalThis.window?.eaData?.grindPilot;
    if (!bridge) {
      const error = new Error("GrindPilot EA controller bridge is unavailable");
      error.code = "EA_BRIDGE_UNAVAILABLE";
      throw error;
    }
    return bridge;
  };
  var verifiedValue = (result, operation) => {
    if (result?.status === "verified") return result.value;
    const error = new Error(result?.reason || `${operation} was not verified`);
    error.code = result?.status === "ambiguous" ? "EA_STATE_AMBIGUOUS" : result?.status === "not_applied" ? "EA_OPERATION_NOT_APPLIED" : "EA_OPERATION_UNAVAILABLE";
    error.evidence = result?.evidence ?? null;
    error.result = result ?? null;
    if (result?.status === "not_applied") {
      error.notApplied = true;
      error.safeToRetry = true;
    }
    throw error;
  };
  var ControllerGameVersion = Object.freeze({
    FC26: "fc26",
    FC27: "fc27",
    UNKNOWN: "unknown"
  });
  var ControllerGameVersionObservation = Object.freeze({
    OBSERVED: "observed",
    UNVERIFIED: "unverified",
    COMPATIBILITY_DEFAULT: "compatibility_default"
  });
  var ownDataProperty = (input, key) => {
    if (input == null || typeof input !== "object") return { present: false, value: void 0 };
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return { present: true, value: void 0 };
    }
    if (!descriptor) return { present: false, value: void 0 };
    return { present: true, value: "value" in descriptor ? descriptor.value : void 0 };
  };
  var boundedScalar = (input, key, maxLength, { allowNumber = false } = {}) => {
    const property = ownDataProperty(input, key);
    const value = property.value;
    if (allowNumber && Number.isSafeInteger(value)) return String(value);
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
  };
  var normalizeVersionFields = (input) => {
    const versionProperty = ownDataProperty(input, "gameVersion");
    if (!versionProperty.present) {
      return {
        gameVersion: ControllerGameVersion.FC26,
        gameVersionObservation: ControllerGameVersionObservation.COMPATIBILITY_DEFAULT,
        gameVersionSource: "legacy_bridge_v1"
      };
    }
    const value = typeof versionProperty.value === "string" ? versionProperty.value.trim().toLowerCase() : "";
    if (![ControllerGameVersion.FC26, ControllerGameVersion.FC27].includes(value)) {
      return {
        gameVersion: ControllerGameVersion.UNKNOWN,
        gameVersionObservation: ControllerGameVersionObservation.UNVERIFIED,
        gameVersionSource: "none"
      };
    }
    const observation = boundedScalar(input, "gameVersionObservation", 32) === ControllerGameVersionObservation.UNVERIFIED ? ControllerGameVersionObservation.UNVERIFIED : ControllerGameVersionObservation.OBSERVED;
    const declaredSource = boundedScalar(input, "gameVersionSource", 64);
    return {
      gameVersion: value,
      gameVersionObservation: observation,
      gameVersionSource: declaredSource === "ea_runtime" ? declaredSource : "main_world_context"
    };
  };
  var normalizeControllerContext = (input) => {
    let prototype;
    try {
      prototype = input != null && typeof input === "object" && !Array.isArray(input) ? Object.getPrototypeOf(input) : void 0;
    } catch {
      prototype = void 0;
    }
    const context = prototype === Object.prototype || prototype === null ? input : { gameVersion: ControllerGameVersion.UNKNOWN };
    return Object.freeze({
      ...normalizeVersionFields(context),
      route: boundedScalar(context, "route", 512),
      setId: boundedScalar(context, "setId", 128, { allowNumber: true }),
      setName: boundedScalar(context, "setName", 240),
      challengeId: boundedScalar(context, "challengeId", 128, { allowNumber: true }),
      challengeName: boundedScalar(context, "challengeName", 240),
      challengeCompleted: ownDataProperty(context, "challengeCompleted").value === true,
      bridgeReady: ownDataProperty(context, "bridgeReady").value === true
    });
  };
  var ControllerAdapter = class {
    async health() {
      return verifiedValue(await requireBridge().getHealth(), "Bridge health check");
    }
    async getContext() {
      return normalizeControllerContext(await requireBridge().getContext());
    }
    async readInventory() {
      return verifiedValue(await requireBridge().readInventory(), "Inventory refresh");
    }
    async solveCurrentSbc(options = {}) {
      return verifiedValue(
        await requireBridge().solveCurrentSbc(options),
        "SBC solve"
      );
    }
    async submitCurrentSbc(intent = {}) {
      return verifiedValue(
        await requireBridge().submitCurrentSbc(intent),
        "SBC submission"
      );
    }
    async listOwnedPacks() {
      const packs = verifiedValue(
        await requireBridge().listOwnedRewardPacks(),
        "Owned-pack listing"
      );
      return packs.map((pack) => ({ ...pack, packId: String(pack.id), owned: true }));
    }
    async claimReward(rewardRef = {}, beforePacks = null) {
      const value = verifiedValue(
        await requireBridge().claimCurrentReward({
          ...rewardRef,
          beforePacks: Array.isArray(beforePacks) ? beforePacks.map((pack) => ({
            ...pack,
            id: String(pack?.packId ?? pack?.id ?? "")
          })) : null
        }),
        "Reward claim"
      );
      return {
        claimed: true,
        success: true,
        packId: String(value?.pack?.id ?? ""),
        rewardRef
      };
    }
    async openOwnedPack({ packId: packId2 }) {
      const value = verifiedValue(
        await requireBridge().openOwnedRewardPack({ packId: packId2 }),
        "Reward-pack opening"
      );
      return {
        opened: true,
        packId: String(value.packId),
        items: (value.itemIds ?? []).map((itemId) => ({ itemId }))
      };
    }
    async resolveUnassigned(policy = {}) {
      return verifiedValue(
        await requireBridge().resolveUnassigned(policy),
        "Unassigned resolution"
      );
    }
    async getPlayerPick(pickId = null) {
      const value = verifiedValue(
        await requireBridge().readPlayerPick({ pickId }),
        "Player-pick inspection"
      );
      return {
        ...value,
        id: value.pickIdentity ?? null,
        pickId: value.pickIdentity ?? null,
        offers: Array.isArray(value.offers) ? value.offers : []
      };
    }
    async selectPlayerPick(intent) {
      const value = verifiedValue(
        await requireBridge().selectPlayerPick(intent),
        "Player-pick selection"
      );
      return { success: true, ...value };
    }
    async organizeIntoSbc(intent = {}) {
      return verifiedValue(
        await requireBridge().organizeIntoSbc(intent),
        "Organizer SBC submission"
      );
    }
    async readSbcChallengeState(query = {}) {
      return verifiedValue(
        await requireBridge().readSbcChallengeState(query),
        "SBC challenge state read"
      );
    }
    async getCapabilityHealth() {
      return verifiedValue(
        await requireBridge().getCapabilityHealth(),
        "Capability health read"
      );
    }
    async readCurrentSbcProject() {
      return verifiedValue(
        await requireBridge().readCurrentSbcProject(),
        "Current SBC project read"
      );
    }
    async findSbcTarget(query = {}) {
      return verifiedValue(
        await requireBridge().findSbcTarget(query),
        "SBC target lookup"
      );
    }
    async readLegacySequences() {
      return verifiedValue(
        await requireBridge().readLegacySequences(),
        "Legacy Sequence read"
      );
    }
  };

  // src/ea/page-storage-area.js
  var COMMAND_TYPE = "GRINDPILOT_STATE_COMMAND_V2";
  var DEFAULT_TIMEOUT_MS = 5e3;
  var STORAGE_KEYS = Object.freeze({
    activity: "grindpilot.activity.v1",
    activityLedger: "grindpilot.activity-ledger.v1",
    profiles: "grindpilot.profiles.v1",
    projects: "grindpilot.projects.v1",
    settings: "grindpilot.settings.v1"
  });
  var DIRECT_STORAGE_ACTIONS = /* @__PURE__ */ new Set([
    "BOOTSTRAP_LOAD",
    "SETTINGS_SAVE",
    "ACTIVITY_SAVE",
    "ACTIVITY_LEDGER_LOAD",
    "ACTIVITY_LEDGER_SAVE",
    "PROJECTS_SAVE",
    "PROFILE_LIST",
    "PROFILE_GET",
    "PROFILE_PUT",
    "PROFILE_DELETE"
  ]);
  var requestId = () => globalThis.crypto?.randomUUID?.() ?? `gp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  var activityLedgerKey = (partitionKey) => {
    const token = String(partitionKey ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(token)) {
      throw new TypeError("Activity ledger partition is invalid");
    }
    return `${STORAGE_KEYS.activityLedger}:${token}`;
  };
  var PageStorageArea = class {
    constructor({
      runtime = globalThis.chrome?.runtime,
      storage = globalThis.chrome?.storage?.local,
      timeoutMs = DEFAULT_TIMEOUT_MS
    } = {}) {
      if (!runtime?.sendMessage) {
        throw new TypeError("PageStorageArea requires the extension runtime API");
      }
      this.runtime = runtime;
      this.storage = storage?.get && storage?.set && storage?.remove ? storage : null;
      this.timeoutMs = timeoutMs;
      this.disposed = false;
    }
    command(action, payload = null) {
      if (this.disposed) return Promise.reject(new Error("GrindPilot state adapter disposed"));
      if (this.storage && DIRECT_STORAGE_ACTIONS.has(action)) {
        return this.directCommand(action, payload);
      }
      const id = requestId();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          callback();
        };
        const timeoutId = setTimeout(() => finish(() => {
          const error = new Error(`GrindPilot state command ${action} timed out`);
          error.code = "GP_STATE_TIMEOUT";
          reject(error);
        }), this.timeoutMs);
        this.runtime.sendMessage(
          { type: COMMAND_TYPE, requestId: id, action, payload },
          (response) => finish(() => {
            const runtimeError = this.runtime?.lastError;
            if (runtimeError || !response?.ok) {
              const error = new Error(runtimeError?.message || response?.error?.message || "GrindPilot state command failed");
              error.code = response?.error?.code || "GP_STATE_FAILED";
              error.details = response?.error?.details ?? null;
              reject(error);
            } else resolve(response.data);
          })
        );
      });
    }
    storageCall(method, ...args) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          callback();
        };
        const timeoutId = setTimeout(() => finish(() => {
          const error = new Error(`GrindPilot storage ${method} timed out`);
          error.code = "GP_STATE_TIMEOUT";
          reject(error);
        }), this.timeoutMs);
        try {
          this.storage[method](...args, (result) => finish(() => {
            const runtimeError = this.runtime?.lastError;
            if (runtimeError) {
              const error = new Error(runtimeError.message || `GrindPilot storage ${method} failed`);
              error.code = "GP_STATE_STORAGE_FAILED";
              reject(error);
            } else resolve(result);
          }));
        } catch (cause) {
          finish(() => {
            const error = new Error(cause?.message || `GrindPilot storage ${method} failed`);
            error.code = "GP_STATE_STORAGE_FAILED";
            error.cause = cause;
            reject(error);
          });
        }
      });
    }
    async directCommand(action, payload = null) {
      const input = payload && typeof payload === "object" ? payload : {};
      if (action === "BOOTSTRAP_LOAD") {
        const stored2 = await this.storageCall("get", [
          STORAGE_KEYS.activity,
          STORAGE_KEYS.projects,
          STORAGE_KEYS.settings
        ]);
        return {
          activity: Array.isArray(stored2?.[STORAGE_KEYS.activity]) ? stored2[STORAGE_KEYS.activity] : [],
          projects: Array.isArray(stored2?.[STORAGE_KEYS.projects]) ? stored2[STORAGE_KEYS.projects] : [],
          settings: stored2?.[STORAGE_KEYS.settings] && typeof stored2[STORAGE_KEYS.settings] === "object" && !Array.isArray(stored2[STORAGE_KEYS.settings]) ? stored2[STORAGE_KEYS.settings] : {}
        };
      }
      if (action === "SETTINGS_SAVE") {
        await this.storageCall("set", { [STORAGE_KEYS.settings]: input.value });
        return true;
      }
      if (action === "ACTIVITY_SAVE") {
        await this.storageCall("set", { [STORAGE_KEYS.activity]: input.value });
        return true;
      }
      if (action === "ACTIVITY_LEDGER_LOAD") {
        const key = activityLedgerKey(input.partitionKey);
        const stored2 = await this.storageCall("get", [key]);
        return stored2?.[key] ?? null;
      }
      if (action === "ACTIVITY_LEDGER_SAVE") {
        const key = activityLedgerKey(input.partitionKey);
        await this.storageCall("set", { [key]: input.value });
        return true;
      }
      if (action === "PROJECTS_SAVE") {
        await this.storageCall("set", { [STORAGE_KEYS.projects]: input.value });
        return true;
      }
      const stored = await this.storageCall("get", [STORAGE_KEYS.profiles]);
      const profiles = stored?.[STORAGE_KEYS.profiles] && typeof stored[STORAGE_KEYS.profiles] === "object" && !Array.isArray(stored[STORAGE_KEYS.profiles]) ? structuredClone(stored[STORAGE_KEYS.profiles]) : {};
      if (action === "PROFILE_LIST") return Object.values(profiles);
      const id = String(input.id ?? input.profile?.id ?? "").trim();
      if (action === "PROFILE_GET") return profiles[id] ?? null;
      if (action === "PROFILE_PUT") {
        profiles[id] = structuredClone(input.profile);
        await this.storageCall("set", { [STORAGE_KEYS.profiles]: profiles });
        return profiles[id];
      }
      if (!Object.hasOwn(profiles, id)) return false;
      delete profiles[id];
      if (Object.keys(profiles).length) {
        await this.storageCall("set", { [STORAGE_KEYS.profiles]: profiles });
      } else {
        await this.storageCall("remove", [STORAGE_KEYS.profiles]);
      }
      return true;
    }
    loadBootstrap() {
      return this.command("BOOTSTRAP_LOAD");
    }
    saveSettings(value) {
      return this.command("SETTINGS_SAVE", { value });
    }
    saveActivity(value) {
      return this.command("ACTIVITY_SAVE", { value });
    }
    loadActivityLedger(partitionKey) {
      return this.command("ACTIVITY_LEDGER_LOAD", { partitionKey });
    }
    saveActivityLedger(partitionKey, value) {
      return this.command("ACTIVITY_LEDGER_SAVE", { partitionKey, value });
    }
    saveProjects(value) {
      return this.command("PROJECTS_SAVE", { value });
    }
    listProfiles() {
      return this.command("PROFILE_LIST");
    }
    getProfile(id) {
      return this.command("PROFILE_GET", { id });
    }
    putProfile(profile) {
      return this.command("PROFILE_PUT", { profile });
    }
    deleteProfile(id) {
      return this.command("PROFILE_DELETE", { id });
    }
    loadActiveRun(ownerId) {
      return this.command("RUN_LOAD_ACTIVE", { ownerId });
    }
    loadRun(runId, ownerId) {
      return this.command("RUN_LOAD", { runId, ownerId });
    }
    createRun(run, ownerId) {
      return this.command("RUN_CREATE", { run, ownerId });
    }
    saveRun(run, expectedRevision, ownerId) {
      return this.command("RUN_SAVE", { run, expectedRevision, ownerId });
    }
    assertRunOwnership(runId, ownerId) {
      return this.command("RUN_ASSERT_OWNER", { runId, ownerId });
    }
    clearActiveRun(runId, ownerId) {
      return this.command("RUN_CLEAR", { runId, ownerId });
    }
    dispose() {
      this.disposed = true;
    }
  };

  // src/workflow/errors.js
  var WorkflowError = class extends Error {
    constructor(message, { code = "WORKFLOW_ERROR", details = null } = {}) {
      super(message);
      this.name = "WorkflowError";
      this.code = code;
      this.details = details;
    }
  };
  var WorkflowValidationError = class extends WorkflowError {
    constructor(issues) {
      const list = Array.isArray(issues) ? issues : [];
      super(
        list.length ? `Workflow validation failed: ${list[0].message}` : "Workflow validation failed",
        { code: "WORKFLOW_VALIDATION_FAILED", details: { issues: list } }
      );
      this.name = "WorkflowValidationError";
      this.issues = list;
    }
  };
  var WorkflowPersistenceError = class extends WorkflowError {
    constructor(message, details = null) {
      super(message, { code: "WORKFLOW_PERSISTENCE_FAILED", details });
      this.name = "WorkflowPersistenceError";
    }
  };
  var WorkflowConflictError = class extends WorkflowError {
    constructor(message = "Workflow revision conflict", details = null) {
      super(message, { code: "WORKFLOW_REVISION_CONFLICT", details });
      this.name = "WorkflowConflictError";
    }
  };
  var WorkflowTimeoutError = class extends WorkflowError {
    constructor(timeoutMs) {
      super(`Workflow step timed out after ${timeoutMs} ms`, {
        code: "STEP_TIMEOUT",
        details: { timeoutMs }
      });
      this.name = "WorkflowTimeoutError";
      this.timeoutMs = timeoutMs;
    }
  };

  // src/ea/workflow-storage-repository.js
  var STORAGE_KEY = "grindpilot.activeRun.v1";
  var clone = (value) => value == null ? value : structuredClone(value);
  var PageWorkflowRepository = class {
    constructor(storageArea, storageKey = STORAGE_KEY) {
      const domainApi = storageArea?.loadActiveRun && storageArea?.saveRun;
      const legacyApi = storageArea?.get && storageArea?.set && storageArea?.remove;
      if (!domainApi && !legacyApi) {
        throw new TypeError("PageWorkflowRepository requires a GrindPilot state area");
      }
      this.storageArea = storageArea;
      this.storageKey = storageKey;
      this.domainApi = Boolean(domainApi);
      this.ownerId = globalThis.crypto?.randomUUID?.() ?? `workflow-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    async loadActiveRun() {
      if (this.domainApi) {
        return clone(await this.storageArea.loadActiveRun(this.ownerId));
      }
      const stored = await this.storageArea.get(this.storageKey);
      return clone(stored?.[this.storageKey] ?? null);
    }
    async loadRun(runId) {
      if (this.domainApi) {
        return clone(await this.storageArea.loadRun(runId, this.ownerId));
      }
      const run = await this.loadActiveRun();
      return run && String(run.runId) === String(runId) ? run : null;
    }
    async createRun(run) {
      if (!run?.runId) throw new WorkflowPersistenceError("Run id is required");
      if (this.domainApi) {
        return clone(await this.storageArea.createRun(clone(run), this.ownerId));
      }
      const existing = await this.loadActiveRun();
      if (existing && !["completed", "stopped", "failed"].includes(existing.status)) {
        throw new WorkflowConflictError("A workflow run is already active", {
          runId: existing.runId
        });
      }
      await this.storageArea.set({ [this.storageKey]: clone(run) });
      return clone(run);
    }
    async saveRun(run, { expectedRevision = null } = {}) {
      if (this.domainApi) {
        return clone(
          await this.storageArea.saveRun(
            clone(run),
            expectedRevision,
            this.ownerId
          )
        );
      }
      const current = await this.loadActiveRun();
      if (!current || String(current.runId) !== String(run?.runId)) {
        throw new WorkflowPersistenceError("Workflow run was not found", {
          runId: run?.runId ?? null
        });
      }
      if (expectedRevision != null && Number(current.revision) !== Number(expectedRevision)) {
        throw new WorkflowConflictError("Workflow run revision changed", {
          runId: run.runId,
          expectedRevision,
          actualRevision: current.revision
        });
      }
      await this.storageArea.set({ [this.storageKey]: clone(run) });
      return clone(run);
    }
    async clearActiveRun(runId = null) {
      if (this.domainApi) {
        await this.storageArea.clearActiveRun(runId, this.ownerId);
        return;
      }
      const current = await this.loadActiveRun();
      if (runId == null || String(current?.runId ?? "") === String(runId)) {
        await this.storageArea.remove(this.storageKey);
      }
    }
    async assertOwnership(runId) {
      if (!this.domainApi) return true;
      await this.storageArea.assertRunOwnership(runId, this.ownerId);
      return true;
    }
  };

  // src/inventory/snapshot-store.js
  var InventoryGenerationConflictError = class extends Error {
    constructor(expected, actual) {
      super(`Inventory generation conflict: expected ${expected}, current ${actual}`);
      this.name = "InventoryGenerationConflictError";
      this.expectedGeneration = expected;
      this.actualGeneration = actual;
    }
  };
  var InventoryIdentityConflictError = class extends Error {
    constructor(itemId) {
      super(`Owned item ${itemId} appears more than once in the same snapshot`);
      this.name = "InventoryIdentityConflictError";
      this.itemId = itemId;
    }
  };
  var freezeSource = (location2, generation, items) => Object.freeze({ location: location2, generation, items: Object.freeze(items) });
  var normalizeCapacity = (value) => {
    if (value === null || value === void 0) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new TypeError("storageCapacity must be a non-negative integer or null");
    }
    return parsed;
  };
  var createEmptyState = () => {
    const generation = 0;
    const club = freezeSource(INVENTORY_LOCATIONS.CLUB, generation, []);
    const storage = freezeSource(INVENTORY_LOCATIONS.SBC_STORAGE, generation, []);
    const unassigned = freezeSource(INVENTORY_LOCATIONS.UNASSIGNED, generation, []);
    return Object.freeze({
      generation,
      updatedAt: null,
      storageCapacity: null,
      club,
      storage,
      unassigned,
      items: Object.freeze([])
    });
  };
  var InventorySnapshotStore = class {
    #state = createEmptyState();
    #clock;
    constructor({ clock = () => (/* @__PURE__ */ new Date()).toISOString() } = {}) {
      if (typeof clock !== "function") throw new TypeError("clock must be a function");
      this.#clock = clock;
    }
    getSnapshot() {
      return this.#state;
    }
    /**
     * Build and validate the full next state before publishing it. A malformed
     * source therefore cannot leave club/storage/unassigned on mixed generations.
     */
    replaceSnapshot(input = {}, { expectedGeneration = null } = {}) {
      const current = this.#state;
      if (expectedGeneration !== null && Number(expectedGeneration) !== current.generation) {
        throw new InventoryGenerationConflictError(
          Number(expectedGeneration),
          current.generation
        );
      }
      const nextGeneration = current.generation + 1;
      for (const source of ["club", "storage", "unassigned"]) {
        if (!Array.isArray(input[source])) {
          throw new TypeError(`${source} inventory source must be an explicit array`);
        }
      }
      const normalizeSource = (items, location2) => items.map(
        (item) => normalizeInventoryItem(item, { location: location2 })
      );
      const clubItems = normalizeSource(input.club, INVENTORY_LOCATIONS.CLUB);
      const storageItems = normalizeSource(
        input.storage,
        INVENTORY_LOCATIONS.SBC_STORAGE
      );
      const unassignedItems = normalizeSource(
        input.unassigned,
        INVENTORY_LOCATIONS.UNASSIGNED
      );
      const allItems = [...clubItems, ...storageItems, ...unassignedItems];
      const itemIds = /* @__PURE__ */ new Set();
      for (const item of allItems) {
        if (itemIds.has(item.itemId)) {
          throw new InventoryIdentityConflictError(item.itemId);
        }
        itemIds.add(item.itemId);
      }
      const club = freezeSource(
        INVENTORY_LOCATIONS.CLUB,
        nextGeneration,
        clubItems
      );
      const storage = freezeSource(
        INVENTORY_LOCATIONS.SBC_STORAGE,
        nextGeneration,
        storageItems
      );
      const unassigned = freezeSource(
        INVENTORY_LOCATIONS.UNASSIGNED,
        nextGeneration,
        unassignedItems
      );
      const next = Object.freeze({
        generation: nextGeneration,
        updatedAt: String(this.#clock()),
        storageCapacity: normalizeCapacity(input.storageCapacity),
        club,
        storage,
        unassigned,
        items: Object.freeze([...club.items, ...storage.items, ...unassigned.items])
      });
      this.#state = next;
      return next;
    }
  };

  // src/inventory/inventory-service.js
  var InventoryService = class {
    #store;
    #duplicates;
    constructor({ snapshotStore = new InventorySnapshotStore(), duplicateService = new DuplicateService() } = {}) {
      this.#store = snapshotStore;
      this.#duplicates = duplicateService;
    }
    synchronize(input, options) {
      return this.#store.replaceSnapshot(input, options);
    }
    getSnapshot() {
      return this.#store.getSnapshot();
    }
    getItems(location2 = null) {
      const snapshot = this.getSnapshot();
      if (location2 === null) return snapshot.items;
      if (location2 === "club") return snapshot.club.items;
      if (location2 === "storage" || location2 === "sbc_storage") {
        return snapshot.storage.items;
      }
      if (location2 === "unassigned") return snapshot.unassigned.items;
      throw new TypeError(`Unsupported inventory location: ${location2}`);
    }
    findByItemId(itemId) {
      const normalized = normalizeIdentifier(itemId, {
        required: true,
        name: "itemId"
      });
      return this.getSnapshot().items.find((item) => item.itemId === normalized) ?? null;
    }
    findByResourceId(resourceId) {
      const normalized = normalizeIdentifier(resourceId, {
        required: true,
        name: "resourceId"
      });
      return Object.freeze(
        this.getSnapshot().items.filter((item) => item.resourceId === normalized)
      );
    }
    getDuplicateGroups() {
      return this.#duplicates.group(this.getSnapshot().items);
    }
    getDuplicateRelations() {
      return buildDuplicateRelations(this.getSnapshot());
    }
    planUnassignedResolution(policy) {
      return planUnassignedResolution(this.getSnapshot(), policy);
    }
    getStatus() {
      const snapshot = this.getSnapshot();
      const capacity = snapshot.storageCapacity;
      return Object.freeze({
        generation: snapshot.generation,
        clubCount: snapshot.club.items.length,
        storageCount: snapshot.storage.items.length,
        storageCapacity: capacity,
        storageFreeSlots: capacity == null ? null : Math.max(0, capacity - snapshot.storage.items.length),
        unassignedCount: snapshot.unassigned.items.length,
        duplicateGroupCount: this.getDuplicateGroups().length
      });
    }
  };

  // src/packs/pack-policy.js
  var PACK_OPEN_MODES = Object.freeze({
    CURRENT_REWARD: "OPEN_CURRENT_REWARD",
    MATCHING_PACKS: "OPEN_MATCHING_PACKS",
    ALL_ALLOWED_PACKS: "OPEN_ALL_ALLOWED_PACKS"
  });
  var VALID_MODES = new Set(Object.values(PACK_OPEN_MODES));
  var PackPolicyError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "PackPolicyError";
      this.code = code;
      this.details = details;
    }
  };
  function stringSet(values, field) {
    if (values == null) return [];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
      throw new PackPolicyError("INVALID_PACK_POLICY", `${field} must be an array of non-empty strings`);
    }
    return [...new Set(values.map((value) => value.trim()))];
  }
  function normalizePackPolicy(input = {}) {
    if (input == null || typeof input !== "object" || Array.isArray(input)) {
      throw new PackPolicyError("INVALID_PACK_POLICY", "Pack policy must be an object");
    }
    for (const forbidden of ["allowPurchases", "allowStorePacks", "spendCoins", "spendPoints", "useFcPoints"]) {
      if (input[forbidden] === true) {
        throw new PackPolicyError(
          "PURCHASE_FORBIDDEN",
          "GrindPilot never buys packs or spends coins or FC Points",
          { field: forbidden }
        );
      }
    }
    const mode = input.mode ?? PACK_OPEN_MODES.CURRENT_REWARD;
    if (!VALID_MODES.has(mode)) {
      throw new PackPolicyError("INVALID_PACK_MODE", `Unsupported pack mode: ${String(mode)}`);
    }
    const maxPacks = input.maxPacks ?? (mode === PACK_OPEN_MODES.CURRENT_REWARD ? 1 : 25);
    if (!Number.isSafeInteger(maxPacks) || maxPacks < 1 || maxPacks > 100) {
      throw new PackPolicyError("INVALID_PACK_POLICY", "maxPacks must be an integer from 1 to 100");
    }
    return Object.freeze({
      mode,
      maxPacks,
      allowedPackIds: stringSet(input.allowedPackIds, "allowedPackIds"),
      allowedPackTypes: stringSet(input.allowedPackTypes, "allowedPackTypes"),
      excludedPackIds: stringSet(input.excludedPackIds, "excludedPackIds")
    });
  }
  function packId(pack) {
    return String(pack?.packId ?? pack?.id ?? "");
  }
  function packType(pack) {
    return String(pack?.packType ?? pack?.type ?? "");
  }
  function numericCost(pack, keys) {
    for (const key of keys) {
      const value = pack?.[key] ?? pack?.cost?.[key];
      if (value != null && Number(value) > 0) return Number(value);
    }
    return 0;
  }
  function assertOwnedFreePack(pack) {
    const id = packId(pack);
    if (!id) throw new PackPolicyError("INVALID_PACK", "Pack has no stable identifier");
    const coinCost = numericCost(pack, ["coins", "coinCost", "coinsCost"]);
    const pointsCost = numericCost(pack, ["points", "pointCost", "fcPoints", "fcPointsCost"]);
    const requiresPurchase = pack.purchaseRequired === true || pack.owned === false;
    const storeOnly = pack.source === "store" && pack.owned !== true && pack.isReward !== true;
    if (coinCost > 0 || pointsCost > 0 || requiresPurchase || storeOnly) {
      throw new PackPolicyError("PURCHASE_FORBIDDEN", "Pack is not proven to be owned and free to open", {
        packId: id,
        coinCost,
        pointsCost
      });
    }
    if (pack.owned !== true && pack.isReward !== true && pack.source !== "reward") {
      throw new PackPolicyError("OWNERSHIP_UNVERIFIED", "Pack ownership could not be verified", { packId: id });
    }
    return true;
  }
  function getUnassignedCount(inventoryState = {}) {
    let unresolved;
    if (Array.isArray(inventoryState.unassigned)) {
      unresolved = inventoryState.unassigned.length;
    } else if (Object.hasOwn(inventoryState, "unassignedCount")) {
      unresolved = Number(inventoryState.unassignedCount);
    } else if (Object.hasOwn(inventoryState, "unresolvedUnassigned")) {
      unresolved = Number(inventoryState.unresolvedUnassigned);
    } else {
      throw new PackPolicyError("INVENTORY_STATE_UNVERIFIED", "Unassigned state is missing");
    }
    if (!Number.isFinite(unresolved) || unresolved < 0) {
      throw new PackPolicyError("INVALID_INVENTORY_STATE", "Unassigned count is invalid");
    }
    return unresolved;
  }
  function assertNoUnassigned(inventoryState = {}) {
    const unresolved = getUnassignedCount(inventoryState);
    if (unresolved > 0) {
      throw new PackPolicyError("UNASSIGNED_BLOCKING", "Resolve unassigned items before opening another pack", {
        unresolved
      });
    }
    return true;
  }
  function matchesFilters(pack, policy) {
    const id = packId(pack);
    const type = packType(pack);
    if (policy.excludedPackIds.includes(id)) return false;
    if (policy.allowedPackIds.length && !policy.allowedPackIds.includes(id)) return false;
    if (policy.allowedPackTypes.length && !policy.allowedPackTypes.includes(type)) return false;
    return true;
  }
  function selectPacksForPolicy({ packs = [], policy: rawPolicy = {}, currentReward = null } = {}) {
    if (!Array.isArray(packs)) throw new PackPolicyError("INVALID_PACKS", "packs must be an array");
    const policy = normalizePackPolicy(rawPolicy);
    const safe = packs.filter((pack) => {
      try {
        assertOwnedFreePack(pack);
        return matchesFilters(pack, policy);
      } catch {
        return false;
      }
    });
    let selected3;
    if (policy.mode === PACK_OPEN_MODES.CURRENT_REWARD) {
      const expectedId = String(currentReward?.packId ?? currentReward?.identifiedPackId ?? "");
      if (!expectedId) {
        throw new PackPolicyError("REWARD_PACK_UNIDENTIFIED", "The current reward has no verified pack identifier");
      }
      selected3 = safe.filter((pack) => packId(pack) === expectedId);
      if (selected3.length !== 1) {
        throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "The current reward pack was not uniquely identified", {
          expectedId,
          matches: selected3.length
        });
      }
    } else if (policy.mode === PACK_OPEN_MODES.MATCHING_PACKS) {
      const rewardType = String(currentReward?.packType ?? currentReward?.type ?? "");
      if (!rewardType) {
        throw new PackPolicyError("REWARD_PACK_UNIDENTIFIED", "A pack type is required for matching-pack mode");
      }
      selected3 = safe.filter((pack) => packType(pack) === rewardType);
    } else {
      selected3 = safe;
    }
    return selected3.slice(0, policy.maxPacks);
  }

  // src/packs/earned-pack-tracker.js
  var packIdOf = (pack) => String(pack?.packId ?? pack?.id ?? "");
  var packTypeOf = (pack) => String(pack?.packType ?? pack?.type ?? "");
  var stable2 = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable2).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable2(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  var fingerprint2 = (value) => {
    const input = stable2(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };
  var normalizePackRows = (packs) => {
    if (!Array.isArray(packs)) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshot must be an array");
    }
    const rows = packs.map((pack) => {
      const packId2 = packIdOf(pack);
      const count = Number(pack?.count ?? 1);
      if (!packId2 || !Number.isSafeInteger(count) || count < 0) {
        throw new PackPolicyError("INVALID_PACKS", "Pack snapshot contains an invalid ID or count");
      }
      assertOwnedFreePack(pack);
      return Object.freeze({
        packId: packId2,
        packType: packTypeOf(pack),
        count,
        pack: Object.freeze({ ...pack })
      });
    });
    rows.sort((left, right) => left.packId.localeCompare(right.packId) || left.packType.localeCompare(right.packType));
    return rows;
  };
  var countsOf = (rows) => {
    const counts = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const next = (counts.get(row.packId) ?? 0) + row.count;
      if (!Number.isSafeInteger(next)) {
        throw new PackPolicyError("INVALID_PACKS", "Pack count exceeds the safe range");
      }
      counts.set(row.packId, next);
    }
    return counts;
  };
  var asSnapshot = (value, options = {}) => value?.schemaVersion === 1 && Array.isArray(value.rows) ? value : EarnedPackTracker.capture(value, options);
  var EarnedPackTracker = class {
    static capture(packs, { observedAt = 0, sourceGeneration = null } = {}) {
      const rows = normalizePackRows(packs);
      const timestamp = Number(observedAt);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new PackPolicyError("INVALID_PACKS", "Pack snapshot time is invalid");
      }
      if (sourceGeneration != null && (!Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0)) {
        throw new PackPolicyError("INVALID_PACKS", "Pack source generation is invalid");
      }
      const canonical = rows.map(({ packId: packId2, packType: packType2, count }) => ({ packId: packId2, packType: packType2, count }));
      return Object.freeze({
        schemaVersion: 1,
        observedAt: timestamp,
        sourceGeneration,
        rows: Object.freeze(rows),
        fingerprint: fingerprint2(canonical)
      });
    }
    static correlate({
      before,
      after,
      claimEvidence = {},
      operationId,
      sourceChallenge = null,
      inventoryGeneration = null,
      correlatedAt = 0
    } = {}) {
      if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 160) {
        throw new PackPolicyError("INVALID_REWARD_OPERATION", "Reward operation ID is required");
      }
      const beforeSnapshot = asSnapshot(before);
      const afterSnapshot = asSnapshot(after);
      const beforeCounts = countsOf(beforeSnapshot.rows);
      const afterCounts = countsOf(afterSnapshot.rows);
      const deltas = [...afterCounts.entries()].map(([packId3, count]) => ({ packId: packId3, delta: count - (beforeCounts.get(packId3) ?? 0) })).filter(({ delta }) => delta > 0);
      const explicitId = String(claimEvidence?.packId ?? claimEvidence?.rewardPackId ?? "");
      if (deltas.length !== 1 || deltas[0].delta !== 1 || explicitId && explicitId !== deltas[0].packId) {
        throw new PackPolicyError(
          "AMBIGUOUS_REWARD_PACK",
          "Exactly one newly earned pack unit could not be correlated",
          { explicitId: explicitId || null, positiveDeltas: deltas }
        );
      }
      const packId2 = deltas[0].packId;
      const afterRows = afterSnapshot.rows.filter((row) => row.packId === packId2);
      const beforeRows = beforeSnapshot.rows.filter((row) => row.packId === packId2);
      if (afterRows.length !== 1) {
        throw new PackPolicyError("AMBIGUOUS_REWARD_PACK", "Correlated pack identity has multiple rows");
      }
      const types = new Set([...beforeRows, ...afterRows].map(({ packType: packType2 }) => packType2));
      if (types.size !== 1) {
        throw new PackPolicyError("AMBIGUOUS_REWARD_PACK", "Correlated pack stack is not homogeneous");
      }
      const identityKind = (beforeCounts.get(packId2) ?? 0) === 0 ? "owned_instance" : "verified_fungible_stack";
      const binding = Object.freeze({
        schemaVersion: 1,
        operationId: operationId.trim(),
        packRef: Object.freeze({ packId: packId2 }),
        identityKind,
        packType: afterRows[0].packType || null,
        quantityDelta: 1,
        sourceChallenge: sourceChallenge == null ? null : String(sourceChallenge),
        inventoryGeneration: inventoryGeneration == null ? null : Number(inventoryGeneration),
        beforeFingerprint: beforeSnapshot.fingerprint,
        afterFingerprint: afterSnapshot.fingerprint,
        correlatedAt: Number(correlatedAt)
      });
      return Object.freeze({ binding, pack: afterRows[0].pack });
    }
    static resolve(binding, packs) {
      if (!binding || binding.schemaVersion !== 1 || binding.quantityDelta !== 1 || typeof binding.operationId !== "string" || typeof binding.packRef?.packId !== "string") {
        throw new PackPolicyError("INVALID_REWARD_BINDING", "Earned pack binding is invalid");
      }
      const rows = normalizePackRows(packs).filter(({ packId: packId2 }) => packId2 === binding.packRef.packId);
      if (rows.length !== 1 || binding.packType != null && rows[0].packType !== binding.packType) {
        throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "The bound earned pack is no longer uniquely present");
      }
      return rows[0].pack;
    }
  };

  // src/packs/pack-service.js
  var idOf = (pack) => String(pack?.packId ?? pack?.id ?? "");
  var PackService = class {
    constructor({ adapter, inventoryService, logger = null } = {}) {
      if (!adapter?.listOwnedPacks || !adapter?.openOwnedPack) {
        throw new TypeError("PackService requires listOwnedPacks and openOwnedPack adapter methods");
      }
      if (!inventoryService?.getState || !inventoryService?.refresh) {
        throw new TypeError("PackService requires getState and refresh inventory methods");
      }
      this.adapter = adapter;
      this.inventoryService = inventoryService;
      this.logger = logger;
    }
    async plan({ policy, currentReward } = {}) {
      assertNoUnassigned(await this.inventoryService.getState());
      const packs = await this.adapter.listOwnedPacks();
      const ownedSnapshot = EarnedPackTracker.capture(packs);
      const normalizedPolicy = normalizePackPolicy(policy);
      const selected3 = currentReward?.packBinding && normalizedPolicy.mode === "OPEN_CURRENT_REWARD" ? [EarnedPackTracker.resolve(currentReward.packBinding, packs)] : selectPacksForPolicy({ packs, policy: normalizedPolicy, currentReward });
      return {
        policy: normalizedPolicy,
        packs: selected3.map((pack) => ({ ...pack })),
        packSnapshotFingerprint: ownedSnapshot.fingerprint,
        packExpectations: selected3.map((pack) => ({
          packId: idOf(pack),
          packType: String(pack?.packType ?? pack?.type ?? ""),
          count: Number(pack?.count ?? 1)
        })),
        currentRewardBinding: normalizedPolicy.mode === "OPEN_CURRENT_REWARD" ? currentReward?.packBinding ?? null : null
      };
    }
    async open({ policy, currentReward } = {}) {
      const plan = await this.plan({ policy, currentReward });
      return this.openPlan(plan);
    }
    async openPlan(plan = {}) {
      if (!Array.isArray(plan?.packs) || !Array.isArray(plan?.packExpectations) || typeof plan?.packSnapshotFingerprint !== "string") {
        throw new PackPolicyError("INVALID_PACK_PLAN", "A verified owned-pack plan is required");
      }
      const ownedAtStart = await this.adapter.listOwnedPacks();
      const startSnapshot = EarnedPackTracker.capture(ownedAtStart);
      if (startSnapshot.fingerprint !== plan.packSnapshotFingerprint) {
        throw new PackPolicyError("PACK_PLAN_STALE", "Owned packs changed after this plan was prepared");
      }
      const opened = [];
      for (let index = 0; index < plan.packs.length; index += 1) {
        const pack = plan.packs[index];
        assertNoUnassigned(await this.inventoryService.getState());
        assertOwnedFreePack(pack);
        const packId2 = idOf(pack);
        const expectation = plan.packExpectations[index];
        if (!expectation || expectation.packId !== packId2) {
          throw new PackPolicyError("INVALID_PACK_PLAN", "Pack plan evidence does not match its selected pack");
        }
        const currentPacks = await this.adapter.listOwnedPacks();
        const matching = currentPacks.filter((entry) => idOf(entry) === packId2);
        const expectedCount = expectation.count - opened.filter((entry) => entry.packId === packId2).length;
        if (matching.length !== 1 || Number(matching[0]?.count ?? 1) !== expectedCount || String(matching[0]?.packType ?? matching[0]?.type ?? "") !== expectation.packType) {
          throw new PackPolicyError("PACK_PLAN_STALE", "The selected owned pack is no longer in its reviewed state", {
            packId: packId2
          });
        }
        if (plan.currentRewardBinding) {
          const resolved = EarnedPackTracker.resolve(plan.currentRewardBinding, currentPacks);
          if (idOf(resolved) !== packId2) {
            throw new PackPolicyError("PACK_PLAN_STALE", "The earned-pack binding no longer matches the reviewed pack", {
              packId: packId2
            });
          }
        }
        this.logger?.info?.("pack.open.intent", { packId: packId2 });
        const response = await this.adapter.openOwnedPack({ packId: packId2 });
        if (response?.opened !== true || !Array.isArray(response.items)) {
          throw new PackPolicyError("PACK_OPEN_UNVERIFIED", "Pack opening response was not verifiable", { packId: packId2 });
        }
        const inventory = await this.inventoryService.refresh();
        opened.push({ packId: packId2, itemCount: response.items.length, response });
        this.logger?.info?.("pack.opened", { packId: packId2, itemCount: response.items.length });
        let unresolved;
        try {
          unresolved = getUnassignedCount(
            Array.isArray(inventory?.unassigned?.items) ? { ...inventory, unassigned: inventory.unassigned.items } : inventory
          );
        } catch (error) {
          return { status: "blocked", reason: error.code ?? "INVENTORY_STATE_UNVERIFIED", opened, inventory };
        }
        if (unresolved > 0) {
          return { status: "blocked", reason: "UNASSIGNED_BLOCKING", opened, inventory };
        }
      }
      return { status: "completed", opened };
    }
  };

  // src/packs/reward-service.js
  var idOf2 = (pack) => String(pack?.packId ?? pack?.id ?? "");
  function identifyClaimedRewardPack({ claim, packsBefore = [], packsAfter = [] } = {}) {
    try {
      return EarnedPackTracker.correlate({
        before: packsBefore,
        after: packsAfter,
        claimEvidence: claim,
        operationId: "legacy-reward-correlation"
      }).pack;
    } catch (error) {
      if (error?.code === "AMBIGUOUS_REWARD_PACK") {
        throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", error.message, error.details);
      }
      throw error;
    }
  }
  var RewardService = class {
    constructor({ adapter, logger = null } = {}) {
      if (!adapter?.listOwnedPacks || !adapter?.claimReward) {
        throw new TypeError("RewardService requires listOwnedPacks and claimReward adapter methods");
      }
      this.adapter = adapter;
      this.logger = logger;
    }
    async claimAndIdentify(rewardRef, packsBefore = null, { operationId = "reward-claim", inventoryGeneration = null } = {}) {
      const before = Array.isArray(packsBefore) ? packsBefore.map((pack2) => ({ ...pack2 })) : await this.adapter.listOwnedPacks();
      const claim = await this.adapter.claimReward(rewardRef, before);
      if (claim?.claimed !== true && claim?.success !== true) {
        throw new PackPolicyError("REWARD_CLAIM_UNVERIFIED", "Reward claim was not verified", { rewardRef });
      }
      const after = await this.adapter.listOwnedPacks();
      const { binding, pack } = EarnedPackTracker.correlate({
        before,
        after,
        claimEvidence: claim,
        operationId,
        sourceChallenge: rewardRef?.challengeId ?? rewardRef?.source ?? null,
        inventoryGeneration,
        correlatedAt: Date.now()
      });
      this.logger?.info?.("reward.claimed", { rewardRef, packId: idOf2(pack) });
      return {
        claim,
        pack,
        packBinding: binding,
        identifiedPackId: idOf2(pack),
        packType: pack.packType ?? pack.type ?? null
      };
    }
  };

  // src/picks/pick-policy.js
  var PLAYER_PICK_POLICIES = Object.freeze({
    PAUSE_FOR_USER: "PAUSE_FOR_USER",
    HIGHEST_RATING: "HIGHEST_RATING",
    HIGHEST_VALUE: "HIGHEST_VALUE",
    PREFER_NON_DUPLICATE: "PREFER_NON_DUPLICATE",
    PREFER_REQUIRED_SPECIAL: "PREFER_REQUIRED_SPECIAL",
    CUSTOM_PRIORITY: "CUSTOM_PRIORITY"
  });
  var VALID_POLICIES = new Set(Object.values(PLAYER_PICK_POLICIES));
  var VALID_CRITERIA = /* @__PURE__ */ new Set([
    "REQUIRED_SPECIAL",
    "NON_DUPLICATE",
    "PREFERRED_PLAYER",
    "PREFERRED_RESOURCE",
    "PREFERRED_CARD_TYPE",
    "RATING",
    "VALUE"
  ]);
  var PlayerPickPolicyError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "PlayerPickPolicyError";
      this.code = code;
      this.details = details;
    }
  };
  function strings(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
      throw new PlayerPickPolicyError("INVALID_PICK_POLICY", `${field} must be an array of non-empty strings`);
    }
    return [...new Set(value.map((entry) => entry.trim()))];
  }
  function normalizePlayerPickPolicy(input = {}) {
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
      requiredSpecialTypes: strings(input.requiredSpecialTypes, "requiredSpecialTypes")
    });
  }
  function normalizeOffer(offer, index) {
    if (offer == null || typeof offer !== "object" || Array.isArray(offer)) {
      throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", `Offer ${index} is invalid`);
    }
    const itemId = String(offer.itemId ?? offer.id ?? "");
    if (!itemId) throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", `Offer ${index} has no item ID`);
    const rating = Number(offer.rating);
    const value = offer.estimatedValue == null && offer.value == null ? null : Number(offer.estimatedValue ?? offer.value);
    return {
      ...offer,
      itemId,
      resourceId: String(offer.resourceId ?? ""),
      basePlayerId: String(offer.basePlayerId ?? offer.assetId ?? ""),
      name: offer.name == null ? null : String(offer.name),
      cardType: String(offer.cardType ?? ""),
      rarityName: String(offer.rarityName ?? offer.rarity ?? ""),
      specialGroups: Array.isArray(offer.specialGroups) ? offer.specialGroups.map(String) : [],
      isSpecial: offer.isSpecial === true,
      rating: Number.isFinite(rating) ? rating : null,
      estimatedValue: Number.isFinite(value) && value >= 0 ? value : null,
      isDuplicate: offer.isDuplicate === true
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
      offers
    };
  }
  function isRequiredSpecial(offer, policy, context) {
    const required = new Set([
      ...policy.requiredSpecialTypes,
      ...Array.isArray(context?.requiredSpecialTypes) ? context.requiredSpecialTypes.map(String) : []
    ].map((value) => String(value).trim().toLowerCase()).filter(Boolean));
    return [offer.cardType, offer.rarityName, ...offer.specialGroups || []].map((value) => String(value).trim().toLowerCase()).some((value) => required.has(value));
  }
  function criterionScore(criterion, offer, policy, context) {
    switch (criterion) {
      case "REQUIRED_SPECIAL":
        return isRequiredSpecial(offer, policy, context) ? 1 : 0;
      case "NON_DUPLICATE":
        return offer.isDuplicate ? 0 : 1;
      case "PREFERRED_PLAYER":
        return policy.preferredPlayerIds.includes(offer.basePlayerId) ? 1 : 0;
      case "PREFERRED_RESOURCE":
        return policy.preferredResourceIds.includes(offer.resourceId) ? 1 : 0;
      case "PREFERRED_CARD_TYPE":
        return policy.preferredCardTypes.includes(offer.cardType) ? 1 : 0;
      case "RATING":
        return offer.rating;
      case "VALUE":
        return offer.estimatedValue;
      default:
        return null;
    }
  }
  function compareTuples2(left, right) {
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
  }
  function decidePlayerPick(rawOffers, rawPolicy = {}, context = {}) {
    if (!Array.isArray(rawOffers) || rawOffers.length === 0) {
      throw new PlayerPickPolicyError("INVALID_PICK_OFFERS", "At least one player-pick offer is required");
    }
    const existingResourceIds = new Set(
      (context?.existingResourceIds || []).map(String)
    );
    const duplicateResourceIds = new Set(
      (context?.duplicateResourceIds || []).map(String)
    );
    const duplicateItemIds = new Set((context?.duplicateItemIds || []).map(String));
    const offers = rawOffers.map(normalizeOffer).map((offer) => ({
      ...offer,
      isDuplicate: offer.isDuplicate || duplicateItemIds.has(offer.itemId) || offer.resourceId && (existingResourceIds.has(offer.resourceId) || duplicateResourceIds.has(offer.resourceId))
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
          candidates: candidates.map((offer) => offer.itemId)
        });
      }
      case PLAYER_PICK_POLICIES.PREFER_REQUIRED_SPECIAL: {
        const candidates = offers.filter((offer) => isRequiredSpecial(offer, policy, context));
        if (candidates.length === 1) return selected(candidates[0], offers, "PREFER_REQUIRED_SPECIAL");
        return paused(candidates.length ? "AMBIGUOUS_PICK" : "NO_REQUIRED_SPECIAL_OPTION", offers, {
          candidates: candidates.map((offer) => offer.itemId)
        });
      }
      case PLAYER_PICK_POLICIES.CUSTOM_PRIORITY: {
        const ranked = offers.map((offer) => ({
          offer,
          tuple: policy.criteria.map((criterion) => criterionScore(criterion, offer, policy, context))
        }));
        if (ranked.some((entry) => entry.tuple.some((value) => value == null || Number.isNaN(value)))) {
          return paused("INSUFFICIENT_PICK_DATA", offers);
        }
        ranked.sort((a, b) => compareTuples2(b.tuple, a.tuple));
        if (ranked.length > 1 && compareTuples2(ranked[0].tuple, ranked[1].tuple) === 0) {
          return paused("AMBIGUOUS_PICK", offers, { candidates: ranked.filter((entry) => compareTuples2(entry.tuple, ranked[0].tuple) === 0).map((entry) => entry.offer.itemId) });
        }
        return selected(ranked[0].offer, offers, "CUSTOM_PRIORITY");
      }
      default:
        return paused("USER_SELECTION_REQUIRED", offers);
    }
  }

  // src/picks/player-pick-service.js
  var pickIdentity = (pick) => String(pick?.pickIdentity ?? pick?.pickId ?? pick?.id ?? "");
  var offerIdentity = (pick) => {
    if (pick?.offerIdentity) return String(pick.offerIdentity);
    if (!Array.isArray(pick?.offers)) return "";
    return pick.offers.map((offer) => `${String(offer?.itemId ?? offer?.id ?? "")}:${String(offer?.resourceId ?? "")}`).sort().join("|");
  };
  var PlayerPickService = class {
    constructor({ adapter, logger = null } = {}) {
      if (!adapter?.getPlayerPick || !adapter?.selectPlayerPick) {
        throw new TypeError("PlayerPickService requires getPlayerPick and selectPlayerPick adapter methods");
      }
      this.adapter = adapter;
      this.logger = logger;
    }
    async handle({ pickId, policy, context = {}, execute = false, approved = false, expectedIntent = null } = {}) {
      const pick = await this.adapter.getPlayerPick(pickId);
      if (pick?.resolved === true && pick?.pending !== true) {
        return { status: "completed", reason: "PICK_ALREADY_RESOLVED", selectedItemId: null };
      }
      if (!pick || pick?.availability === "unavailable" || !Array.isArray(pick.offers) || !pick.offers.length) {
        return { status: "paused", reason: "PICK_STATE_UNVERIFIED", selectedItemId: null };
      }
      const observedPickIdentity = pickIdentity(pick);
      const observedOfferIdentity = offerIdentity(pick);
      if (!observedPickIdentity || !observedOfferIdentity) {
        return { status: "paused", reason: "PICK_IDENTITY_UNVERIFIED", selectedItemId: null };
      }
      if (pickId != null && String(pickId) !== observedPickIdentity) {
        return { status: "paused", reason: "PICK_IDENTITY_CHANGED", selectedItemId: null };
      }
      const decision = decidePlayerPick(pick.offers, policy, context);
      const intent = decision.selectedItemId ? {
        pickIdentity: observedPickIdentity,
        offerIdentity: observedOfferIdentity,
        selectedItemId: decision.selectedItemId,
        selectedResourceId: decision.selected?.resourceId || null
      } : null;
      if (expectedIntent && (String(expectedIntent.pickIdentity ?? "") !== String(intent?.pickIdentity ?? "") || String(expectedIntent.offerIdentity ?? "") !== String(intent?.offerIdentity ?? "") || String(expectedIntent.selectedItemId ?? "") !== String(intent?.selectedItemId ?? ""))) {
        return { ...decision, intent, status: "paused", reason: "PICK_INTENT_STALE" };
      }
      this.logger?.info?.("player-pick.decision", {
        pickId,
        status: decision.status,
        reason: decision.reason,
        intendedItemId: decision.selectedItemId
      });
      if (decision.status !== "selected" || !execute) return { ...decision, intent };
      if (!approved) return { ...decision, intent, status: "paused", reason: "DESTRUCTIVE_APPROVAL_REQUIRED" };
      const current = await this.adapter.getPlayerPick(observedPickIdentity);
      if (pickIdentity(current) !== observedPickIdentity || offerIdentity(current) !== observedOfferIdentity || !current?.offers?.some((offer) => String(offer?.itemId ?? offer?.id ?? "") === decision.selectedItemId)) {
        return { ...decision, intent, status: "paused", reason: "PICK_INTENT_STALE" };
      }
      const response = await this.adapter.selectPlayerPick({
        pickId: observedPickIdentity,
        pickIdentity: observedPickIdentity,
        offerIdentity: observedOfferIdentity,
        itemId: decision.selectedItemId,
        resourceId: decision.selected?.resourceId || null
      });
      const responseItemId = String(response?.selectedItemId ?? response?.itemId ?? "");
      if (response?.success !== true || responseItemId !== decision.selectedItemId) {
        return { ...decision, intent, status: "paused", reason: "PICK_SELECTION_UNVERIFIED", response };
      }
      this.logger?.info?.("player-pick.selected", { pickId, itemId: decision.selectedItemId });
      return { ...decision, intent, status: "completed", response };
    }
    async recover(intent, context = {}) {
      if (!intent?.pickIdentity || !intent?.selectedItemId) {
        return { status: "ambiguous", reason: "PICK_INTENT_MISSING" };
      }
      if (typeof this.adapter.reconcilePlayerPick === "function") {
        return this.adapter.reconcilePlayerPick(intent, context);
      }
      const current = await this.adapter.getPlayerPick(intent.pickIdentity);
      if (current?.pending === true && pickIdentity(current) === String(intent.pickIdentity)) {
        if (offerIdentity(current) === String(intent.offerIdentity)) {
          return { status: "not_applied", reason: "PICK_STILL_PENDING" };
        }
        return { status: "ambiguous", reason: "PICK_OFFERS_CHANGED" };
      }
      const items = Array.isArray(context?.inventoryItems) ? context.inventoryItems : [];
      const beforeItemIds = new Set(
        (intent.inventoryItemIdsBefore ?? []).map(String)
      );
      const selectedObserved = items.some((item) => {
        const id = String(item?.itemId ?? item?.id ?? "");
        return id === String(intent.selectedItemId) && !beforeItemIds.has(id);
      });
      const resourceCountAfter = intent.selectedResourceId ? items.filter(
        (item) => String(item?.resourceId ?? "") === String(intent.selectedResourceId)
      ).length : 0;
      const resourceDeltaObserved = intent.selectedResourceId && Number.isSafeInteger(intent.selectedResourceCountBefore) && resourceCountAfter > intent.selectedResourceCountBefore;
      if (selectedObserved || resourceDeltaObserved) {
        return { status: "completed", result: { selectedItemId: intent.selectedItemId } };
      }
      return { status: "ambiguous", reason: "PICK_CONSUMPTION_UNVERIFIED" };
    }
  };

  // src/profiles/profile-repository.js
  var DEFAULT_STORAGE_KEY = "grindpilot.profiles.v1";
  function clone2(value) {
    return value == null ? value : structuredClone(value);
  }
  var ChromeStorageProfileRepository = class {
    constructor(storageArea = globalThis.chrome?.storage?.local, storageKey = DEFAULT_STORAGE_KEY) {
      const domainApi = storageArea?.listProfiles && storageArea?.putProfile;
      const legacyApi = storageArea?.get && storageArea?.set && storageArea?.remove;
      if (!domainApi && !legacyApi) {
        throw new TypeError("ChromeStorageProfileRepository requires a storage.local-compatible area");
      }
      this.storageArea = storageArea;
      this.storageKey = storageKey;
      this.domainApi = Boolean(domainApi);
      this.mutationQueue = Promise.resolve();
    }
    async #readRecords() {
      const stored = await this.storageArea.get(this.storageKey);
      const value = stored?.[this.storageKey];
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    #enqueueMutation(operation) {
      const pending = this.mutationQueue.then(operation);
      this.mutationQueue = pending.catch(() => {
      });
      return pending;
    }
    async list() {
      if (this.domainApi) return (await this.storageArea.listProfiles()).map(clone2);
      return Object.values(await this.#readRecords()).map(clone2);
    }
    async get(id) {
      if (this.domainApi) return clone2(await this.storageArea.getProfile(id));
      const records = await this.#readRecords();
      return clone2(records[id] ?? null);
    }
    async put(profile) {
      const storedProfile = clone2(profile);
      return this.#enqueueMutation(async () => {
        if (this.domainApi) return clone2(await this.storageArea.putProfile(storedProfile));
        const records = await this.#readRecords();
        records[storedProfile.id] = storedProfile;
        await this.storageArea.set({ [this.storageKey]: records });
        return clone2(storedProfile);
      });
    }
    async delete(id) {
      return this.#enqueueMutation(async () => {
        if (this.domainApi) return Boolean(await this.storageArea.deleteProfile(id));
        const records = await this.#readRecords();
        if (!Object.hasOwn(records, id)) return false;
        delete records[id];
        if (Object.keys(records).length === 0) await this.storageArea.remove(this.storageKey);
        else await this.storageArea.set({ [this.storageKey]: records });
        return true;
      });
    }
  };

  // src/workflow/serialization.js
  var isPlainObject2 = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  var cloneSerializable = (value) => {
    if (value === void 0) return void 0;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      throw new WorkflowError("Workflow data must be JSON serializable", {
        code: "WORKFLOW_NOT_SERIALIZABLE",
        details: { message: error?.message ?? String(error) }
      });
    }
  };
  var assertSerializable = (value, label = "Workflow data") => {
    const seen = /* @__PURE__ */ new WeakSet();
    const visit = (entry, path) => {
      if (entry == null) return;
      const kind = typeof entry;
      if (kind === "string" || kind === "boolean") return;
      if (kind === "number") {
        if (!Number.isFinite(entry)) {
          throw new WorkflowError(`${label} contains a non-finite number`, {
            code: "WORKFLOW_NOT_SERIALIZABLE",
            details: { path }
          });
        }
        return;
      }
      if (kind !== "object") {
        throw new WorkflowError(`${label} contains an unsupported value`, {
          code: "WORKFLOW_NOT_SERIALIZABLE",
          details: { path, type: kind }
        });
      }
      if (seen.has(entry)) {
        throw new WorkflowError(`${label} contains a circular reference`, {
          code: "WORKFLOW_NOT_SERIALIZABLE",
          details: { path }
        });
      }
      seen.add(entry);
      if (Array.isArray(entry)) {
        entry.forEach((child, index) => visit(child, `${path}[${index}]`));
      } else {
        if (!isPlainObject2(entry)) {
          throw new WorkflowError(`${label} contains a non-plain object`, {
            code: "WORKFLOW_NOT_SERIALIZABLE",
            details: { path }
          });
        }
        for (const [key, child] of Object.entries(entry)) {
          visit(child, `${path}.${key}`);
        }
      }
      seen.delete(entry);
    };
    visit(value, "$");
    return value;
  };
  var stableValue = (value) => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (isPlainObject2(value)) {
      const next = {};
      for (const key of Object.keys(value).sort()) next[key] = stableValue(value[key]);
      return next;
    }
    return value;
  };
  var stableStringify2 = (value) => JSON.stringify(stableValue(value));
  var fnv1aHash = (text) => {
    let hash = 2166136261;
    const source = String(text ?? "");
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  // src/workflow/conditions.js
  var ConditionType = Object.freeze({
    COMPARE: "COMPARE",
    ALL: "ALL",
    ANY: "ANY",
    NOT: "NOT",
    TRUTHY: "TRUTHY",
    EXISTS: "EXISTS"
  });
  var ConditionOperator = Object.freeze({
    EQ: "EQ",
    NEQ: "NEQ",
    GT: "GT",
    GTE: "GTE",
    LT: "LT",
    LTE: "LTE",
    IN: "IN",
    NOT_IN: "NOT_IN",
    CONTAINS: "CONTAINS"
  });
  var OperandType = Object.freeze({
    LITERAL: "LITERAL",
    PATH: "PATH",
    COUNT: "COUNT",
    COUNT_IN_RANGE: "COUNT_IN_RANGE"
  });
  var BLOCKED_PATH_SEGMENTS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var MAX_CONDITION_DEPTH = 20;
  var MAX_CONDITION_CHILDREN = 100;
  var normalizeType = (value) => String(value ?? "").trim().toUpperCase();
  var toPathSegments = (path) => {
    const raw = Array.isArray(path) ? path : typeof path === "string" ? path.split(".") : [];
    const segments = raw.map((part) => String(part).trim()).filter(Boolean);
    if (!segments.length || segments.some((part) => BLOCKED_PATH_SEGMENTS.has(part))) {
      return null;
    }
    return segments;
  };
  var readConditionPath = (root, path) => {
    const segments = toPathSegments(path);
    if (!segments) return void 0;
    let cursor = root;
    for (const segment of segments) {
      if (cursor == null || typeof cursor !== "object" && typeof cursor !== "function") {
        return void 0;
      }
      if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return void 0;
      cursor = cursor[segment];
    }
    return cursor;
  };
  var validateOperandInto = (operand, path, issues, depth) => {
    if (depth > MAX_CONDITION_DEPTH) {
      issues.push({ path, code: "CONDITION_TOO_DEEP", message: "Condition is too deeply nested." });
      return;
    }
    if (!isPlainObject2(operand)) {
      issues.push({ path, code: "OPERAND_INVALID", message: "Operand must be a typed object." });
      return;
    }
    const type = normalizeType(operand.type);
    if (!Object.values(OperandType).includes(type)) {
      issues.push({ path: `${path}.type`, code: "OPERAND_TYPE_INVALID", message: `Unsupported operand type: ${type || "<empty>"}.` });
      return;
    }
    if (type === OperandType.PATH && !toPathSegments(operand.path)) {
      issues.push({ path: `${path}.path`, code: "OPERAND_PATH_INVALID", message: "PATH requires a safe non-empty path." });
    }
    if (type === OperandType.COUNT) {
      validateOperandInto(operand.value, `${path}.value`, issues, depth + 1);
    }
    if (type === OperandType.COUNT_IN_RANGE) {
      validateOperandInto(operand.collection, `${path}.collection`, issues, depth + 1);
      if (operand.field != null && !toPathSegments(operand.field)) {
        issues.push({ path: `${path}.field`, code: "OPERAND_PATH_INVALID", message: "COUNT_IN_RANGE field must be a safe path." });
      }
      if (operand.min != null && !Number.isFinite(Number(operand.min))) {
        issues.push({ path: `${path}.min`, code: "OPERAND_RANGE_INVALID", message: "Range minimum must be numeric." });
      }
      if (operand.max != null && !Number.isFinite(Number(operand.max))) {
        issues.push({ path: `${path}.max`, code: "OPERAND_RANGE_INVALID", message: "Range maximum must be numeric." });
      }
    }
  };
  var validateConditionInto = (condition, path, issues, depth) => {
    if (depth > MAX_CONDITION_DEPTH) {
      issues.push({ path, code: "CONDITION_TOO_DEEP", message: "Condition is too deeply nested." });
      return;
    }
    if (!isPlainObject2(condition)) {
      issues.push({ path, code: "CONDITION_INVALID", message: "Condition must be a typed object." });
      return;
    }
    const type = normalizeType(condition.type);
    if (!Object.values(ConditionType).includes(type)) {
      issues.push({ path: `${path}.type`, code: "CONDITION_TYPE_INVALID", message: `Unsupported condition type: ${type || "<empty>"}.` });
      return;
    }
    if (type === ConditionType.ALL || type === ConditionType.ANY) {
      if (!Array.isArray(condition.conditions) || !condition.conditions.length) {
        issues.push({ path: `${path}.conditions`, code: "CONDITION_CHILDREN_REQUIRED", message: `${type} requires at least one child condition.` });
        return;
      }
      if (condition.conditions.length > MAX_CONDITION_CHILDREN) {
        issues.push({ path: `${path}.conditions`, code: "CONDITION_CHILDREN_LIMIT", message: `A condition may contain at most ${MAX_CONDITION_CHILDREN} children.` });
        return;
      }
      condition.conditions.forEach(
        (child, index) => validateConditionInto(child, `${path}.conditions[${index}]`, issues, depth + 1)
      );
      return;
    }
    if (type === ConditionType.NOT) {
      validateConditionInto(condition.condition, `${path}.condition`, issues, depth + 1);
      return;
    }
    if (type === ConditionType.COMPARE) {
      const operator = normalizeType(condition.operator);
      if (!Object.values(ConditionOperator).includes(operator)) {
        issues.push({ path: `${path}.operator`, code: "CONDITION_OPERATOR_INVALID", message: `Unsupported comparison operator: ${operator || "<empty>"}.` });
      }
      validateOperandInto(condition.left, `${path}.left`, issues, depth + 1);
      validateOperandInto(condition.right, `${path}.right`, issues, depth + 1);
      return;
    }
    validateOperandInto(condition.operand, `${path}.operand`, issues, depth + 1);
  };
  var validateCondition = (condition) => {
    const issues = [];
    validateConditionInto(condition, "condition", issues, 0);
    return { ok: issues.length === 0, issues };
  };
  var assertValidCondition = (condition) => {
    const result = validateCondition(condition);
    if (!result.ok) throw new WorkflowValidationError(result.issues);
    return condition;
  };
  var resolveOperand = (operand, context) => {
    const type = normalizeType(operand?.type);
    if (type === OperandType.LITERAL) return operand.value;
    if (type === OperandType.PATH) return readConditionPath(context, operand.path);
    if (type === OperandType.COUNT) {
      const value = resolveOperand(operand.value, context);
      if (Array.isArray(value) || typeof value === "string") return value.length;
      if (isPlainObject2(value)) return Object.keys(value).length;
      return 0;
    }
    if (type === OperandType.COUNT_IN_RANGE) {
      const collection = resolveOperand(operand.collection, context);
      if (!Array.isArray(collection)) return 0;
      const min = operand.min == null ? Number.NEGATIVE_INFINITY : Number(operand.min);
      const max = operand.max == null ? Number.POSITIVE_INFINITY : Number(operand.max);
      return collection.reduce((count, item) => {
        const raw = operand.field == null ? item : readConditionPath(item, operand.field);
        const numeric = Number(raw);
        return Number.isFinite(numeric) && numeric >= min && numeric <= max ? count + 1 : count;
      }, 0);
    }
    return void 0;
  };
  var compare = (left, operator, right) => {
    switch (operator) {
      case ConditionOperator.EQ:
        return Object.is(left, right);
      case ConditionOperator.NEQ:
        return !Object.is(left, right);
      case ConditionOperator.GT:
        return left > right;
      case ConditionOperator.GTE:
        return left >= right;
      case ConditionOperator.LT:
        return left < right;
      case ConditionOperator.LTE:
        return left <= right;
      case ConditionOperator.IN:
        return Array.isArray(right) ? right.includes(left) : false;
      case ConditionOperator.NOT_IN:
        return Array.isArray(right) ? !right.includes(left) : true;
      case ConditionOperator.CONTAINS:
        return Array.isArray(left) ? left.includes(right) : typeof left === "string" ? left.includes(String(right)) : false;
      default:
        return false;
    }
  };
  var evaluateValidCondition = (condition, context) => {
    const type = normalizeType(condition.type);
    if (type === ConditionType.ALL) {
      return condition.conditions.every((child) => evaluateValidCondition(child, context));
    }
    if (type === ConditionType.ANY) {
      return condition.conditions.some((child) => evaluateValidCondition(child, context));
    }
    if (type === ConditionType.NOT) {
      return !evaluateValidCondition(condition.condition, context);
    }
    if (type === ConditionType.COMPARE) {
      return compare(
        resolveOperand(condition.left, context),
        normalizeType(condition.operator),
        resolveOperand(condition.right, context)
      );
    }
    const value = resolveOperand(condition.operand, context);
    if (type === ConditionType.EXISTS) return value !== void 0 && value !== null;
    return Boolean(value);
  };
  var evaluateCondition = (condition, context = {}) => {
    assertValidCondition(condition);
    return evaluateValidCondition(condition, context);
  };

  // src/profiles/profile-service.js
  var PROFILE_SCHEMA_VERSION = 1;
  var REQUIRED_CONFIG_FIELDS = [
    "workflow",
    "solverSettings",
    "fodderPolicy",
    "duplicatePolicy",
    "packPolicy",
    "pickPolicy",
    "runLimits",
    "stopConditions"
  ];
  var BLOCKED_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var ProfileValidationError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "ProfileValidationError";
      this.code = code;
      this.details = details;
    }
  };
  function isPlainObject3(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function cloneData(value, path = "$", seen = /* @__PURE__ */ new Set()) {
    if (value == null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} must be finite`);
      return value;
    }
    if (typeof value !== "object") {
      throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} contains a non-JSON value`);
    }
    if (seen.has(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} is circular`);
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map((entry, index) => cloneData(entry, `${path}[${index}]`, seen));
    } else {
      if (!isPlainObject3(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} must be a plain object`);
      result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (BLOCKED_KEYS.has(key)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} contains a blocked key`);
        result[key] = cloneData(entry, `${path}.${key}`, seen);
      }
    }
    seen.delete(value);
    return result;
  }
  function validIdentifier(value, field) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      throw new ProfileValidationError("INVALID_PROFILE", `${field} must be a safe non-empty identifier`);
    }
    return value;
  }
  function validateWorkflow(workflow) {
    if (!isPlainObject3(workflow) || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new ProfileValidationError("INVALID_PROFILE", "workflow.steps must be a non-empty array");
    }
    const ids = /* @__PURE__ */ new Set();
    for (const [index, step2] of workflow.steps.entries()) {
      if (!isPlainObject3(step2)) throw new ProfileValidationError("INVALID_PROFILE", `workflow step ${index} must be an object`);
      validIdentifier(step2.id, `workflow.steps[${index}].id`);
      if (ids.has(step2.id)) throw new ProfileValidationError("INVALID_PROFILE", `Duplicate workflow step ID: ${step2.id}`);
      ids.add(step2.id);
      if (typeof step2.type !== "string" || !step2.type.trim()) {
        throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].type is required`);
      }
      if (step2.config != null && !isPlainObject3(step2.config)) {
        throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].config must be an object`);
      }
    }
  }
  function validateRunLimits(runLimits) {
    if (!isPlainObject3(runLimits) || !Number.isSafeInteger(runLimits.maxIterations) || runLimits.maxIterations < 1 || runLimits.maxIterations > 1e4) {
      throw new ProfileValidationError("INVALID_PROFILE", "runLimits.maxIterations must be an integer from 1 to 10000");
    }
    for (const field of ["maxSbcSubmissions", "maxPacksOpened", "maxDurationMinutes"]) {
      if (runLimits[field] != null && (!Number.isSafeInteger(runLimits[field]) || runLimits[field] < 1)) {
        throw new ProfileValidationError("INVALID_PROFILE", `runLimits.${field} must be a positive integer`);
      }
    }
  }
  function validateStopConditions(stopConditions) {
    if (!Array.isArray(stopConditions)) {
      throw new ProfileValidationError("INVALID_PROFILE", "stopConditions must be an array");
    }
    for (const [index, condition] of stopConditions.entries()) {
      if (!isPlainObject3(condition) || typeof condition.type !== "string" || !condition.type.trim()) {
        throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] must have a typed condition`);
      }
      if (Object.hasOwn(condition, "expression") || Object.hasOwn(condition, "script")) {
        throw new ProfileValidationError("ARBITRARY_CODE_FORBIDDEN", "Profiles cannot contain executable expressions");
      }
      const type = condition.type.trim().toUpperCase();
      const aliases = /* @__PURE__ */ new Set([
        "UNRESOLVED_UNASSIGNED",
        "STORAGE_FULL",
        "REQUIRED_SPECIAL_MISSING"
      ]);
      const typedConditions = /* @__PURE__ */ new Set(["COMPARE", "ALL", "ANY", "NOT", "TRUTHY", "EXISTS"]);
      if (type === "CONDITION") {
        const result = validateCondition(condition.condition);
        if (!result.ok) throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] contains an invalid condition`);
      } else if (typedConditions.has(type)) {
        const result = validateCondition(condition);
        if (!result.ok) throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] is invalid`);
      } else if (!aliases.has(type)) {
        throw new ProfileValidationError("INVALID_PROFILE", `Unsupported stop condition: ${type}`);
      }
    }
  }
  function normalizeProfile(input) {
    if (!isPlainObject3(input)) throw new ProfileValidationError("INVALID_PROFILE", "Profile must be an object");
    for (const field of REQUIRED_CONFIG_FIELDS) {
      if (!Object.hasOwn(input, field)) throw new ProfileValidationError("INCOMPLETE_PROFILE", `Missing profile field: ${field}`);
    }
    const profile = cloneData(input);
    profile.schemaVersion = input.schemaVersion ?? PROFILE_SCHEMA_VERSION;
    if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new ProfileValidationError("UNSUPPORTED_PROFILE_VERSION", `Unsupported profile schema: ${profile.schemaVersion}`);
    }
    validIdentifier(profile.id, "id");
    if (typeof profile.name !== "string" || !profile.name.trim() || profile.name.trim().length > 120) {
      throw new ProfileValidationError("INVALID_PROFILE", "name must contain 1 to 120 characters");
    }
    profile.name = profile.name.trim();
    validateWorkflow(profile.workflow);
    for (const field of ["solverSettings", "fodderPolicy", "duplicatePolicy"]) {
      if (!isPlainObject3(profile[field])) throw new ProfileValidationError("INVALID_PROFILE", `${field} must be an object`);
    }
    profile.packPolicy = { ...normalizePackPolicy(profile.packPolicy) };
    profile.pickPolicy = { ...normalizePlayerPickPolicy(profile.pickPolicy) };
    validateRunLimits(profile.runLimits);
    validateStopConditions(profile.stopConditions);
    return profile;
  }
  var ProfileService = class {
    constructor({ repository, clock = () => (/* @__PURE__ */ new Date()).toISOString() } = {}) {
      if (!repository?.list || !repository?.get || !repository?.put || !repository?.delete) {
        throw new TypeError("ProfileService requires an injected profile repository");
      }
      this.repository = repository;
      this.clock = clock;
    }
    async list() {
      const profiles = await this.repository.list();
      return profiles.map(normalizeProfile).sort((a, b) => a.name.localeCompare(b.name));
    }
    async get(id) {
      validIdentifier(id, "id");
      const profile = await this.repository.get(id);
      return profile ? normalizeProfile(profile) : null;
    }
    async save(input, { overwrite = true } = {}) {
      const now = this.clock();
      const normalized = normalizeProfile({
        ...input,
        createdAt: input.createdAt ?? now,
        updatedAt: now
      });
      if (!overwrite && await this.repository.get(normalized.id)) {
        throw new ProfileValidationError("PROFILE_EXISTS", `Profile already exists: ${normalized.id}`);
      }
      return this.repository.put(normalized);
    }
    async delete(id) {
      validIdentifier(id, "id");
      return this.repository.delete(id);
    }
    async export(id) {
      const profile = await this.get(id);
      if (!profile) throw new ProfileValidationError("PROFILE_NOT_FOUND", `Profile not found: ${id}`);
      return JSON.stringify({
        format: "grindpilot-profile",
        schemaVersion: PROFILE_SCHEMA_VERSION,
        exportedAt: this.clock(),
        profile
      }, null, 2);
    }
    async import(serialized, { overwrite = false } = {}) {
      if (typeof serialized !== "string" || serialized.length > 1e6) {
        throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import must be JSON under 1 MB");
      }
      let envelope;
      try {
        envelope = JSON.parse(serialized);
      } catch {
        throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import is not valid JSON");
      }
      if (!isPlainObject3(envelope) || envelope.format !== "grindpilot-profile" || envelope.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import envelope is invalid or unsupported");
      }
      return this.save(envelope.profile, { overwrite });
    }
  };

  // src/presentation/product-shell-view-model.js
  var ACTIVE_RUN_STATUSES = /* @__PURE__ */ new Set([
    "running",
    "waiting",
    "paused",
    "stopping",
    "recovery_required"
  ]);
  var STEP_LABELS = Object.freeze({
    SOLVE_SBC: "Build squad",
    SUBMIT_SBC: "Submit squad",
    CLAIM_REWARD: "Claim reward",
    OPEN_REWARD_PACK: "Open reward",
    HANDLE_PLAYER_PICK: "Choose player",
    RESOLVE_ITEMS: "Route items",
    ORGANIZE_ITEMS: "Recycle remaining items"
  });
  var connectionFor = (state) => {
    if (state.bridgeHealth === "healthy") return "connected";
    if (state.bridgeHealth === "unavailable") return "unavailable";
    return "connecting";
  };
  var compatibilityFor = (gameContext) => {
    if (gameContext.gameVersion === GameVersion.FC27) {
      const contextVerified = gameContext.state === "verified";
      return {
        gameVersion: GameVersion.FC27,
        versionState: "observed",
        contextState: gameContext.state,
        planningState: "observe_only",
        gameLabel: "FC 27",
        title: "FC 27 detected",
        message: contextVerified ? "This screen is verified, but FC 27 planning is not available in this build. FUT Magic won’t run a plan." : "The game version is observed. FC 27 planning rules are not verified in this build, so FUT Magic won’t run a plan."
      };
    }
    if (gameContext.gameVersion === GameVersion.UNKNOWN) {
      return {
        gameVersion: GameVersion.UNKNOWN,
        versionState: "unknown",
        contextState: gameContext.state,
        planningState: "unavailable",
        gameLabel: "Unknown",
        title: "Game version not confirmed",
        message: "FUT Magic can’t verify which game version is open, so planning stays off."
      };
    }
    return null;
  };
  var blockerMessage = (blocker = {}) => {
    if (blocker.message) return String(blocker.message);
    const messages = {
      CAPABILITY_UNAVAILABLE: "A required EA capability is not verified right now.",
      GAME_CONTEXT_UNVERIFIED: "Open a verifiable SBC challenge in EA and try again.",
      OPEN_PROJECT_REQUIRED: "Open this project's SBC set in EA and try again.",
      CURRENT_CHALLENGE_NOT_IN_PROJECT: "The open challenge is not part of this project.",
      CHALLENGE_COMPLETED: "The open challenge is already complete.",
      UNKNOWN_REQUIREMENTS: "This challenge contains requirements FUT Magic cannot verify safely.",
      NO_VERIFIED_SOLUTION: "No submit-ready protected squad was found.",
      SOLUTION_ITEMS_UNOBSERVED: "The solver referenced cards outside the current Club snapshot.",
      PROTECTED_ITEM_SELECTED: "The proposed squad included a protected card.",
      ROUTING_CAPABILITY_EVIDENCE_MISSING: "EA did not expose enough move evidence for every proposed card.",
      ROUTE_ITEM_UNOBSERVED: "A proposed card is no longer in the current Unassigned snapshot.",
      ROUTE_COVERAGE_MISMATCH: "The route does not account for every Unassigned item exactly once.",
      NO_SAFE_ROUTE: "No current Unassigned item has a verified safe destination.",
      ROUTE_TOO_LARGE: "The current Unassigned route is too large for one bounded approval.",
      REVIEW_INPUT_TOO_LARGE: "This Club snapshot is too large for one bounded protection review."
    };
    return messages[String(blocker.code)] || "The preview is blocked safely.";
  };
  var PROTECTION_REASON_LABELS = Object.freeze({
    "locked-item": "EA-locked cards",
    "protected-item-flag": "EA-protected cards",
    "protected-item": "Specific cards",
    "protected-player": "Specific players",
    "protected-resource": "Specific card versions",
    "protected-rating": "Rating threshold",
    "target-project-rating": "Project rating rules",
    "protected-card-type": "Protected card types",
    "special-type-not-allowed": "Special-card rules",
    "starting-squad": "Active squad",
    favorite: "Favourites",
    tradable: "Tradable cards"
  });
  var publicCardExample = (card = {}) => ({
    name: card.name == null ? "Unnamed card" : String(card.name),
    rating: Math.max(0, Number(card.rating || 0)),
    location: String(card.location || "club")
  });
  var protectionPlanViewModel = (plan, state = {}) => {
    const empty = {
      status: "idle",
      observedAt: null,
      verificationMessage: "Review current protection to see its effect.",
      uniqueHardProtectedCount: null,
      analyzedItemCount: null,
      reasonGroups: [],
      ratingReserves: [],
      specialReserves: [],
      projectSignals: [],
      preferences: [],
      evidenceWarnings: [],
      advancedActive: false
    };
    if (!plan) return empty;
    const preview = plan.preview || {};
    const conservation = preview.softConservation || {};
    const verificationState = String(preview.verificationState || "unverified").toLowerCase();
    const blocked2 = plan.state !== "ready";
    const warnings = [
      ...preview.evidenceWarnings || preview.warnings || [],
      ...(plan.blockers || []).map(blockerMessage)
    ].map(String);
    const preferenceInput = preview.preferences || conservation.preferences;
    const preferences = Array.isArray(preferenceInput) ? preferenceInput.map((entry, index) => ({
      id: String(entry.id || `preference-${index + 1}`),
      label: String(entry.label || "Local squad preference"),
      enabled: entry.enabled !== false
    })) : [
      { id: "duplicates", label: "Duplicates", enabled: preferenceInput?.preferDuplicates !== false },
      { id: "sbc-storage", label: "Cards from SBC Storage", enabled: preferenceInput?.preferSbcStorage !== false },
      { id: "untradeables", label: "Untradeable cards", enabled: preferenceInput?.preferUntradeables !== false }
    ];
    const draft = state.draft || {};
    const advancedActive = Boolean(
      (draft.protectedItemIds || []).length || (draft.protectedPlayerIds || []).length || (draft.protectedResourceIds || []).length || (draft.protectedRatings || []).length || (draft.protectedCardTypes || []).length || Array.isArray(draft.allowedSpecialTypes) || Object.keys(draft.minimumReserveByRating || {}).length || Object.keys(draft.specialReserveByCardType || {}).length || draft.protectTradables === true
    );
    return {
      status: blocked2 ? "blocked" : verificationState === "verified" ? "ready" : "unverified",
      observedAt: Number.isFinite(Number(preview.observedAt)) ? Number(preview.observedAt) : Number.isFinite(Date.parse(String(preview.observedAt || ""))) ? Date.parse(String(preview.observedAt)) : Number(plan.createdAt || 0) || null,
      verificationMessage: blocked2 ? "Current impact is unavailable. Your configured rules still apply to future previews." : verificationState === "verified" ? "Based on the latest verified Club snapshot." : Number(preview.uniqueHardProtectedCount || 0) > 0 ? "At least the shown exclusions are verified, but EA did not expose every flag needed to prove the full count." : "EA did not expose every flag needed to verify current exclusions.",
      uniqueHardProtectedCount: preview.uniqueHardProtectedCount == null ? null : Math.max(0, Number(preview.uniqueHardProtectedCount)),
      analyzedItemCount: preview.analyzedItemCount == null ? null : Math.max(0, Number(preview.analyzedItemCount)),
      reasonGroups: (preview.reasonGroups || []).map((group, index) => ({
        code: `reason-${index + 1}`,
        label: PROTECTION_REASON_LABELS[String(group.code)] || "Additional protection rule",
        count: Math.max(0, Number(group.itemCount ?? group.count ?? 0)),
        examples: (group.examples || []).slice(0, 5).map(publicCardExample)
      })),
      ratingReserves: (preview.ratingReserves || conservation.ratingReserves || []).map((entry) => ({
        rating: Math.max(0, Number(entry.rating || 0)),
        minimum: Math.max(0, Number(entry.minimum ?? entry.reserved ?? entry.count ?? 0)),
        observedCount: entry.observedCount == null ? null : Math.max(0, Number(entry.observedCount))
      })),
      specialReserves: (preview.specialReserves || conservation.specialReserves || []).map((entry) => ({
        cardType: String(entry.cardType || "special card"),
        minimum: Math.max(0, Number(entry.minimum ?? entry.reserved ?? entry.count ?? 0)),
        observedCount: entry.observedCount == null ? null : Math.max(0, Number(entry.observedCount))
      })),
      projectSignals: (preview.projectSignals || []).map((entry) => ({
        name: String(entry.name || "Active project"),
        hardExclusions: (entry.hardExclusions || []).map(String),
        conservationPreferences: (entry.conservationPreferences || []).map(String),
        unknownRequirementCount: Math.max(0, Number(entry.unknownRequirementCount || 0))
      })),
      preferences: preferences.slice(0, 3),
      evidenceWarnings: warnings,
      advancedActive: Boolean(preview.advancedActive || advancedActive)
    };
  };
  var duplicateRoutePlanViewModel = (plan, notice) => {
    if (!plan) return notice == null ? null : {
      id: null,
      state: "blocked",
      status: "expired",
      totalCount: 0,
      safeCount: 0,
      toClubCount: 0,
      toStorageCount: 0,
      attentionCount: 0,
      cards: [],
      explanations: [],
      blockers: [],
      canApprove: false,
      approvalLabel: "Preview again",
      notice: String(notice)
    };
    const preview = plan.preview || {};
    const safeCount = Math.max(0, Number(preview.safeCount || 0));
    return {
      id: String(plan.id),
      state: String(plan.state || "blocked"),
      status: String(preview.status || plan.state || "blocked"),
      createdAt: Number(plan.createdAt || 0),
      totalCount: Math.max(0, Number(preview.totalCount || 0)),
      safeCount,
      toClubCount: Math.max(0, Number(preview.toClubCount || 0)),
      toStorageCount: Math.max(0, Number(preview.toStorageCount || 0)),
      attentionCount: Math.max(0, Number(preview.attentionCount || 0)),
      cards: (preview.cards || []).slice(0, 100).map((card) => ({
        name: card.name == null ? null : String(card.name),
        rating: Number(card.rating || 0),
        isSpecial: Boolean(card.isSpecial),
        isTradable: Boolean(card.isTradable),
        action: String(card.action || "PAUSE"),
        destination: String(card.destination || "unassigned"),
        reason: String(card.reason || "Kept for your decision")
      })),
      explanations: (plan.explanation || []).slice(0, 4).map(String),
      blockers: (plan.blockers || []).map((blocker) => ({
        code: String(blocker.code || "BLOCKED"),
        message: blockerMessage(blocker)
      })),
      canApprove: plan.state === "ready" && preview.status === "ready" && preview.safetyBoundary === "SAFE_ITEM_MOVES_ONLY" && (preview.cards || []).length === Number(preview.totalCount || 0) && Number(preview.totalCount || 0) <= 100 && safeCount > 0,
      approvalLabel: `Move ${safeCount} safe item${safeCount === 1 ? "" : "s"}`,
      notice: notice == null ? null : String(notice)
    };
  };
  var ROUTER_REASON_COPY = Object.freeze({
    UNASSIGNED_CLEAR: "There is nothing to route right now.",
    EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED: "This exact duplicate has a verified SBC Storage destination.",
    UNIQUE_CLUB_MOVE_VERIFIED: "EA verified that this card can return to Club.",
    TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE: "SBC Storage has no verified space. This tradable duplicate stays Unassigned for your decision.",
    UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION: "This untradeable duplicate has no verified Club or SBC Storage destination.",
    DUPLICATE_IDENTITY_UNVERIFIED: "The exact card version could not be verified, so no destination was inferred.",
    CLUB_MOVE_EVIDENCE_UNVERIFIED: "EA did not expose the per-card evidence needed to verify a Club move.",
    STORAGE_MOVE_EVIDENCE_UNVERIFIED: "EA did not expose the per-card evidence needed to verify an SBC Storage move.",
    TRADABILITY_EVIDENCE_UNVERIFIED: "EA did not expose enough tradability evidence for a safe routing choice.",
    STORAGE_CAPACITY_UNVERIFIED: "Current SBC Storage capacity could not be verified.",
    ITEM_EXPLICITLY_NOT_MOVABLE: "EA reports that this card cannot move right now.",
    ROUTE_EVIDENCE_MISSING: "The current Unassigned route could not be observed completely.",
    ROUTE_EVIDENCE_CONFLICT: "Current Unassigned evidence does not describe one coherent route.",
    INVENTORY_SNAPSHOT_INVALID: "The current Club snapshot is incomplete or inconsistent.",
    INPUT_LIMIT_EXCEEDED: "The current inventory exceeds this bounded local Router review.",
    GAME_CONTEXT_UNVERIFIED: "The current EA game context is not verified for FC 26 routing.",
    READ_CAPABILITY_UNAVAILABLE: "Current Club and Unassigned reads are unavailable.",
    MOVE_CAPABILITY_UNAVAILABLE: "EA item-move capability is not currently verified.",
    ACTIVITY_GUARD_NOT_IDLE: "Finish, stop, or recover the active run before routing items.",
    ACTIVITY_GUARD_UNVERIFIED: "Activity Guard could not verify that routing is currently idle."
  });
  var routerRecommendationViewModel = (recommendation, notice) => {
    if (!recommendation) return notice == null ? null : {
      status: "expired",
      kind: "pause",
      title: "Recommendation out of date",
      reason: String(notice),
      evidence: "Nothing moved. Refresh the Router recommendation from current evidence.",
      observedAt: 0,
      card: null,
      destination: null,
      readOnly: true
    };
    const outcome2 = recommendation.outcome || {};
    const internalKind = String(outcome2.kind || "PAUSE");
    const kind = {
      KEEP: "keep",
      MOVE_TO_CLUB: "move_to_club",
      MOVE_TO_SBC_STORAGE: "move_to_sbc_storage",
      RESERVE: "reserve",
      PAUSE: "pause",
      ASK_USER: "ask_user"
    }[internalKind] || "pause";
    const status = {
      READY: "ready",
      ATTENTION: "attention",
      CLEAR: "clear",
      BLOCKED: "blocked"
    }[String(recommendation.state || "BLOCKED")] || "blocked";
    const display = outcome2.display || null;
    const cardName = display?.name ? String(display.name) : "this card";
    const title = kind === "move_to_club" ? `Move ${cardName} to Club` : kind === "move_to_sbc_storage" ? `Move ${cardName} to SBC Storage` : kind === "ask_user" ? "Choose what to do in EA" : kind === "reserve" ? `Reserve ${cardName}` : status === "clear" ? "Unassigned is clear" : "Routing paused";
    const reasonCode = String(outcome2.reasonCode || "ROUTE_EVIDENCE_CONFLICT");
    const evidence = status === "ready" ? "Checked the complete bounded Unassigned snapshot, exact card-version identity, destination evidence, EA capabilities, and Activity Guard." : status === "clear" ? "Checked the complete bounded Unassigned snapshot." : "The Router stopped at the first unverified or attention-required boundary.";
    return {
      status,
      kind,
      title,
      reason: ROUTER_REASON_COPY[reasonCode] || ROUTER_REASON_COPY.ROUTE_EVIDENCE_CONFLICT,
      evidence,
      observedAt: Number(recommendation.observedAt || 0),
      card: display ? {
        name: display.name == null ? null : String(display.name),
        rating: Math.max(0, Number(display.rating || 0)),
        isSpecial: Boolean(display.isSpecial),
        isTradable: display.isTradable == null ? null : display.isTradable === true
      } : null,
      destination: outcome2.destination == null ? null : String(outcome2.destination),
      readOnly: true
    };
  };
  var projectPlanViewModel = (plan, notice) => {
    if (!plan) return null;
    const preview = plan.preview || {};
    return {
      id: String(plan.id),
      state: String(plan.state || "blocked"),
      status: String(preview.status || plan.state || "blocked"),
      createdAt: Number(plan.createdAt || 0),
      challengeName: preview.challengeName == null ? null : String(preview.challengeName),
      targetRating: preview.targetRating == null ? null : Number(preview.targetRating),
      selectedCount: Math.max(0, Number(preview.selectedCount || 0)),
      cards: (preview.cards || []).slice(0, 11).map((card) => ({
        name: card.name == null ? null : String(card.name),
        rating: Number(card.rating || 0),
        location: String(card.location || "club"),
        isSpecial: Boolean(card.isSpecial),
        isDuplicate: Boolean(card.isDuplicate),
        isTradable: Boolean(card.isTradable)
      })),
      ratingRange: preview.ratingRange ? { min: Number(preview.ratingRange.min), max: Number(preview.ratingRange.max) } : null,
      specialCount: Math.max(0, Number(preview.specialCount || 0)),
      duplicateCount: Math.max(0, Number(preview.duplicateCount || 0)),
      storageCount: Math.max(0, Number(preview.storageCount || 0)),
      protectedCount: Math.max(0, Number(preview.protectedCount || 0)),
      selectedProtectedCount: preview.selectedProtectedCount == null ? null : Math.max(0, Number(preview.selectedProtectedCount)),
      explanations: (plan.explanation || []).slice(0, 6).map(String),
      blockers: (plan.blockers || []).map((blocker) => ({
        code: String(blocker.code || "BLOCKED"),
        message: blockerMessage(blocker)
      })),
      canApprove: plan.state === "ready" && preview.status === "ready" && preview.selectedProtectedCount != null && Number(preview.selectedProtectedCount) === 0,
      approvalLabel: "Build & submit squad",
      notice: notice == null ? null : String(notice)
    };
  };
  var projectViewModel = (project, storedProject, observedAt, plan, planNotice) => {
    const total = Number(project.totalSquads || 0) || null;
    const completed2 = Math.max(0, Number(project.completedSquads || 0));
    const fallbackProgress = Number(storedProject?.completionProgress);
    const progress = total ? Math.min(1, completed2 / total) : Number.isFinite(fallbackProgress) ? Math.min(1, Math.max(0, fallbackProgress)) : null;
    const protectionSummary = [];
    if (project.protectedRatings?.atOrAbove) {
      protectionSummary.push(`${project.protectedRatings.atOrAbove}+ cards excluded`);
    }
    const exactRatings = project.protectedRatings?.exact || storedProject?.protectedRatings?.exact || [];
    if (exactRatings.length) protectionSummary.push(`Exact ratings ${exactRatings.join(", ")} excluded`);
    const ratingReserves = Object.entries(
      project.protectedRatings?.reserveByRating || storedProject?.protectedRatings?.reserveByRating || {}
    );
    if (ratingReserves.length) {
      protectionSummary.push(`Try to keep ${ratingReserves.map(([rating, count]) => `${count} × ${rating}`).join(" · ")}`);
    }
    if ((project.remainingSpecials || []).length) {
      protectionSummary.push(`Try to keep ${(project.remainingSpecials || []).map((entry) => `${entry.remaining} × ${String(entry.cardType || "special").toUpperCase()}`).join(" · ")}`);
    }
    if (!protectionSummary.length) protectionSummary.push("No additional project protection or reserves");
    return {
      id: String(project.id),
      name: String(project.name || "Untitled project"),
      state: progress === 1 ? "complete" : "active",
      completedSquads: completed2,
      totalSquads: total,
      progress,
      requiredSquadsRemaining: Math.max(0, Number(project.requiredSquadsRemaining || 0)),
      remainingRatings: (project.remainingRatings || []).map((entry) => ({
        rating: Number(entry.rating),
        needed: Math.max(0, Number(entry.remaining || 0)),
        exactRatingInClub: Math.max(0, Number(entry.clubCount || 0))
      })),
      remainingSpecials: (project.remainingSpecials || []).map((entry) => ({
        type: String(entry.cardType || "special"),
        needed: Math.max(0, Number(entry.remaining || 0))
      })),
      protectionSummary: protectionSummary.slice(0, 4),
      source: project.sourceSetId ? "ea_import" : "manual",
      unknownRequirementCount: (storedProject?.sourceChallenges || []).reduce(
        (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
        0
      ),
      preview: projectPlanViewModel(plan, planNotice),
      planNotice: planNotice == null ? null : String(planNotice),
      observedAt
    };
  };
  var buildRun = (state) => {
    if (!ACTIVE_RUN_STATUSES.has(String(state.runStatus || "idle"))) return null;
    const timeline = Array.isArray(state.timeline) ? state.timeline : [];
    const currentIndex = timeline.findIndex((entry) => entry.active);
    const current = currentIndex >= 0 ? timeline[currentIndex] : null;
    const next = currentIndex >= 0 ? timeline.slice(currentIndex + 1).find((entry) => entry.status === "pending") : timeline.find((entry) => entry.status === "pending");
    const status = String(state.runStatus);
    const intervention = state.pauseReason || state.error ? {
      title: status === "recovery_required" ? "Needs review" : "Run paused",
      message: String(state.pauseReason || state.error)
    } : null;
    const guard = status === "recovery_required" ? { state: "recovery", label: "Recovery", reason: intervention?.message || null } : status === "paused" ? { state: "caution", label: "Caution", reason: intervention?.message || null } : { state: "normal", label: "Normal", reason: null };
    return {
      title: String(state.runName || "FUT Magic run"),
      modeLabel: String(state.runModeLabel || "Approved plan"),
      status,
      progress: {
        current: Math.max(0, Number(state.iterations || 0)),
        total: Math.max(0, Number(state.maxIterations || 0)) || null,
        label: "cycles"
      },
      currentStep: current ? { label: STEP_LABELS[current.type] || String(current.type), status: current.status } : null,
      nextStep: next ? { label: STEP_LABELS[next.type] || String(next.type) } : null,
      timeline: timeline.map((entry) => ({
        label: STEP_LABELS[entry.type] || String(entry.type),
        status: String(entry.status || "pending"),
        active: Boolean(entry.active)
      })),
      guard,
      intervention,
      canPause: status === "running" || status === "waiting",
      canResume: status === "paused",
      canStop: !["stopped", "completed", "failed"].includes(status)
    };
  };
  var buildClubHealth = (state, observedAt) => {
    const inventory = state.inventory || {};
    const buckets = state.inventoryBuckets || {};
    const ratingBand = (labels) => labels.reduce((sum, label) => {
      const entry = buckets[label] || {};
      return {
        club: sum.club + Number(entry.club || 0),
        storage: sum.storage + Number(entry.storage || 0)
      };
    }, { club: 0, storage: 0 });
    return {
      observedAt,
      available: Boolean(state.inventoryAvailable),
      clubCount: state.inventoryAvailable ? Number(inventory.clubCount || 0) : null,
      unassignedCount: state.inventoryAvailable ? Number(inventory.unassignedCount || 0) : null,
      duplicateGroupCount: state.inventoryAvailable ? Number(inventory.duplicateGroupCount || 0) : null,
      storage: {
        used: state.inventoryAvailable ? Number(inventory.storageCount || 0) : null,
        capacity: state.inventoryAvailable ? Number(inventory.storageCapacity || 0) || null : null,
        free: state.inventoryAvailable && inventory.storageFreeSlots != null ? Number(inventory.storageFreeSlots) : null
      },
      ratingBands: [
        { label: "90+ cards", ...ratingBand(["90", "91", "92", "93", "94+"]) },
        { label: "87–89 cards", ...ratingBand(["87", "88", "89"]) },
        { label: "85–86 cards", ...ratingBand(["85", "86"]) }
      ],
      protectedCount: state.fodderReviewPlan?.preview?.uniqueHardProtectedCount == null ? null : Number(state.fodderReviewPlan.preview.uniqueHardProtectedCount)
    };
  };
  var goalActions = (state, activeProject, compatibility) => {
    const unassignedCount = Number(state.inventory?.unassignedCount || 0);
    const actions = [
      {
        id: "complete-sbc",
        label: "Complete an SBC",
        description: state.currentContext?.challengeName ? `Continue ${state.currentContext.challengeName}` : "Open an SBC in EA to continue",
        enabled: Boolean(state.currentContext?.challengeId),
        command: activeProject ? { type: "PREVIEW_SBC_PROJECT", projectId: activeProject.id } : { type: "OPEN_LEGACY_UI", section: "SBC Solver" },
        plan: "free"
      },
      {
        id: "grind-upgrades",
        label: "Grind upgrades",
        description: "Build a bounded local recipe",
        enabled: true,
        command: { type: "OPEN_LEGACY_UI", section: "Workflows" },
        plan: "free"
      },
      {
        id: "clear-duplicates",
        label: "Clear duplicates",
        description: unassignedCount > 0 ? `${unassignedCount} items need attention` : "Review the safe routing flow",
        enabled: Boolean(state.inventoryAvailable),
        disabledReason: "Current Unassigned data is unavailable",
        command: state.inventoryAvailable ? { type: "PREVIEW_CLEAR_DUPLICATES" } : null,
        plan: "free"
      },
      {
        id: "protect-cards",
        label: "Protect my cards",
        description: state.fodderReviewPlan?.preview?.uniqueHardProtectedCount == null ? "Review exclusions and local squad preferences" : `${Number(state.fodderReviewPlan.preview.uniqueHardProtectedCount)} verified exclusions in the latest snapshot`,
        enabled: true,
        command: { type: "PREVIEW_FODDER_REVIEW" },
        plan: "free"
      },
      {
        id: "plan-evolution",
        label: "Plan an Evolution",
        description: "Live Evolution data is not available in this build",
        enabled: false,
        disabledReason: "Live Evolution data is not available in this build",
        command: null,
        plan: "pro"
      },
      {
        id: "optimize-club",
        label: "Optimize my club",
        description: "Club-wide planning is coming later",
        enabled: false,
        disabledReason: "Club optimization is not implemented yet",
        command: null,
        plan: "pro"
      }
    ];
    if (!compatibility) return actions;
    const disabledReason = compatibility.gameVersion === GameVersion.FC27 ? "FC 27 planning is not verified in this build" : "Confirm the game version before planning";
    const compatibilityGated = /* @__PURE__ */ new Set([
      "complete-sbc",
      "grind-upgrades",
      "clear-duplicates",
      "protect-cards"
    ]);
    return actions.map((action) => compatibilityGated.has(action.id) ? { ...action, enabled: false, disabledReason, command: null } : action);
  };
  var buildProductShellViewModel = (state = {}, { now = Date.now() } = {}) => {
    const storedProjects = new Map(
      (state.projects || []).map((project) => [String(project.id), project])
    );
    const projects = (state.targetDashboard || []).map((project) => projectViewModel(
      project,
      storedProjects.get(String(project.id)),
      now,
      state.sbcPlanPreviews?.[String(project.id)],
      state.sbcPlanNotices?.[String(project.id)]
    ));
    const activeProject = projects.find((project) => project.state === "active") || null;
    const run = buildRun(state);
    const unassignedCount = Number(state.inventory?.unassignedCount || 0);
    const runtimeContext = state.gameContext || {};
    const gameContext = createGameContext({
      gameVersion: runtimeContext.gameVersion ?? state.gameVersion ?? GameVersion.UNKNOWN,
      state: runtimeContext.state ?? state.gameContextState ?? (state.bridgeHealth === "healthy" && state.currentContext?.challengeId ? "verified" : "unverified"),
      challengeKind: runtimeContext.challengeKind,
      gameVersionObservation: runtimeContext.gameVersionObservation,
      gameVersionSource: runtimeContext.gameVersionSource,
      route: runtimeContext.route ?? state.currentContext?.route,
      setId: runtimeContext.setId ?? state.currentContext?.setId,
      setName: runtimeContext.setName ?? state.currentContext?.setName,
      challengeId: runtimeContext.challengeId ?? state.currentContext?.challengeId,
      challengeName: runtimeContext.challengeName ?? state.currentContext?.challengeName,
      observedAt: Number(runtimeContext.observedAt ?? state.contextObservedAt ?? now),
      evidence: runtimeContext.evidence ?? null
    });
    const compatibility = compatibilityFor(gameContext);
    let notice = null;
    if (run?.intervention) {
      notice = { tone: "warning", ...run.intervention };
    } else if (unassignedCount > 0) {
      notice = {
        tone: "warning",
        title: `${unassignedCount} items need attention`,
        message: "Unassigned items block the next pack until they are routed safely."
      };
    } else if (state.error) {
      notice = { tone: "error", title: "FUT Magic is limited", message: String(state.error) };
    }
    return {
      protocolVersion: 1,
      revision: Math.max(0, Number(state.productRevision || 0)),
      observedAt: now,
      brand: { name: "FUT Magic", paidName: "FUT Magic Pro", plan: "free" },
      connection: {
        state: connectionFor(state),
        label: state.bridgeHealth === "healthy" ? "EA connected" : state.bridgeHealth === "unavailable" ? "Limited" : "Connecting"
      },
      context: gameContext,
      compatibility,
      notice,
      run,
      projects,
      activeProject,
      clubHealth: buildClubHealth(state, now),
      duplicateRoute: duplicateRoutePlanViewModel(
        state.duplicateRoutePlan,
        state.duplicateRouteNotice
      ),
      routerRecommendation: routerRecommendationViewModel(
        state.routerRecommendation,
        state.routerRecommendationNotice
      ),
      protection: protectionPlanViewModel(state.fodderReviewPlan, state),
      actions: goalActions(state, activeProject, compatibility),
      legacyAvailable: true,
      legal: {
        disclaimer: "Unofficial. Not affiliated with or endorsed by Electronic Arts.",
        license: "GPL-3.0-only",
        sourceUrl: "https://github.com/Matchekk/Matchek-s-FUT-Magic",
        licenseUrl: "../LICENSE",
        privacyUrl: "../PRIVACY.md",
        noticesUrl: "../THIRD_PARTY_NOTICES.md",
        warranty: "No warranty. Redistribution and modification are permitted under GPLv3."
      }
    };
  };

  // src/recipes/duplicate-recycle.js
  var DuplicateRecycleStatus = Object.freeze({
    READY: "ready",
    BLOCKED: "blocked",
    EMPTY: "empty",
    STALE: "stale"
  });
  var DuplicateRecycleReason = Object.freeze({
    NO_BLOCKING_DUPLICATES: "NO_BLOCKING_DUPLICATES",
    NO_VERIFIED_RECIPE: "NO_VERIFIED_RECIPE",
    DUPLICATE_NOT_ACCEPTED: "DUPLICATE_NOT_ACCEPTED",
    PROTECTED_ITEM_USAGE: "PROTECTED_ITEM_USAGE",
    ITEM_EVIDENCE_UNVERIFIED: "ITEM_EVIDENCE_UNVERIFIED",
    INVALID_SOLUTION_REFERENCE: "INVALID_SOLUTION_REFERENCE",
    STALE_INVENTORY: "STALE_INVENTORY",
    STALE_PROJECT: "STALE_PROJECT",
    ACTIVITY_GUARD_NOT_NORMAL: "ACTIVITY_GUARD_NOT_NORMAL"
  });
  var freeze = (value) => {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === "object") {
      return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
    }
    return value;
  };
  var stable3 = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable3).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable3(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  var fingerprint3 = (value) => {
    const input = stable3(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };
  function fingerprintDuplicateRecycleInventory(snapshot = {}) {
    return fingerprint3({
      storageCapacity: snapshot.storageCapacity ?? null,
      items: [...snapshot.items ?? []].map((item) => ({
        itemId: String(item.itemId ?? ""),
        resourceId: item.resourceId == null ? null : String(item.resourceId),
        definitionId: item.definitionId == null ? null : String(item.definitionId),
        location: String(item.location ?? ""),
        rating: Number(item.rating || 0),
        isTradable: item.isTradable ?? null,
        isDuplicate: item.isDuplicate ?? null,
        isLocked: item.isLocked ?? null,
        isProtected: item.isProtected ?? null,
        isInStartingSquad: item.isInStartingSquad ?? null,
        hasTradabilityEvidence: item.hasTradabilityEvidence ?? null,
        hasLockedEvidence: item.hasLockedEvidence ?? null,
        hasProtectedEvidence: item.hasProtectedEvidence ?? null,
        hasStartingSquadEvidence: item.hasStartingSquadEvidence ?? null,
        hasSpecialEvidence: item.hasSpecialEvidence ?? null
      })).sort((left, right) => left.itemId.localeCompare(right.itemId))
    });
  }
  function fingerprintDuplicateRecycleProjects(projects = []) {
    return fingerprint3([...Array.isArray(projects) ? projects : []].map((project) => ({
      id: String(project?.id ?? ""),
      active: project?.active !== false,
      priority: Number(project?.priority || 0),
      requiredSquadsRemaining: Number(project?.requiredSquadsRemaining || 0),
      completionProgress: Number(project?.completionProgress || 0),
      sourceSetId: project?.sourceSetId == null ? null : String(project.sourceSetId),
      sourceChallengeIds: [...project?.sourceChallengeIds ?? []].map(String).sort(),
      sourceChallenges: [...project?.sourceChallenges ?? []].map((challenge) => ({
        id: String(challenge?.id ?? ""),
        completed: challenge?.completed === true,
        requiredSquadRating: challenge?.requiredSquadRating ?? null,
        specialCardRequirements: [...challenge?.specialCardRequirements ?? []].map((entry) => ({
          cardType: String(entry?.cardType ?? ""),
          count: Number(entry?.count || 0),
          completed: Number(entry?.completed || 0),
          perRemainingSquad: entry?.perRemainingSquad === true
        })).sort((left, right) => left.cardType.localeCompare(right.cardType)),
        unknownRequirements: [...challenge?.unknownRequirements ?? []].map(String).sort()
      })).sort((left, right) => left.id.localeCompare(right.id)),
      ratingRequirements: [...project?.ratingRequirements ?? []].map((entry) => ({
        rating: Number(entry?.rating || 0),
        count: Number(entry?.count || 0),
        completed: Number(entry?.completed || 0)
      })).sort((left, right) => left.rating - right.rating),
      specialCardRequirements: [...project?.specialCardRequirements ?? []].map((entry) => ({
        cardType: String(entry?.cardType ?? ""),
        count: Number(entry?.count || 0),
        completed: Number(entry?.completed || 0),
        perRemainingSquad: entry?.perRemainingSquad === true
      })).sort((left, right) => left.cardType.localeCompare(right.cardType)),
      protectedPlayerIds: [...project?.protectedPlayerIds ?? []].map(String).sort(),
      protectedResourceIds: [...project?.protectedResourceIds ?? []].map(String).sort(),
      protectedRatings: project?.protectedRatings ?? null
    })).sort((left, right) => left.id.localeCompare(right.id)));
  }
  function fingerprintDuplicateRecycleRequirement({ setId, challenge } = {}) {
    return fingerprint3({
      setId: setId == null ? null : String(setId),
      challengeId: challenge?.id == null ? null : String(challenge.id),
      completed: challenge?.completed === true,
      requiredSquadRating: challenge?.requiredSquadRating ?? null,
      specialCardRequirements: [...challenge?.specialCardRequirements ?? []].map((entry) => ({
        cardType: String(entry?.cardType ?? ""),
        count: Number(entry?.count || 0),
        completed: Number(entry?.completed || 0),
        perRemainingSquad: entry?.perRemainingSquad === true
      })).sort((left, right) => left.cardType.localeCompare(right.cardType)),
      unknownRequirements: [...challenge?.unknownRequirements ?? []].map(String).sort()
    });
  }
  function fingerprintDuplicateRecycleCapabilities(capabilities = []) {
    return fingerprint3([...Array.isArray(capabilities) ? capabilities : []].map((entry) => ({
      id: String(entry?.id ?? "").trim().toLowerCase(),
      status: String(entry?.status ?? "UNKNOWN").trim().toUpperCase()
    })).filter((entry) => entry.id).sort((left, right) => left.id.localeCompare(right.id)));
  }
  function compileDuplicateRecycleWorkflow(preview) {
    if (preview?.status !== DuplicateRecycleStatus.READY || preview.canCompile !== true) {
      throw new TypeError("A ready duplicate recycle preview is required");
    }
    return freeze({
      id: `duplicate-recycle-${preview.target.targetId}`,
      name: "Recycle duplicates",
      version: 1,
      metadata: { source: "fut-magic-duplicate-recipe", safetyModel: "fail-closed" },
      steps: [{
        id: "recycle-approved-duplicates",
        type: "ORGANIZE_ITEMS",
        config: {
          approvedRecycle: {
            target: {
              targetId: preview.target.targetId,
              setId: preview.target.setId,
              challengeId: preview.target.challengeId
            },
            requiredItemIds: preview.blockingItemIds,
            exactSolutionItemIds: preview.target.completeSolutionItemIds,
            inventoryGeneration: preview.inventoryGeneration,
            inventoryFingerprint: preview.inventoryFingerprint,
            projectGeneration: preview.projectGeneration,
            projectFingerprint: preview.projectFingerprint,
            protectionFingerprint: preview.target.protectionFingerprint,
            requirementsFingerprint: preview.target.requirementsFingerprint,
            capabilityFingerprint: preview.target.capabilityFingerprint
          }
        },
        timeoutMs: 18e4,
        retryPolicy: { maxAttempts: 1 },
        onFailure: "PAUSE"
      }]
    });
  }

  // src/ui/grind-panel.js
  var css = `
:host{all:initial;--fm-bg-primary:#0b1020;--fm-bg-secondary:#121a2e;--fm-bg-elevated:#1e2b4d;--fm-text-primary:#e6edf5;--fm-text-secondary:#a7b2c9;--fm-text-muted:#8793aa;--fm-accent-primary:#00e6ff;--fm-accent-secondary:#26ffc2;--fm-focus:#7af4ff;--fm-destructive:#ff7f8f;--fm-border-subtle:#2a3858;color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}.launcher{position:fixed;right:18px;top:45%;z-index:2147483600;width:46px;height:46px;border:0;border-radius:15px;background:linear-gradient(145deg,#75bfff,#1e70d2);color:#fff;font-weight:900;box-shadow:0 10px 32px #0008;cursor:pointer}
.panel{position:fixed;z-index:2147483599;right:18px;top:72px;width:min(960px,calc(100vw - 36px));height:min(760px,calc(100vh - 100px));display:grid;grid-template-columns:170px 1fr;background:#10140ff2;backdrop-filter:blur(18px) saturate(140%);border:1px solid #4f6043;border-radius:18px;box-shadow:0 24px 80px #000c;overflow:hidden;color:#edf5e7}.hidden{display:none!important}
aside{padding:16px 10px;background:#151b13;border-right:1px solid #36432f;overflow:auto}.brand{padding:4px 8px 15px;font-size:17px;font-weight:800;color:#75bfff}.brand small{display:block;color:#85917e;font-size:10px;font-weight:600;margin-top:3px}.nav{display:block;width:100%;border:0;background:transparent;color:#b7c2b1;text-align:left;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:12px}.nav:hover,.nav.active{background:#263747;color:#fff}.main{padding:18px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.top h2{font-size:18px;margin:0}.close{border:0;background:#2d3529;color:#dce6d6;width:31px;height:31px;border-radius:9px;cursor:pointer}.view{display:none}.view.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.card{background:#1a2118;border:1px solid #36432f;border-radius:12px;padding:12px;margin-bottom:10px}.metric{font-size:24px;font-weight:800;color:#75bfff}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8f9b89}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}button.action{border:1px solid #53684a;background:#263420;color:#edf5e7;padding:8px 12px;border-radius:9px;cursor:pointer}button.primary{background:#2f8ee5;color:#fff;border-color:#63b0f5;font-weight:800}button.danger{background:#3a211f;border-color:#79413b}button:disabled{opacity:.42;cursor:not-allowed}.form{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:11px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-size:11px;color:#9da996}input,select,textarea{width:100%;border:1px solid #46543f;background:#11160f;color:#f4f8f0;border-radius:8px;padding:8px;font:inherit;font-size:12px}textarea{min-height:90px;resize:vertical}.hint{font-size:11px;color:#87927f;line-height:1.45}.banner{border-radius:10px;padding:9px 11px;margin-bottom:12px;background:#263747;color:#d7e7f4;font-size:12px}.banner.warn{background:#3d321d;color:#ffe3a3}.banner.error{background:#45201e;color:#ffc0b8}.log{display:grid;grid-template-columns:72px 92px 1fr;gap:8px;border-bottom:1px solid #293226;padding:7px 2px;font-size:11px}.muted{color:#86907f}.section-title{margin:18px 0 8px;font-size:13px;color:#c9d7c1}.empty{padding:25px;text-align:center;color:#778270;border:1px dashed #3e4939;border-radius:10px}.workflow-step{border-left:3px solid #2f8ee5;background:#151d20;padding:10px;margin:9px 0;border-radius:8px}.nested{margin:8px 0 12px 20px;padding-left:10px;border-left:1px dashed #526474}.requirement-row input{max-width:150px}.timeline{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.timeline span{padding:6px 9px;border-radius:20px;background:#252d25;color:#899487;font-size:11px}.timeline .done{color:#bfffc4}.timeline .active{background:#244a6d;color:#fff}.bucket-table{width:100%;border-collapse:collapse;font-size:11px}.bucket-table th,.bucket-table td{padding:7px;border-bottom:1px solid #303a2c;text-align:right}.bucket-table th:first-child,.bucket-table td:first-child{text-align:left}.health{display:grid;grid-template-columns:minmax(130px,1fr) 110px 2fr;gap:8px;padding:7px;border-bottom:1px solid #303a2c;font-size:11px}@media(max-width:680px){.panel{grid-template-columns:1fr;top:12px;height:calc(100vh - 24px)}aside{display:flex;gap:3px;overflow:auto;border-right:0;border-bottom:1px solid #36432f;padding:8px}.brand{display:none}.nav{white-space:nowrap;width:auto}.form{grid-template-columns:1fr}.health{grid-template-columns:1fr}}
.easy-hero{background:linear-gradient(145deg,#20394f,#182719);border:1px solid #4b7798;border-radius:16px;padding:18px;margin-bottom:14px}.easy-hero h3{font-size:22px;line-height:1.1;letter-spacing:-.02em;margin:0 0 7px}.easy-hero p{color:#b8c8b4;font-size:13px;line-height:1.5;margin:0}.easy-actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px}.easy-actions .action{min-height:48px;font-size:14px}.easy-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.easy-step{background:#171e16;border:1px solid #344230;border-radius:11px;padding:11px}.easy-step b{display:block;color:#75bfff;margin-bottom:3px}.easy-step span{font-size:11px;color:#9ba897;line-height:1.35}.easy-status{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.easy-status span{padding:6px 9px;border-radius:999px;background:#253025;color:#b9c7b4;font-size:11px}button.action,.launcher,.close{transition:transform 100ms ease-out,filter 120ms ease-out}button.action:active,.launcher:active,.close:active{transform:scale(.97)}details{margin:12px 0}summary{cursor:pointer;color:#b8c8b4;font-size:12px}@media(max-width:680px){.easy-steps{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){button.action,.launcher,.close{transition:none!important;transform:none!important}}@media(prefers-reduced-transparency:reduce){.panel{background:#10140f;backdrop-filter:none}}
/* FUT Magic outer-shell migration. Inner legacy forms remain intentionally dense. */
.launcher{width:48px;height:48px;border:1px solid #00e6ff55;border-radius:13px;background:var(--fm-bg-secondary);color:var(--fm-accent-primary);box-shadow:0 12px 32px #02050dcc}
.panel{grid-template-columns:180px 1fr;background:#0b1020f5;border-color:#00e6ff38;border-radius:16px;box-shadow:0 28px 80px #02050de0;color:var(--fm-text-primary)}
aside{background:var(--fm-bg-secondary);border-color:var(--fm-border-subtle)}.brand{color:var(--fm-accent-primary);font-weight:700;letter-spacing:-.015em}.brand small{color:var(--fm-text-muted);letter-spacing:.08em}.nav{min-height:44px;border-left:2px solid transparent;color:var(--fm-text-secondary);border-radius:8px}.nav:hover{background:#1e2b4d99;color:var(--fm-text-primary)}.nav.active{background:var(--fm-bg-elevated);border-left-color:var(--fm-accent-primary);color:var(--fm-text-primary)}
.main{scroll-padding-block:16px}.top h2{font-size:20px;line-height:1.2;letter-spacing:-.02em}.close{width:44px;height:44px;border:1px solid var(--fm-border-subtle);background:var(--fm-bg-elevated);color:var(--fm-text-primary);font-size:20px}.card,.easy-step{background:var(--fm-bg-secondary);border-color:var(--fm-border-subtle)}.metric,.easy-step b{color:var(--fm-accent-primary);font-variant-numeric:tabular-nums}.label,.hint,.muted,.easy-step span{color:var(--fm-text-muted)}
button.action{min-height:44px;border-color:var(--fm-border-subtle);background:var(--fm-bg-elevated);color:var(--fm-text-primary)}button.primary{background:var(--fm-accent-primary);border-color:var(--fm-accent-primary);color:#07111c}button.danger{background:#321a2a;border-color:#7c354b;color:#ffd8df}input,select,textarea{min-height:44px;border-color:var(--fm-border-subtle);background:var(--fm-bg-primary);color:var(--fm-text-primary)}label,summary{color:var(--fm-text-secondary)}.banner{background:var(--fm-bg-elevated);color:var(--fm-text-primary)}.workflow-step{border-left-color:var(--fm-accent-primary);background:var(--fm-bg-secondary)}.timeline span,.easy-status span{background:var(--fm-bg-secondary);color:var(--fm-text-secondary)}.timeline .done{color:var(--fm-accent-secondary)}.timeline .active{background:var(--fm-bg-elevated)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--fm-focus);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
@media(prefers-reduced-transparency:reduce){.panel{background:var(--fm-bg-primary);backdrop-filter:none}}
@media(prefers-contrast:more){.panel,.card,input,select,textarea,button{border-color:#7183a8}.nav.active{outline:1px solid var(--fm-accent-primary)}}
@media(forced-colors:active){.nav.active{border-left-color:Highlight}}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important}
`;
  var sections = [
    "Easy Loop",
    "SBC Solver",
    "Workflows",
    "Profiles",
    "Inventory",
    "Protected Cards",
    "Target Projects",
    "Activity",
    "Settings",
    "Developer"
  ];
  var escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  var downloadJson = (name, value) => {
    const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };
  var encodePath = (path) => encodeURIComponent(JSON.stringify(path));
  var decodePath = (value) => JSON.parse(decodeURIComponent(value || "%5B%5D"));
  var selected2 = (actual, value) => actual === value ? " selected" : "";
  var checked = (value) => value ? " checked" : "";
  var splitList = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  var legacyFocusableSelector = "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]";
  var associateLegacyLabels = (root) => {
    let index = 0;
    root.querySelectorAll(".field > label:not([for])").forEach((label) => {
      if (label.querySelector("input,select,textarea")) return;
      const control = [...label.parentElement.children].find((node) => node !== label && node.matches?.("input,select,textarea"));
      if (!control) return;
      if (!control.id) control.id = `fut-magic-legacy-field-${index += 1}`;
      label.setAttribute("for", control.id);
    });
  };
  var workflowStepControls = (step2, path, index) => {
    const attrs = `data-wf-path="${encodePath(path)}" data-wf-index="${index}"`;
    const target = step2.config?.target || {};
    const condition = step2.config?.condition || {};
    const conditionPath = condition?.left?.path || "unresolvedUnassigned";
    const conditionValue = condition?.right?.value ?? 0;
    let config = "";
    if (step2.type === "SOLVE_SBC") {
      config = `<div class="form"><div class="field"><label>Target</label><select data-wf-field="targetKind" ${attrs}><option${selected2(target.kind, "CURRENT_OPEN_SBC")}>CURRENT_OPEN_SBC</option><option${selected2(target.kind, "SPECIFIC_CHALLENGE")}>SPECIFIC_CHALLENGE</option><option${selected2(target.kind, "SPECIFIC_SET")}>SPECIFIC_SET</option></select></div><div class="field"><label>Stable set ID</label><input data-wf-field="setId" ${attrs} value="${escapeHtml(target.setId || "")}"></div><div class="field"><label>Stable challenge ID</label><input data-wf-field="challengeId" ${attrs} value="${escapeHtml(target.challengeId || "")}"></div></div>`;
    } else if (step2.type === "LOOP") {
      config = `<div class="field"><label>Loop iterations</label><input type="number" min="1" max="1000" data-wf-field="loopIterations" ${attrs} value="${escapeHtml(step2.config?.maxIterations || 1)}"></div>`;
    } else if (step2.type === "CONDITIONAL") {
      config = `<div class="form"><div class="field"><label>Metric path</label><input data-wf-field="conditionPath" ${attrs} value="${escapeHtml(conditionPath)}"></div><div class="field"><label>Operator</label><select data-wf-field="conditionOperator" ${attrs}>${["EQ", "NEQ", "GT", "GTE", "LT", "LTE"].map((value) => `<option${selected2(condition.operator, value)}>${value}</option>`).join("")}</select></div><div class="field"><label>Value</label><input data-wf-field="conditionValue" ${attrs} value="${escapeHtml(conditionValue)}"></div></div>`;
    } else if (step2.type === "DELAY") {
      config = `<div class="field"><label>Delay (ms)</label><input type="number" min="0" data-wf-field="durationMs" ${attrs} value="${escapeHtml(step2.config?.durationMs || 0)}"></div>`;
    } else if (step2.type === "PAUSE") {
      config = `<div class="field"><label>Pause reason</label><input data-wf-field="pauseReason" ${attrs} value="${escapeHtml(step2.config?.reason || "")}"></div>`;
    }
    return `<div class="workflow-step"><div class="controls"><select aria-label="Step type" data-wf-field="type" ${attrs}>${["SOLVE_SBC", "SUBMIT_SBC", "CLAIM_REWARD", "OPEN_REWARD_PACK", "RESOLVE_ITEMS", "ORGANIZE_ITEMS", "HANDLE_PLAYER_PICK", "DELAY", "CONDITIONAL", "LOOP", "PAUSE"].map((value) => `<option${selected2(step2.type, value)}>${value}</option>`).join("")}</select><button class="action" aria-label="Move step up" data-wf-action="up" ${attrs}>↑</button><button class="action" aria-label="Move step down" data-wf-action="down" ${attrs}>↓</button><button class="action" data-wf-action="duplicate" ${attrs}>Duplicate step</button><button class="action danger" data-wf-action="delete" ${attrs}>Delete step</button></div><div class="hint">${escapeHtml(step2.id)}</div>${config}<div class="form"><div class="field"><label>Timeout ms</label><input type="number" min="100" data-wf-field="timeoutMs" ${attrs} value="${escapeHtml(step2.timeoutMs || 12e4)}"></div><div class="field"><label>Retry attempts</label><input type="number" min="1" max="10" data-wf-field="retryAttempts" ${attrs} value="${escapeHtml(step2.retryPolicy?.maxAttempts || 1)}"></div><div class="field"><label>On failure</label><select data-wf-field="onFailure" ${attrs}>${["PAUSE", "STOP", "SKIP"].map((value) => `<option${selected2(step2.onFailure, value)}>${value}</option>`).join("")}</select></div></div></div>`;
  };
  var renderWorkflowSteps = (steps = [], path = []) => {
    const rows = steps.map((step2, index) => {
      const nested = [];
      for (const [branch, label] of [["body", "Loop body"], ["thenSteps", "Then"], ["elseSteps", "Else"]]) {
        if (!Array.isArray(step2.config?.[branch])) continue;
        const nextPath = [...path, { index, branch }];
        nested.push(`<div class="nested"><b>${label}</b>${renderWorkflowSteps(step2.config[branch], nextPath)}<button class="action" data-wf-add="${encodePath(nextPath)}">Add Step</button></div>`);
      }
      return workflowStepControls(step2, path, index) + nested.join("");
    }).join("");
    return rows || '<div class="empty">No steps in this branch.</div>';
  };
  var ratingRequirementRows = (requirements = []) => requirements.map((entry) => `<div class="controls requirement-row" data-rating-row><input aria-label="Rating" type="number" min="1" max="99" data-rating="rating" value="${escapeHtml(entry.rating)}"><input aria-label="Count" type="number" min="1" data-rating="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-rating="completed" value="${escapeHtml(entry.completed)}"><button class="action danger" aria-label="Remove rating requirement" data-remove-row>×</button></div>`).join("");
  var specialRequirementRows = (requirements = []) => requirements.map((entry) => `<div class="controls requirement-row" data-special-row><input aria-label="Card type" data-special="cardType" value="${escapeHtml(entry.cardType)}"><input aria-label="Count" type="number" min="1" data-special="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-special="completed" value="${escapeHtml(entry.completed)}"><label><input type="checkbox" data-special="perRemainingSquad"${checked(entry.perRemainingSquad)}> per squad</label><button class="action danger" aria-label="Remove special-card requirement" data-remove-row>×</button></div>`).join("");
  var renderProjectEditor = (project = {}) => `<section class="card project-editor" data-project-id="${escapeHtml(project.id || "")}"><div class="form"><div class="field"><label>Name</label><input data-project-field="name" value="${escapeHtml(project.name || "")}" placeholder="Target SBC"></div><div class="field"><label><input type="checkbox" data-project-field="active"${checked(project.active !== false)}> Active</label></div><div class="field"><label>Priority</label><input type="number" min="0" data-project-field="priority" value="${escapeHtml(project.priority ?? 50)}"></div><div class="field"><label>Squads remaining</label><input type="number" min="0" data-project-field="requiredSquadsRemaining" value="${escapeHtml(project.requiredSquadsRemaining ?? 0)}"></div><div class="field"><label>Hard protect at/above</label><input type="number" min="1" max="99" data-project-field="atOrAbove" value="${escapeHtml(project.protectedRatings?.atOrAbove ?? "")}"></div><div class="field"><label>Hard exact ratings (comma-separated)</label><input data-project-field="exact" value="${escapeHtml((project.protectedRatings?.exact || []).join(", "))}"></div><div class="field"><label>Soft rating reserves (e.g. 89:3, 90:2)</label><input data-project-field="reserveByRating" value="${escapeHtml(Object.entries(project.protectedRatings?.reserveByRating || {}).map(([rating, count]) => `${rating}:${count}`).join(", "))}"></div><div class="field"><label>Protected player IDs</label><input data-project-field="protectedPlayerIds" value="${escapeHtml((project.protectedPlayerIds || []).join(", "))}"></div><div class="field"><label>Protected resource IDs</label><input data-project-field="protectedResourceIds" value="${escapeHtml((project.protectedResourceIds || []).join(", "))}"></div><div class="field"><label>Completion</label><input type="number" min="0" max="1" step="0.01" data-project-field="completionProgress" value="${escapeHtml(project.completionProgress ?? 0)}"></div></div><div class="section-title">Rating requirements · Rating / Count / Completed</div><div data-rating-rows>${ratingRequirementRows(project.ratingRequirements)}</div><button class="action" data-add-rating-row>Add rating requirement</button><div class="section-title">Special requirements · Type / Count / Completed</div><div data-special-rows>${specialRequirementRows(project.specialCardRequirements)}</div><button class="action" data-add-special-row>Add special requirement</button><div class="controls"><button class="action primary" data-save-project>Save project</button>${project.sourceSetId ? `<button class="action" data-sync-project="${escapeHtml(project.id)}">Sync with current SBC</button>` : ""}${project.id ? `<button class="action danger" data-remove-project="${escapeHtml(project.id)}">Remove</button>` : ""}</div>${project.sourceSetId ? `<div class="hint">Source set ${escapeHtml(project.sourceSetId)} · ${escapeHtml((project.sourceChallengeIds || []).length)} mapped challenges</div>` : ""}</section>`;
  var parseReserveMap = (value) => Object.fromEntries(
    splitList(value).map((entry) => entry.split(":").map((part) => part.trim())).filter(([rating, count]) => Number.isInteger(Number(rating)) && Number(count) > 0).map(([rating, count]) => [String(Number(rating)), Math.trunc(Number(count))])
  );
  var readProjectEditor = (card, existing = null) => {
    const field = (name) => card.querySelector(`[data-project-field="${name}"]`);
    const ratingRequirements = [...card.querySelectorAll("[data-rating-row]")].map((row) => ({
      rating: Number(row.querySelector('[data-rating="rating"]')?.value || 0),
      count: Number(row.querySelector('[data-rating="count"]')?.value || 1),
      completed: Number(row.querySelector('[data-rating="completed"]')?.value || 0)
    }));
    const specialCardRequirements = [...card.querySelectorAll("[data-special-row]")].map((row) => ({
      cardType: row.querySelector('[data-special="cardType"]')?.value || "",
      count: Number(row.querySelector('[data-special="count"]')?.value || 1),
      completed: Number(row.querySelector('[data-special="completed"]')?.value || 0),
      perRemainingSquad: Boolean(row.querySelector('[data-special="perRemainingSquad"]')?.checked)
    }));
    return {
      ...existing || {},
      id: card.dataset.projectId || void 0,
      name: field("name")?.value || "",
      active: Boolean(field("active")?.checked),
      priority: Number(field("priority")?.value || 0),
      requiredSquadsRemaining: Number(field("requiredSquadsRemaining")?.value || 0),
      ratingRequirements,
      specialCardRequirements,
      protectedRatings: {
        atOrAbove: field("atOrAbove")?.value ? Number(field("atOrAbove").value) : null,
        exact: splitList(field("exact")?.value).map(Number),
        reserveByRating: parseReserveMap(field("reserveByRating")?.value)
      },
      protectedPlayerIds: splitList(field("protectedPlayerIds")?.value),
      protectedResourceIds: splitList(field("protectedResourceIds")?.value),
      completionProgress: Number(field("completionProgress")?.value || 0)
    };
  };
  var GrindPanel = class {
    constructor(runtime, { legacyOnly = true } = {}) {
      this.runtime = runtime;
      this.legacyOnly = legacyOnly;
      this.host = document.createElement("grindpilot-panel");
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.state = runtime.getState();
      this.activeSection = "Easy Loop";
      this.previouslyFocused = null;
      this.renderShell();
      document.documentElement.appendChild(this.host);
      this.unsubscribe = runtime.subscribe((state) => {
        this.state = state;
        this.renderViews();
      });
      this.renderViews();
    }
    renderShell() {
      this.shadow.innerHTML = `<style>${css}</style><button class="launcher${this.legacyOnly ? " hidden" : ""}" aria-label="Open FUT Magic legacy tools">FM</button><section class="panel hidden" role="dialog" aria-modal="true" aria-labelledby="legacy-panel-brand legacy-panel-section"><aside><div class="brand" id="legacy-panel-brand">FUT Magic<small>ADVANCED · LEGACY TOOLS</small></div>${sections.map((name) => `<button class="nav${name === this.activeSection ? " active" : ""}" data-section="${name}"${name === this.activeSection ? ' aria-current="page"' : ""}>${name}</button>`).join("")}</aside><main class="main"><div class="top"><h2 id="legacy-panel-section"></h2><button class="close" aria-label="Close legacy tools">×</button></div><div class="content"></div></main></section>`;
      this.shadow.querySelector(".launcher").addEventListener("click", () => this.toggle(true));
      this.shadow.querySelector(".close").addEventListener("click", () => this.toggle(false));
      this.shadow.querySelector(".panel").addEventListener("keydown", (event) => this.handleDialogKeydown(event));
      this.shadow.querySelectorAll(".nav").forEach((node) => node.addEventListener("click", () => {
        this.activeSection = node.dataset.section;
        this.shadow.querySelectorAll(".nav").forEach((entry) => {
          entry.classList.toggle("active", entry === node);
          if (entry === node) entry.setAttribute("aria-current", "page");
          else entry.removeAttribute("aria-current");
        });
        this.renderViews();
      }));
    }
    handleDialogKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.toggle(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...this.shadow.querySelectorAll(
        ".panel button:not(:disabled),.panel input:not(:disabled),.panel select:not(:disabled),.panel textarea:not(:disabled),.panel summary,.panel a[href]"
      )].filter((node) => node.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && this.shadow.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && this.shadow.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    toggle(open) {
      const panel = this.shadow.querySelector(".panel");
      if (open && panel.classList.contains("hidden")) {
        this.previouslyFocused = document.activeElement;
      }
      panel.classList.toggle("hidden", !open);
      this.shadow.querySelector(".launcher").classList.toggle("hidden", this.legacyOnly || open);
      if (this.runtime.state.legacyPanelOpen !== open) {
        this.runtime.state.legacyPanelOpen = open;
        this.runtime.emit();
      }
      if (open) {
        this.runtime.refreshStatus?.();
        queueMicrotask(() => this.shadow.querySelector(".close")?.focus());
      } else {
        this.previouslyFocused?.focus?.();
        this.previouslyFocused = null;
      }
    }
    openSection(section = "Easy Loop") {
      if (sections.includes(section)) this.activeSection = section;
      this.shadow.querySelectorAll(".nav").forEach((entry) => {
        const active = entry.dataset.section === this.activeSection;
        entry.classList.toggle("active", active);
        if (active) entry.setAttribute("aria-current", "page");
        else entry.removeAttribute("aria-current");
      });
      this.renderViews();
      this.toggle(true);
    }
    banner() {
      const reason = this.state.pauseReason || this.state.error;
      if (reason) return `<div class="banner ${this.state.error ? "error" : "warn"}" role="${this.state.error ? "alert" : "status"}" aria-atomic="true">${escapeHtml(reason)}</div>`;
      return `<div class="banner">FUT Magic is ${escapeHtml(this.state.bridgeHealth === "healthy" ? "ready" : this.state.bridgeHealth || "checking")}</div>`;
    }
    renderViews() {
      const content = this.shadow.querySelector(".content");
      const previousFocusable = [...content.querySelectorAll(legacyFocusableSelector)];
      const previousFocusIndex = content.contains(this.shadow.activeElement) ? previousFocusable.indexOf(this.shadow.activeElement) : -1;
      const previousSelection = previousFocusIndex >= 0 && "selectionStart" in this.shadow.activeElement ? { start: this.shadow.activeElement.selectionStart, end: this.shadow.activeElement.selectionEnd } : null;
      this.shadow.querySelector(".top h2").textContent = this.activeSection;
      const render = this[`render${this.activeSection.replaceAll(" ", "")}`]?.bind(this) ?? (() => "");
      content.innerHTML = this.banner() + render();
      associateLegacyLabels(content);
      this.bindViewActions(content);
      if (previousFocusIndex >= 0) {
        queueMicrotask(() => {
          const nextFocusable = [...content.querySelectorAll(legacyFocusableSelector)];
          const target = nextFocusable[Math.min(previousFocusIndex, nextFocusable.length - 1)];
          target?.focus?.({ preventScroll: true });
          if (Number.isInteger(previousSelection?.start) && target && "setSelectionRange" in target) {
            target.setSelectionRange(previousSelection.start, previousSelection.end);
          }
        });
      }
    }
    renderEasyLoop() {
      const s = this.state;
      const count = Number(s.unassignedCount || 0);
      const runActive = !["idle", "completed", "stopped", "failed"].includes(String(s.runStatus || "idle"));
      const storageFull = Number(s.storageCount || 0) >= Number(s.storageCapacity || 100);
      const nextTitle = count > 0 ? `Organize ${count} item${count === 1 ? "" : "s"}` : "Open the next pack safely";
      const nextBody = count > 0 ? storageFull ? "SBC Storage is full. Every remaining card will be used directly in 10x85." : "Safe cards go to Club or SBC Storage. Anything left is recycled in 10x85." : "Open exactly one owned pack. Purchases are always blocked.";
      const icons = { completed: "✓", running: "→", waiting: "→", paused: "!", failed: "×", pending: "○" };
      const timeline = (s.timeline || []).map((entry) => `<span class="${entry.status === "completed" ? "done" : entry.active ? "active" : ""}">${icons[entry.status] || "○"} ${escapeHtml(entry.type.replaceAll("_", " "))}</span>`).join("");
      const analytics = s.analytics || {};
      const consumed = analytics.ratingFlow?.consumed || {};
      const received = analytics.ratingFlow?.received || {};
      return `<section class="easy-hero"><h3>${escapeHtml(nextTitle)}</h3><p>${escapeHtml(nextBody)}</p><div class="easy-status"><span>Storage ${escapeHtml(`${s.storageCount || 0}/${s.storageCapacity || 100}`)}</span><span>${escapeHtml(count)} unassigned</span><span>${escapeHtml(s.packsOpened || 0)} packs opened</span></div><div class="easy-actions"><button class="action ${count > 0 ? "primary" : ""}" data-action="recycle-cards"${count < 1 || runActive ? " disabled" : ""}>Route &amp; recycle</button><button class="action ${count < 1 ? "primary" : ""}" data-action="quick-open"${count > 0 || runActive ? " disabled" : ""}>Open one safely</button></div></section><div class="easy-steps"><div class="easy-step"><b>1 · Open safely</b><span>Open one owned pack.</span></div><div class="easy-step"><b>2 · Route &amp; recycle</b><span>Move safe cards and recycle leftovers.</span></div><div class="easy-step"><b>3 · Repeat</b><span>Continue until your target SBC is finished.</span></div></div>${timeline ? `<details><summary>Current run</summary><div class="timeline">${timeline}</div></details>` : ""}<details><summary>Run details</summary><div class="grid">${[
        ["Status", s.runStatus || "idle"],
        ["Step", s.currentStep || "—"],
        ["Iterations", `${s.iterations || 0}/${s.maxIterations || 0}`],
        ["SBCs", s.sbcCompleted || 0],
        ["Packs", s.packsOpened || 0],
        ["Picks", s.picksCompleted || 0],
        ["Duplicates", s.duplicatesRecycled || 0],
        ["Storage", `${s.storageCount || 0}/${s.storageCapacity || "?"}`],
        ["Unassigned", s.unassignedCount || 0],
        ["Protected saved", s.protectedCardsSaved || 0]
      ].map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(value)}</div></div>`).join("")}</div><div class="card"><b>Per-run analytics</b><div class="hint">Duration: ${Math.round(Number(analytics.durationMs || 0) / 1e3)}s · Pauses: ${analytics.pauses || 0} · Solver failures: ${analytics.solverFailures || 0}</div><div class="hint">Rating flow: ${consumed.cards || 0} cards / ${consumed.ratingPoints || 0} pts consumed → ${received.cards || 0} cards / ${received.ratingPoints || 0} pts received</div></div></details><div class="controls">${runActive ? `<button class="action" data-action="pause">Pause</button><button class="action primary" data-action="resume">Resume</button><button class="action danger" data-action="stop">Stop</button>` : ""}<button class="action" data-action="refresh">Refresh</button></div>`;
    }
    renderDashboard() {
      return this.renderEasyLoop();
    }
    renderSBCSolver() {
      return `<div class="card"><p>The proven local AutoPilot solver remains the production engine.</p><p class="hint">Solve Squad, Multi Solve and Solve Entire Set remain available in their existing SBC surfaces while FUT Magic adds persistent runs and protection.</p><button class="action" data-action="legacy-sequence">Open legacy sequence planner</button></div>`;
    }
    renderWorkflows() {
      const cfg = this.state.draft || {};
      const templates = this.state.workflowTemplates || [];
      const legacy = this.state.legacySequences || [];
      const workflow = this.state.workflowDraft || { steps: [] };
      return `<div class="form"><div class="field"><label>Mode</label><select data-field="mode"><option${selected2(cfg.mode, "REVIEW")}>REVIEW</option><option${selected2(cfg.mode, "ASSISTED")}>ASSISTED</option><option${selected2(cfg.mode, "AUTO")}>AUTO</option></select></div><div class="field"><label>Iterations (hard limit)</label><input data-field="maxIterations" type="number" min="1" max="1000" value="${escapeHtml(cfg.maxIterations || 1)}"></div><div class="field"><label>Template</label><select data-template-select>${templates.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}</select></div><div class="field"><label>Player pick policy</label><select data-field="pickMode"><option${selected2(cfg.pickMode, "PAUSE_FOR_USER")}>PAUSE_FOR_USER</option><option${selected2(cfg.pickMode, "HIGHEST_RATING")}>HIGHEST_RATING</option><option${selected2(cfg.pickMode, "HIGHEST_VALUE")}>HIGHEST_VALUE</option><option${selected2(cfg.pickMode, "PREFER_NON_DUPLICATE")}>PREFER_NON_DUPLICATE</option><option${selected2(cfg.pickMode, "PREFER_REQUIRED_SPECIAL")}>PREFER_REQUIRED_SPECIAL</option><option${selected2(cfg.pickMode, "CUSTOM_PRIORITY")}>CUSTOM_PRIORITY</option></select></div><div class="field"><label>Custom priority criteria</label><input data-field="pickCriteria" value="${escapeHtml((cfg.pickPolicy?.criteria || []).join(", "))}" placeholder="NON_DUPLICATE, REQUIRED_SPECIAL, RATING, VALUE"></div><div class="field"><label>Reward packs</label><select data-field="packMode"><option${selected2(cfg.packMode, "OPEN_CURRENT_REWARD")}>OPEN_CURRENT_REWARD</option><option${selected2(cfg.packMode, "OPEN_MATCHING_PACKS")}>OPEN_MATCHING_PACKS</option><option${selected2(cfg.packMode, "OPEN_ALL_ALLOWED_PACKS")}>OPEN_ALL_ALLOWED_PACKS</option></select></div><div class="field"><label>Max packs per pack step</label><input data-field="maxPacks" type="number" min="1" max="100" value="${escapeHtml(cfg.maxPacks || 1)}"></div></div><div class="controls"><button class="action" data-action="apply-template">Use template</button><button class="action" data-wf-add="${encodePath([])}">Add Step</button><button class="action" data-action="save-workflow">Save workflow</button><button class="action primary" data-action="start">Start workflow</button></div><div class="section-title">${escapeHtml(workflow.name || "Workflow")} · ordered typed steps</div>${renderWorkflowSteps(workflow.steps, [])}<div class="section-title">Legacy Sequence migration</div><div class="controls"><button class="action" data-action="refresh-legacy">Find legacy plans</button><select aria-label="Legacy sequence plan" data-legacy-select>${legacy.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select><button class="action" data-action="import-legacy">Import Legacy Sequence</button></div><p class="hint">Specific set/challenge targets are verified by stable EA IDs. FUT Magic pauses and asks you to open the target when safe controller navigation is unavailable.</p>`;
    }
    renderProfiles() {
      return `<div class="controls"><button class="action" data-action="save-profile">Save current profile</button><button class="action" data-action="export-profile">Export</button><button class="action" data-import-profile-trigger>Import</button><input class="sr-only" aria-label="Choose a FUT Magic profile to import" data-action="import-profile" type="file" accept="application/json"></div>${(this.state.profiles || []).length ? (this.state.profiles || []).map((p) => `<div class="card"><b>${escapeHtml(p.name)}</b><div class="hint">${escapeHtml(p.id)}</div><button class="action" data-load-profile="${escapeHtml(p.id)}">Load</button></div>`).join("") : '<div class="empty">No saved grind profiles yet.</div>'}`;
    }
    renderInventory() {
      const i = this.state.inventory || {};
      const buckets = this.state.inventoryBuckets || {};
      const cfg = this.state.draft || {};
      const targets = (this.state.projects || []).filter((project) => project.active !== false && project.sourceSetId && project.completionProgress < 1);
      return `<div class="grid"><div class="card"><div class="label">Club</div><div class="metric">${i.clubCount || 0}</div></div><div class="card"><div class="label">SBC Storage</div><div class="metric">${i.storageCount || 0}</div></div><div class="card"><div class="label">Free slots</div><div class="metric">${i.storageFreeSlots ?? "?"}</div></div><div class="card"><div class="label">Unassigned</div><div class="metric">${i.unassignedCount || 0}</div></div></div><div class="card"><div class="field"><label>Fallback recycling project</label><select data-organizer-target><option value="">Auto: 85x10, otherwise highest priority</option>${targets.map((project) => `<option value="${escapeHtml(project.id)}"${selected2(String(cfg.organizerTargetProjectId || ""), String(project.id))}>${escapeHtml(project.name)}</option>`).join("")}</select></div><div class="controls"><button class="action" data-action="save-organizer">Save target</button><button class="action" data-action="quick-open"${Number(i.unassignedCount || 0) > 0 ? " disabled" : ""}>Open safely</button><button class="action primary" data-action="recycle-cards"${Number(i.unassignedCount || 0) < 1 ? " disabled" : ""}>Route &amp; recycle</button><button class="action" data-action="inventory">Synchronize</button></div><p class="hint">Normal cards go to Club. Duplicates use only verified free SBC Storage slots. If Storage is full, every remaining card becomes mandatory in the selected SBC; if that exact squad is impossible, no submit occurs.</p></div><table class="bucket-table"><caption class="sr-only">Inventory rating buckets</caption><thead><tr><th scope="col">Rating</th><th scope="col">Club</th><th scope="col">Storage</th><th scope="col">Unassigned</th></tr></thead><tbody>${Object.entries(buckets).map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value.club}</td><td>${value.storage}</td><td>${value.unassigned}</td></tr>`).join("")}</tbody></table>`;
    }
    renderProtectedCards() {
      const cfg = this.state.draft || {};
      return `<div class="form"><div class="field"><label>Hard protect rating at/above</label><input data-protection="protectRatingAtOrAbove" type="number" min="1" max="99" value="${escapeHtml(cfg.protectRatingAtOrAbove ?? "")}"></div><div class="field"><label>Hard exact ratings</label><input data-protection="protectedRatings" value="${escapeHtml((cfg.protectedRatings || []).join(", "))}"></div><div class="field"><label>Protected owned item IDs</label><input data-protection="protectedItemIds" value="${escapeHtml((cfg.protectedItemIds || []).join(", "))}"></div><div class="field"><label>Protected player IDs</label><input data-protection="protectedPlayerIds" value="${escapeHtml((cfg.protectedPlayerIds || []).join(", "))}"></div><div class="field"><label>Protected resource IDs</label><input data-protection="protectedResourceIds" value="${escapeHtml((cfg.protectedResourceIds || []).join(", "))}"></div><div class="field"><label>Forbidden special types</label><input data-protection="protectedCardTypes" value="${escapeHtml((cfg.protectedCardTypes || []).join(", "))}"></div><div class="field"><label>Soft rating reserves (89:3, 90:2)</label><input data-protection="minimumReserveByRating" value="${escapeHtml(Object.entries(cfg.minimumReserveByRating || {}).map(([r, c]) => `${r}:${c}`).join(", "))}"></div><div class="field"><label><input data-protection="protectStartingSquad" type="checkbox" checked disabled> Active squad is always protected</label><label><input data-protection="protectFavorites" type="checkbox"${checked(cfg.protectFavorites)}> Protect favourites</label><label><input data-protection="preferDuplicates" type="checkbox"${checked(cfg.preferDuplicates)}> Prefer duplicates</label><label><input data-protection="preferSbcStorage" type="checkbox"${checked(cfg.preferSbcStorage)}> Prefer SBC Storage</label><label><input data-protection="preferUntradeables" type="checkbox"${checked(cfg.preferUntradeables)}> Prefer untradeables</label></div></div><div class="controls"><button class="action primary" data-action="save-protection">Save protection policy</button></div><p class="hint">Active-squad cards are an unconditional hard exclusion. All hard protection is rechecked immediately before submit. Rating/special reserves and Target Project demand are soft conservation objectives.</p>`;
    }
    renderTargetProjects() {
      const projects = this.state.projects || [];
      const dashboard = this.state.targetDashboard || [];
      return `<div class="controls"><button class="action primary" data-action="new-project">New Target Project</button><button class="action" data-action="import-current-sbc">Import current SBC as Target Project</button></div>${dashboard.map((entry) => `<div class="card"><b>Target: ${escapeHtml(entry.name)}</b><div class="hint">Progress: ${escapeHtml(entry.completedSquads)} / ${escapeHtml(entry.totalSquads)} squads completed · ${escapeHtml(entry.requiredSquadsRemaining)} remaining</div><div class="hint">Remaining ratings: ${entry.remainingRatings.map((r) => `${r.rating}: ${r.remaining}${r.covered ? " ✓" : " missing"}`).join(" · ") || "unknown"}</div><div class="hint">Required specials: ${entry.remainingSpecials.map((r) => `${escapeHtml(r.cardType.toUpperCase())}: ${r.remaining}`).join(" · ") || "none verified"}</div><div class="hint">Protection: ${escapeHtml(entry.protectedRatings.atOrAbove ? `${entry.protectedRatings.atOrAbove}+ hard protected` : "configured IDs/reserves")}</div></div>`).join("")}${renderProjectEditor({ active: true, priority: 50, requiredSquadsRemaining: 0, protectedRatings: { exact: [], reserveByRating: {} }, ratingRequirements: [], specialCardRequirements: [], completionProgress: 0 })}${projects.map(renderProjectEditor).join("")}`;
    }
    renderActivity() {
      const logs = (this.state.logs || []).slice(-200).reverse();
      const details = this.state.solveDetails;
      return `${details ? `<div class="card"><b>Solve Details</b>${(details.explanations || []).map((line) => `<div class="hint">${escapeHtml(line)}</div>`).join("")}<div class="hint">Objective: ${escapeHtml((details.objectiveTuple || []).join(" / "))}</div></div>` : ""}${logs.length ? logs.map((e) => `<div class="log"><span class="muted">${escapeHtml((e.timestamp || "").slice(11, 19))}</span><b>${escapeHtml(e.action)}</b><span>${escapeHtml(e.message)}</span></div>`).join("") : '<div class="empty">No activity yet.</div>'}`;
    }
    renderSettings() {
      return `<div class="card"><b>Safety defaults</b><p class="hint">No pack purchases, no market automation, no credential persistence, no automatic quicksell. Ambiguous EA state always pauses.</p></div>`;
    }
    renderDeveloper() {
      const d = this.state.diagnostics || {};
      const health = this.state.capabilityHealth || [];
      return `<div class="form"><div class="field"><label><input data-field="developerMode" type="checkbox" ${d.enabled ? "checked" : ""}> Developer Mode</label></div></div><div class="section-title">Capability Health</div>${health.map((entry) => `<div class="health"><b>${escapeHtml(entry.id)}</b><span>${escapeHtml(entry.status)}</span><span class="hint">${escapeHtml(JSON.stringify(entry.evidence || {}))}</span></div>`).join("") || '<div class="empty">Refresh to inspect safe capabilities.</div>'}<div class="controls"><button class="action" data-action="refresh">Refresh health</button><button class="action" data-action="diagnostic-snapshot">Take snapshot</button><button class="action" data-action="diagnostic-export">Export diagnostics</button></div><label class="sr-only" for="fut-magic-diagnostics-output">Latest redacted diagnostic snapshot</label><textarea id="fut-magic-diagnostics-output" readonly>${escapeHtml(JSON.stringify(d.latest || d, null, 2))}</textarea><p class="hint">Instrumentation remains dormant while Developer Mode is disabled. Export is redacted and excludes request bodies, headers and credentials. UNVERIFIED means capability presence was observed without dispatching a destructive operation.</p>`;
    }
    readDraft(root) {
      const get = (name) => root.querySelector(`[data-field="${name}"]`);
      const pickMode = get("pickMode")?.value || "PAUSE_FOR_USER";
      return { ...this.state.draft || {}, mode: get("mode")?.value || "REVIEW", maxIterations: Number(get("maxIterations")?.value || 1), storageCapacity: Number(get("storageCapacity")?.value || this.state.storageCapacity || 100), packMode: get("packMode")?.value || "OPEN_CURRENT_REWARD", maxPacks: Number(get("maxPacks")?.value || 1), pickMode, pickPolicy: { ...this.state.draft?.pickPolicy || {}, type: pickMode, criteria: splitList(get("pickCriteria")?.value) }, workflow: this.state.workflowDraft || this.state.draft?.workflow };
    }
    bindViewActions(root) {
      root.querySelector("[data-import-profile-trigger]")?.addEventListener("click", () => root.querySelector('[data-action="import-profile"]')?.click());
      root.querySelectorAll("[data-action]").forEach((node) => node.addEventListener(node.tagName === "INPUT" ? "change" : "click", async () => {
        const action = node.dataset.action;
        try {
          if (action === "start") await this.runtime.start(this.readDraft(root));
          else if (action === "pause") await this.runtime.pause();
          else if (action === "resume") await this.runtime.resume();
          else if (action === "stop") await this.runtime.stop();
          else if (action === "refresh") await this.runtime.refreshStatus();
          else if (action === "inventory") await this.runtime.refreshInventory();
          else if (action === "recycle-cards") await this.runtime.recycleCards();
          else if (action === "quick-open") await this.runtime.quickOpenPack();
          else if (action === "save-organizer") await this.runtime.saveOrganizerSettings(root.querySelector("[data-organizer-target]")?.value || null);
          else if (action === "legacy-sequence") globalThis.window?.eaData?.openSequencePlanner?.();
          else if (action === "save-profile") await this.runtime.saveDraftProfile();
          else if (action === "export-profile") downloadJson("grindpilot-profile.json", await this.runtime.exportCurrentProfile());
          else if (action === "import-profile") {
            const file = node.files?.[0];
            if (file) await this.runtime.importProfile(await file.text());
          } else if (action === "diagnostic-snapshot") await this.runtime.takeDiagnosticSnapshot();
          else if (action === "diagnostic-export") downloadJson("grindpilot-diagnostics.json", await this.runtime.exportDiagnostics());
          else if (action === "export-analytics") downloadJson("grindpilot-run-analytics.json", this.runtime.exportRunAnalytics());
          else if (action === "apply-template") this.runtime.useWorkflowTemplate(root.querySelector("[data-template-select]")?.value);
          else if (action === "save-workflow") this.runtime.saveWorkflowDraft();
          else if (action === "refresh-legacy") await this.runtime.refreshLegacySequences();
          else if (action === "import-legacy") await this.runtime.importLegacySequencePlan(root.querySelector("[data-legacy-select]")?.value);
          else if (action === "import-current-sbc") await this.runtime.importCurrentSbcProject();
          else if (action === "new-project") root.querySelector('.project-editor[data-project-id=""] [data-project-field="name"]')?.focus();
          else if (action === "save-protection") {
            const value = (name) => root.querySelector(`[data-protection="${name}"]`);
            await this.runtime.saveProtectionSettings({
              protectRatingAtOrAbove: value("protectRatingAtOrAbove")?.value ? Number(value("protectRatingAtOrAbove").value) : null,
              protectedRatings: splitList(value("protectedRatings")?.value).map(Number),
              protectedItemIds: splitList(value("protectedItemIds")?.value),
              protectedPlayerIds: splitList(value("protectedPlayerIds")?.value),
              protectedResourceIds: splitList(value("protectedResourceIds")?.value),
              protectedCardTypes: splitList(value("protectedCardTypes")?.value),
              minimumReserveByRating: parseReserveMap(value("minimumReserveByRating")?.value),
              protectStartingSquad: Boolean(value("protectStartingSquad")?.checked),
              protectFavorites: Boolean(value("protectFavorites")?.checked),
              preferDuplicates: Boolean(value("preferDuplicates")?.checked),
              preferSbcStorage: Boolean(value("preferSbcStorage")?.checked),
              preferUntradeables: Boolean(value("preferUntradeables")?.checked)
            });
          }
        } catch (error) {
          this.runtime.reportUiError(error);
        }
      }));
      root.querySelectorAll("[data-load-profile]").forEach((node) => node.addEventListener("click", () => this.runtime.loadProfile(node.dataset.loadProfile)));
      root.querySelectorAll("[data-remove-project]").forEach((node) => node.addEventListener("click", () => this.runtime.removeTargetProject(node.dataset.removeProject)));
      root.querySelectorAll("[data-sync-project]").forEach((node) => node.addEventListener("click", () => this.runtime.syncTargetProject(node.dataset.syncProject).catch((error) => this.runtime.reportUiError(error))));
      root.querySelectorAll("[data-add-rating-row]").forEach((node) => node.addEventListener("click", () => node.parentElement.querySelector("[data-rating-rows]")?.insertAdjacentHTML("beforeend", ratingRequirementRows([{ rating: 90, count: 1, completed: 0 }]))));
      root.querySelectorAll("[data-add-special-row]").forEach((node) => node.addEventListener("click", () => node.parentElement.querySelector("[data-special-rows]")?.insertAdjacentHTML("beforeend", specialRequirementRows([{ cardType: "totw", count: 1, completed: 0, perRemainingSquad: false }]))));
      root.querySelectorAll("[data-remove-row]").forEach((node) => node.addEventListener("click", () => node.closest(".requirement-row")?.remove()));
      root.querySelectorAll("[data-save-project]").forEach((node) => node.addEventListener("click", async () => {
        try {
          const card = node.closest(".project-editor");
          const existing = (this.state.projects || []).find((project) => project.id === card.dataset.projectId) || null;
          await this.runtime.saveTargetProject(readProjectEditor(card, existing));
        } catch (error) {
          this.runtime.reportUiError(error);
        }
      }));
      root.querySelectorAll("[data-wf-add]").forEach((node) => node.addEventListener("click", () => this.runtime.addWorkflowBuilderStep(decodePath(node.dataset.wfAdd))));
      root.querySelectorAll("[data-wf-action]").forEach((node) => node.addEventListener("click", () => {
        const path = decodePath(node.dataset.wfPath);
        const index = Number(node.dataset.wfIndex);
        if (node.dataset.wfAction === "delete") this.runtime.deleteWorkflowBuilderStep(path, index);
        else if (node.dataset.wfAction === "duplicate") this.runtime.duplicateWorkflowBuilderStep(path, index);
        else this.runtime.moveWorkflowBuilderStep(path, index, node.dataset.wfAction === "up" ? -1 : 1);
      }));
      root.querySelectorAll("[data-wf-field]").forEach((node) => node.addEventListener("change", () => {
        const path = decodePath(node.dataset.wfPath);
        const index = Number(node.dataset.wfIndex);
        const card = node.closest(".workflow-step");
        const read = (name) => card.querySelector(`[data-wf-field="${name}"]`);
        const type = read("type")?.value;
        if (node.dataset.wfField === "type") {
          this.runtime.updateWorkflowBuilderStep(path, index, { type });
          return;
        }
        const patch = {
          timeoutMs: Number(read("timeoutMs")?.value || 12e4),
          onFailure: read("onFailure")?.value || "PAUSE",
          retryPolicy: { maxAttempts: Number(read("retryAttempts")?.value || 1) },
          config: {}
        };
        if (type === "SOLVE_SBC") patch.config.target = { kind: read("targetKind")?.value || "CURRENT_OPEN_SBC", setId: read("setId")?.value || null, challengeId: read("challengeId")?.value || null };
        else if (type === "LOOP") patch.config.maxIterations = Number(read("loopIterations")?.value || 1);
        else if (type === "DELAY") patch.config.durationMs = Number(read("durationMs")?.value || 0);
        else if (type === "PAUSE") patch.config.reason = read("pauseReason")?.value || "Workflow pause";
        else if (type === "CONDITIONAL") patch.config.condition = { type: "COMPARE", left: { type: "PATH", path: read("conditionPath")?.value || "unresolvedUnassigned" }, operator: read("conditionOperator")?.value || "EQ", right: { type: "LITERAL", value: Number.isNaN(Number(read("conditionValue")?.value)) ? read("conditionValue")?.value : Number(read("conditionValue")?.value) } };
        this.runtime.updateWorkflowBuilderStep(path, index, patch);
      }));
      root.addEventListener("click", (event) => {
        const remove = event.target.closest?.("[data-remove-row]");
        if (remove) remove.closest(".requirement-row")?.remove();
      });
      const dev = root.querySelector('[data-field="developerMode"]');
      if (dev) dev.addEventListener("change", () => this.runtime.setDeveloperMode(dev.checked));
    }
    dispose() {
      this.unsubscribe?.();
      this.host.remove();
    }
  };

  // src/ui/ea-surface-actions.js
  var normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  var isIdleStatus = (status) => ["idle", "completed", "stopped", "failed"].includes(String(status || "idle"));
  var surfaceCss = `
.grindpilot-pack-action-row{display:flex!important;align-items:stretch!important;gap:8px!important;width:100%!important;max-width:640px!important;margin-inline:auto!important}
.grindpilot-pack-action-row>.grindpilot-native-open-peer,
.grindpilot-pack-action-row>.grindpilot-quick-open-native{flex:1 1 0!important;width:auto!important;min-width:0!important;margin-left:0!important;margin-right:0!important}
.fut-magic-contextual{
  --fm-bg-primary:#0B1020;
  --fm-bg-secondary:#121A2E;
  --fm-bg-elevated:#1E2B4D;
  --fm-text-primary:#E6EDF5;
  --fm-text-secondary:#A7B2C9;
  --fm-text-on-accent:#07121B;
  --fm-accent-primary:#00E6FF;
  --fm-accent-secondary:#26FFC2;
  --fm-destructive:#FF7185;
  --fm-border-subtle:rgb(167 178 201 / 16%);
  --fm-border-strong:rgb(0 230 255 / 42%);
  --fm-focus-ring:#6AEEFF;
  --fm-radius-sm:0.5rem;
  --fm-control-min-size:2.75rem;
  position:relative!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  gap:7px!important;
  min-height:var(--fm-control-min-size)!important;
  overflow:hidden!important;
  border:1px solid var(--fm-border-subtle)!important;
  border-radius:var(--fm-radius-sm)!important;
  background:var(--fm-bg-secondary)!important;
  color:var(--fm-text-primary)!important;
  box-shadow:none!important;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
  font-size:13px!important;
  font-weight:600!important;
  line-height:1.2!important;
  letter-spacing:0!important;
  text-transform:none!important;
  cursor:pointer!important;
  touch-action:manipulation!important;
  transition:transform 80ms ease-out,background-color 120ms ease-out,border-color 120ms ease-out,color 120ms ease-out!important;
}
.fm-context-icon{display:block;width:15px;height:15px;flex:0 0 15px;color:var(--fm-accent-primary)}
.fm-context-icon .secondary{color:var(--fm-accent-secondary)}
.fut-magic-contextual:hover{background:var(--fm-bg-elevated)!important;border-color:var(--fm-border-strong)!important}
.fut-magic-contextual:active{transform:scale(.975)!important;transition-duration:60ms!important}
.fut-magic-contextual:focus-visible{outline:2px solid var(--fm-focus-ring)!important;outline-offset:2px!important}
.fut-magic-contextual[aria-busy="true"],.fut-magic-contextual:disabled{cursor:not-allowed!important;opacity:.68!important;transform:none!important}
.grindpilot-quick-open-native{border-color:rgba(0,230,255,.38)!important}
.grindpilot-organize-native{width:auto!important;min-width:104px!important;padding-left:12px!important;padding-right:12px!important;margin-left:auto!important;margin-right:8px!important;white-space:nowrap!important}
.grindpilot-organize-native::before{background:var(--fm-accent-secondary)}
.fut-magic-open-panel-native{width:auto!important;min-width:108px!important;padding-left:12px!important;padding-right:12px!important;white-space:nowrap!important;background:transparent!important}
@media(prefers-reduced-motion:reduce){.fut-magic-contextual{transition:color 100ms ease-out,background-color 100ms ease-out!important;transform:none!important}}
@media(prefers-reduced-transparency:reduce){.fut-magic-contextual{background:var(--fm-bg-secondary)!important}}
@media(prefers-contrast:more){.fut-magic-contextual{border-color:var(--fm-text-primary)!important}.fut-magic-contextual:focus-visible{outline-width:3px!important}}
@media(forced-colors:active){.fut-magic-contextual{border:1px solid ButtonText!important;background:ButtonFace!important;color:ButtonText!important}.fm-context-icon{color:Highlight!important}.fut-magic-contextual:focus-visible{outline-color:Highlight!important}}
`;
  var contextualIcons = Object.freeze({
    spark: '<svg class="fm-context-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.5c0 3-1.5 4.5-4.5 4.5C6.5 6 8 7.5 8 10.5 8 7.5 9.5 6 12.5 6 9.5 6 8 4.5 8 1.5Z" fill="currentColor"/></svg>',
    route: '<svg class="fm-context-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 4h5a3 3 0 0 1 3 3v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path class="secondary" d="m7.8 9.4 2.7 2.7 2.7-2.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    brand: '<svg class="fm-context-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m8.5 23-2-14 13.5-3-1 4-8 1.8 1 8.6c4 .3 7.9-1 10.7-3.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><path class="secondary" d="M6.5 24.5c6.8 1.7 14.4.1 19.4-5.8m-2.8-.7 3.1.1-.6 3" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  });
  var setVisibleLabel = (button, label) => {
    const node = button.querySelector(".fm-context-label");
    if (node && node.textContent !== label) node.textContent = label;
  };
  var createNativePeer = (peer, { className, label, title, icon }) => {
    const button = (peer?.ownerDocument || document).createElement("button");
    button.type = "button";
    button.className = `${peer?.className || ""} fut-magic-contextual ${className}`.trim();
    if (contextualIcons[icon]) button.insertAdjacentHTML("beforeend", contextualIcons[icon]);
    const labelNode = button.ownerDocument.createElement("span");
    labelNode.className = "fm-context-label";
    labelNode.textContent = label;
    button.appendChild(labelNode);
    button.setAttribute("aria-label", label);
    button.title = title;
    return button;
  };
  var findPackCard = (openButton) => {
    const preferred = openButton.closest?.([
      ".ut-store-pack-details-view",
      ".ut-store-pack-item-view",
      ".ut-pack-item-view",
      "[data-pack-id]",
      "li"
    ].join(","));
    if (preferred && !preferred.closest("grindpilot-panel")) return preferred;
    let current = openButton.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (current.closest?.("grindpilot-panel")) return null;
      const hasTitle = current.querySelector?.("h1,h2,h3,h4,[class*='pack'][class*='name']");
      const hasPackVisual = current.querySelector?.("img,[class*='pack'][class*='image']");
      if (hasTitle && hasPackVisual) return current;
    }
    return null;
  };
  var readPackName = (card) => {
    const title = card?.querySelector?.([
      "[data-pack-name]",
      "[class*='pack'][class*='name']",
      "h1",
      "h2",
      "h3",
      "h4"
    ].join(","));
    return String(title?.getAttribute?.("data-pack-name") || title?.textContent || "").trim();
  };
  var findItemsMenu = (root) => {
    const headings = [...root.querySelectorAll("h1,h2,h3,h4,[role='heading']")].filter((node) => {
      if (node.closest("grindpilot-panel")) return false;
      return ["items", "duplicates", "unassigned"].includes(normalizeText(node.textContent));
    });
    for (const heading of headings) {
      let container = heading.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const buttons = [...container.querySelectorAll(":scope > button, :scope > * > button")].filter((button) => !button.classList.contains("grindpilot-organize-native"));
        const menu = buttons.find((button) => {
          const label = normalizeText(
            button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent
          );
          return /more|menu|option/.test(label) || label.length <= 2;
        });
        if (menu) return menu;
        if (container.matches?.("main,[role='main']")) break;
      }
    }
    return null;
  };
  var EaSurfaceActions = class {
    constructor(runtime, {
      root = globalThis.document,
      MutationObserver = globalThis.MutationObserver
    } = {}) {
      this.runtime = runtime;
      this.root = root;
      this.state = runtime.getState();
      this.syncQueued = false;
      this.packRefreshToken = 0;
      this.organizeSurface = null;
      this.organizeRefreshToken = 0;
      this.organizeRefreshTimer = null;
      this.organizeInventoryRefreshing = false;
      this.unsubscribe = runtime.subscribe((state) => {
        this.state = state;
        this.scheduleSync();
      });
      this.installStyles();
      this.observer = MutationObserver ? new MutationObserver((records) => {
        const relevant = records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1));
        if (relevant) this.scheduleSync();
      }) : null;
      this.observer?.observe(root.documentElement || root, { childList: true, subtree: true });
      this.scheduleSync();
    }
    installStyles() {
      if (this.root.getElementById("grindpilot-ea-surface-styles")) return;
      const style = this.root.createElement("style");
      style.id = "grindpilot-ea-surface-styles";
      style.textContent = surfaceCss;
      (this.root.head || this.root.documentElement)?.appendChild(style);
    }
    scheduleSync() {
      if (this.syncQueued) return;
      this.syncQueued = true;
      const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
      schedule(() => {
        this.syncQueued = false;
        this.sync();
      });
    }
    sync() {
      this.mountQuickOpenButtons();
      this.mountOrganizeButton();
      this.mountOpenPanelButton();
      void this.refreshPackBindings();
    }
    mountQuickOpenButtons() {
      const openButtons = [...this.root.querySelectorAll("button")].filter(
        (button) => !button.closest("grindpilot-panel") && !button.classList.contains("grindpilot-quick-open-native") && normalizeText(button.textContent) === "open"
      );
      for (const openButton of openButtons) {
        const card = findPackCard(openButton);
        const row = openButton.parentElement;
        if (!card || !row || row.querySelector(":scope > .grindpilot-quick-open-native")) continue;
        const packName = readPackName(card);
        if (!packName) continue;
        row.classList.add("grindpilot-pack-action-row");
        openButton.classList.add("grindpilot-native-open-peer");
        const quickOpen = createNativePeer(openButton, {
          className: "grindpilot-quick-open-native",
          label: "Open safely",
          title: `Open owned ${packName} safely with FUT Magic`,
          icon: "spark"
        });
        quickOpen.dataset.packName = packName;
        quickOpen.disabled = true;
        quickOpen.setAttribute("aria-label", "Open safely with FUT Magic unavailable: checking owned pack");
        quickOpen.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const packId2 = quickOpen.dataset.packId;
          if (!packId2 || quickOpen.disabled) return;
          quickOpen.disabled = true;
          try {
            quickOpen.setAttribute("aria-busy", "true");
            await this.runtime.quickOpenPack({ packId: packId2 });
          } catch (error) {
            this.runtime.reportUiError(error);
          } finally {
            quickOpen.removeAttribute("aria-busy");
            this.scheduleSync();
          }
        });
        row.appendChild(quickOpen);
      }
    }
    async refreshPackBindings() {
      const token = ++this.packRefreshToken;
      const buttons = [...this.root.querySelectorAll(".grindpilot-quick-open-native")];
      if (!buttons.length) return;
      const ready = Number(this.state.unassignedCount || 0) === 0 && isIdleStatus(this.state.runStatus);
      for (const button of buttons) {
        button.disabled = true;
        const reason = Number(this.state.unassignedCount || 0) > 0 ? "resolve Unassigned items first" : !isIdleStatus(this.state.runStatus) ? "finish or stop the active run first" : "checking owned pack";
        button.setAttribute("aria-label", `Open safely with FUT Magic unavailable: ${reason}`);
      }
      if (!ready) return;
      let packs;
      try {
        packs = await this.runtime.listQuickOpenPacks();
      } catch {
        return;
      }
      if (token !== this.packRefreshToken) return;
      for (const button of buttons) {
        const visibleName = normalizeText(button.dataset.packName);
        const exact = packs.filter((pack) => normalizeText(pack.name || pack.packName || pack.type) === visibleName);
        const fuzzy = exact.length ? exact : packs.filter((pack) => {
          const ownedName = normalizeText(pack.name || pack.packName || pack.type);
          return ownedName && (visibleName.includes(ownedName) || ownedName.includes(visibleName));
        });
        const ids = [...new Set(fuzzy.map((pack) => String(pack.packId || pack.id || "")).filter(Boolean))];
        if (ids.length !== 1) {
          delete button.dataset.packId;
          button.title = `${button.dataset.packName}: owned pack could not be identified uniquely`;
          button.setAttribute("aria-label", "Open safely with FUT Magic unavailable: owned pack could not be identified uniquely");
          continue;
        }
        button.dataset.packId = ids[0];
        button.disabled = false;
        button.title = `Open owned ${button.dataset.packName} safely with FUT Magic`;
        button.setAttribute("aria-label", "Open safely with FUT Magic");
      }
    }
    mountOrganizeButton() {
      const menu = findItemsMenu(this.root);
      if (!menu?.parentElement) {
        this.organizeSurface = null;
        return;
      }
      const enteredSurface = this.organizeSurface !== menu.parentElement;
      this.organizeSurface = menu.parentElement;
      if (enteredSurface) this.queueOrganizeInventoryRefresh();
      if (this.root.querySelector(".grindpilot-organize-native")) {
        this.updateOrganizeButton();
        return;
      }
      const organize = createNativePeer(menu, {
        className: "grindpilot-organize-native",
        label: "Organize",
        title: "Organize with FUT Magic: move safe cards, then use remaining cards only in a verified SBC",
        icon: "route"
      });
      organize.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (organize.disabled) return;
        organize.disabled = true;
        try {
          organize.setAttribute("aria-busy", "true");
          await this.runtime.recycleCards();
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          organize.removeAttribute("aria-busy");
          this.scheduleSync();
        }
      });
      menu.parentElement.insertBefore(organize, menu);
      this.updateOrganizeButton();
    }
    queueOrganizeInventoryRefresh() {
      const token = ++this.organizeRefreshToken;
      if (this.organizeRefreshTimer != null) clearTimeout(this.organizeRefreshTimer);
      this.organizeInventoryRefreshing = true;
      this.updateOrganizeButton();
      this.organizeRefreshTimer = setTimeout(async () => {
        this.organizeRefreshTimer = null;
        try {
          await this.runtime.refreshInventory({ requireNewer: true });
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          if (token === this.organizeRefreshToken) {
            this.organizeInventoryRefreshing = false;
            this.scheduleSync();
          }
        }
      }, 120);
    }
    updateOrganizeButton() {
      const organize = this.root.querySelector(".grindpilot-organize-native");
      if (!organize) return;
      const count = Number(this.state.unassignedCount || 0);
      const runIdle = isIdleStatus(this.state.runStatus);
      const available = this.state.inventoryAvailable === true;
      const checking = this.organizeInventoryRefreshing;
      const label = checking ? "Organize · Checking…" : !available ? "Organize · Unavailable" : count < 1 ? "Organize · No items" : !runIdle ? "Organize · Run active" : `Organize (${count})`;
      setVisibleLabel(organize, label);
      organize.disabled = checking || !available || count < 1 || !runIdle;
      organize.toggleAttribute("aria-busy", checking);
      organize.setAttribute("aria-label", checking ? "Organize with FUT Magic unavailable: checking Unassigned items" : !available ? "Organize with FUT Magic unavailable: inventory could not be verified" : count < 1 ? "Organize with FUT Magic unavailable: no Unassigned items" : !runIdle ? "Organize with FUT Magic unavailable: finish or stop the active run first" : `Organize ${count} item${count === 1 ? "" : "s"} with FUT Magic`);
      organize.title = checking ? "Checking Unassigned items" : !available ? "Unassigned items could not be verified" : count > 0 && runIdle ? `Organize ${count} item${count === 1 ? "" : "s"} with FUT Magic: Club/Storage first, then only a verified SBC` : count < 1 ? "No Unassigned items" : "Finish or stop the active run first";
    }
    mountOpenPanelButton() {
      if (this.root.querySelector(".fut-magic-open-panel-native")) return;
      const menu = findItemsMenu(this.root);
      if (!menu?.parentElement) return;
      const open = createNativePeer(menu, {
        className: "fut-magic-open-panel-native",
        label: "Open FUT Magic",
        title: "Review this context in FUT Magic",
        icon: "brand"
      });
      open.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        open.disabled = true;
        open.setAttribute("aria-busy", "true");
        try {
          await this.runtime.openSidePanel();
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          if (open.isConnected) {
            open.disabled = false;
            open.removeAttribute("aria-busy");
          }
        }
      });
      menu.parentElement.insertBefore(open, menu);
    }
    dispose() {
      this.packRefreshToken += 1;
      this.organizeRefreshToken += 1;
      if (this.organizeRefreshTimer != null) clearTimeout(this.organizeRefreshTimer);
      this.observer?.disconnect();
      this.unsubscribe?.();
      this.root.querySelectorAll(".grindpilot-quick-open-native,.grindpilot-organize-native,.fut-magic-open-panel-native").forEach((node) => node.remove());
      this.root.getElementById("grindpilot-ea-surface-styles")?.remove();
    }
  };

  // src/ui/run-hud.js
  var css2 = `
:host{
  all:initial;
  color-scheme:dark;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --fm-bg-primary:#0B1020;
  --fm-bg-secondary:#121A2E;
  --fm-bg-elevated:#1E2B4D;
  --fm-bg-overlay:rgb(11 16 32 / 92%);
  --fm-text-primary:#E6EDF5;
  --fm-text-secondary:#A7B2C9;
  --fm-text-muted:#8793aa;
  --fm-text-on-accent:#07121B;
  --fm-accent-primary:#00E6FF;
  --fm-accent-secondary:#26FFC2;
  --fm-accent-violet:#7B61FF;
  --fm-positive:#26FFC2;
  --fm-warning:#FFCA67;
  --fm-destructive:#FF7185;
  --fm-border-subtle:rgb(167 178 201 / 16%);
  --fm-border-strong:rgb(0 230 255 / 42%);
  --fm-focus-ring:#6AEEFF;
  --fm-shadow-high:0 1rem 2.5rem rgb(2 6 18 / 42%);
  --fm-radius-sm:0.5rem;
  --fm-radius-md:0.75rem;
  --fm-radius-lg:1rem;
  --fm-radius-pill:999px;
  --fm-control-min-size:2.75rem;
  --fm-material-blur:18px;
}
*{box-sizing:border-box}
.hud{
  position:fixed;
  z-index:2147483598;
  right:12px;
  top:12px;
  width:min(312px,calc(100vw - 24px));
  padding:15px;
  overflow:hidden;
  color:var(--fm-text-primary);
  background:var(--fm-bg-overlay);
  -webkit-backdrop-filter:blur(var(--fm-material-blur)) saturate(125%);
  backdrop-filter:blur(var(--fm-material-blur)) saturate(125%);
  border:1px solid var(--fm-border-subtle);
  border-radius:var(--fm-radius-lg);
  box-shadow:var(--fm-shadow-high);
  opacity:1;
  transform:translateY(0);
  transition:opacity 160ms ease-out,transform 260ms cubic-bezier(.2,.8,.2,1);
}
.hidden{display:none}
.top,.row,.actions,.brand-lockup,.status,.guard-status,.top-actions{display:flex;align-items:center}
.top,.row{justify-content:space-between;gap:10px}
.top-actions{flex:0 0 auto;gap:7px}
.brand-lockup{min-width:0;gap:8px}
.brand-symbol{display:block;flex:0 0 auto;width:22px;height:22px;color:var(--fm-accent-primary)}
.brand-symbol .trajectory{color:var(--fm-accent-secondary)}
.brand-symbol .spark{color:var(--fm-text-primary)}
.brand{font-size:14px;font-weight:700;letter-spacing:-.015em;white-space:nowrap}
.status{flex:0 0 auto;gap:6px;color:var(--fm-text-secondary);font-size:11px;font-weight:600;line-height:16px}
.dot{width:7px;height:7px;border:1px solid currentColor;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px rgba(38,255,194,.08)}
.status.normal{color:var(--fm-positive)}
.status.elevated,.status.caution{color:var(--fm-warning)}
.status.paused{color:var(--fm-text-primary)}
.status.recovery{color:var(--fm-destructive)}
.title{min-width:0;margin-top:14px;font-size:15px;font-weight:700;line-height:20px;letter-spacing:-.012em}
.title>span:first-child{min-width:0;overflow-wrap:anywhere}
.meta,.eyebrow{color:var(--fm-text-secondary);font-size:12px;line-height:17px}
.title .meta{flex:0 0 auto;font-variant-numeric:tabular-nums}
.progress{height:4px;margin:10px 0 13px;overflow:hidden;background:var(--fm-bg-elevated);border-radius:var(--fm-radius-pill)}
.bar{height:100%;background:linear-gradient(90deg,var(--fm-accent-primary),var(--fm-accent-secondary));border-radius:inherit;transform-origin:left;transition:transform 280ms cubic-bezier(.2,.8,.2,1)}
.progress-copy{margin:9px 0 13px;font-variant-numeric:tabular-nums}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.025em}
.next{margin-top:2px;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.next+.meta{margin-top:2px;overflow-wrap:anywhere}
.guard{margin-top:12px;padding-top:11px;border-top:1px solid var(--fm-border-subtle)}
.guard-status{gap:6px;color:var(--fm-text-primary);font-size:12px;font-weight:600;line-height:17px}
.guard-mark{width:6px;height:6px;border-radius:2px;background:currentColor;transform:rotate(45deg)}
.guard-status.normal{color:var(--fm-text-secondary)}
.guard-status.elevated,.guard-status.caution{color:var(--fm-warning)}
.guard-status.paused{color:var(--fm-text-primary)}
.guard-status.recovery{color:var(--fm-destructive)}
.intervention{margin-top:10px;padding:9px 10px;border-left:2px solid currentColor;border-radius:0 8px 8px 0;background:rgba(242,196,109,.07);color:var(--fm-warning);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.intervention.recovery{background:rgba(255,126,135,.07);color:var(--fm-destructive)}
.intervention-title{display:block;margin-bottom:2px;color:var(--fm-text-primary);font-weight:600}
.actions{justify-content:flex-start;gap:7px;margin-top:13px;flex-wrap:wrap}
.button{
  flex:0 0 auto;
  min-width:var(--fm-control-min-size);
  min-height:var(--fm-control-min-size);
  padding:0 12px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  border:1px solid var(--fm-border-subtle);
  border-radius:var(--fm-radius-md);
  background:var(--fm-bg-secondary);
  color:var(--fm-text-primary);
  font:600 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  cursor:pointer;
  touch-action:manipulation;
  transition:transform 90ms ease-out,background-color 130ms ease-out,border-color 130ms ease-out,color 130ms ease-out;
}
.button:hover{background:var(--fm-bg-elevated);border-color:var(--fm-border-strong)}
.button:active{transform:scale(.975);transition-duration:60ms}
.button:focus-visible{outline:2px solid var(--fm-focus-ring);outline-offset:2px}
.button[aria-busy="true"],.button:disabled{cursor:wait;opacity:.68}
.button.primary{margin-left:auto;border-color:transparent;background:var(--fm-accent-primary);color:var(--fm-text-on-accent)}
.button.primary:hover{background:var(--fm-accent-secondary)}
.button.stop{border-color:rgba(255,126,135,.32);background:transparent;color:var(--fm-destructive)}
.button.stop:hover{background:rgba(255,126,135,.09);border-color:rgba(255,126,135,.55)}
.button-icon{width:15px;height:15px;flex:0 0 auto}
.compact{width:min(300px,calc(100vw - 24px));padding:10px 11px}
.compact .compact-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700;line-height:18px}
.compact .brand-lockup{flex:1 1 auto}
.compact .brand-symbol{width:20px;height:20px}
.compact .status{margin-left:auto}
.compact .button{flex:0 0 44px;width:44px;padding:0}
.compact .top{gap:8px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

@media(max-width:290px){.hud{right:8px;top:8px;width:calc(100vw - 16px)}.button{padding:0 11px}}
@media(prefers-reduced-motion:reduce){.hud,.button{transition:opacity 120ms ease-out!important;transform:none!important}.bar{transition:none!important}}
@media(prefers-reduced-transparency:reduce){.hud{background:var(--fm-bg-primary);-webkit-backdrop-filter:none;backdrop-filter:none}}
@media(prefers-contrast:more){.hud{background:var(--fm-bg-primary);border-color:var(--fm-text-secondary)}.button{border-color:var(--fm-text-secondary)}.meta,.eyebrow,.status{color:var(--fm-text-primary)}}
@media(forced-colors:active){.hud,.button,.progress{border:1px solid CanvasText}.bar,.dot,.guard-mark{background:Highlight}.button:focus-visible{outline-color:Highlight}.intervention{border-color:Highlight}}
`;
  var escapeHtml2 = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  var brandSymbol = () => `
  <svg class="brand-symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="m8.5 23-2-14 13.5-3-1 4-8 1.8 1 8.6c4 .3 7.9-1 10.7-3.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="trajectory" d="M6.5 24.5c6.8 1.7 14.4.1 19.4-5.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/>
    <path class="trajectory" d="m23.1 18 3.1.1-.6 3" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="spark" d="M25 5.3c0 2-1 3-3 3 2 0 3 1 3 3 0-2 1-3 3-3-2 0-3-1-3-3Z" fill="currentColor"/>
  </svg>`;
  var openPanelIcon = () => `
  <svg class="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M4 3.5h12v13H4zM11.5 3.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
  var chevronIcon = (expanded) => `
  <svg class="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="m6 ${expanded ? 12 : 8} 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  var activityGuardPresentation = (run) => {
    if (run.guard.state === "recovery") return { state: "recovery", label: "Recovery" };
    if (run.status === "paused") return { state: "paused", label: "Paused" };
    if (["waiting", "stopping"].includes(run.status)) return { state: "elevated", label: "Elevated" };
    if (run.guard.state === "caution") return { state: "caution", label: "Caution" };
    return { state: "normal", label: "Normal" };
  };
  var runStatusLabel = (status) => {
    const labels = {
      recovery_required: "Needs review",
      stopping: "Stopping safely",
      waiting: "Waiting",
      paused: "Run paused",
      running: "Running"
    };
    return labels[String(status)] || String(status || "Active").replaceAll("_", " ");
  };
  var RunHud = class {
    constructor(runtime) {
      this.runtime = runtime;
      this.host = document.createElement("fut-magic-run-hud");
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `<style>${css2}</style><span class="sr-only" aria-live="polite" aria-atomic="true"></span><div data-hud-mount></div>`;
      this.liveRegion = this.shadow.querySelector('[aria-live="polite"]');
      this.mount = this.shadow.querySelector("[data-hud-mount]");
      this.lastAnnouncement = "";
      this.collapsed = false;
      document.documentElement.appendChild(this.host);
      this.unsubscribe = runtime.subscribe((state) => this.render(state));
    }
    render(state) {
      const focusedCommand = this.shadow.activeElement?.dataset?.command || null;
      const run = buildProductShellViewModel(state).run;
      if (!run || state.legacyPanelOpen) {
        this.mount.innerHTML = '<section class="hud hidden"></section>';
        this.liveRegion.textContent = "";
        this.lastAnnouncement = "";
        return;
      }
      const total = run.progress.total || 0;
      const current = run.progress.current || 0;
      const ratio = total ? Math.min(1, current / total) : 0;
      const statusLabel = runStatusLabel(run.status);
      const runTitle = String(run.title ?? "").trim() || "Active run";
      const guard = activityGuardPresentation(run);
      const compact = this.collapsed && guard.state === "normal";
      const announcement = `FUT Magic run status ${statusLabel}. Safety status ${guard.label}. ${run.currentStep?.label || run.nextStep?.label || "Preparing next step"}.`;
      if (announcement !== this.lastAnnouncement) {
        this.liveRegion.textContent = announcement;
        this.lastAnnouncement = announcement;
      }
      const progressMarkup = total ? `<div class="progress" role="progressbar" aria-label="Run progress" aria-valuemin="0" aria-valuenow="${current}" aria-valuemax="${total}" aria-valuetext="${current} of ${total} cycles"><div class="bar" style="transform:scaleX(${ratio})"></div></div>` : `<div class="meta progress-copy" role="status">${current} cycles completed · Total not set</div>`;
      const interventionTitle = guard.state === "recovery" ? "Action not verified" : /player|choice/i.test(`${run.currentStep?.label || ""} ${run.intervention?.message || ""}`) ? "Player choice needed" : "Your input is needed";
      const panelLabel = guard.state === "recovery" ? "Review in panel" : "Open panel";
      this.mount.innerHTML = compact ? `<section class="hud compact" aria-label="Active FUT Magic run"><div class="top"><div class="brand-lockup">${brandSymbol()}<span class="compact-title">${escapeHtml2(runTitle)}</span></div><span class="status normal" aria-label="Run status: ${escapeHtml2(statusLabel)}"><span class="dot" aria-hidden="true"></span>${escapeHtml2(statusLabel)}</span><button class="button" data-command="expand" aria-label="Expand run HUD">${chevronIcon(false)}</button></div></section>` : `<section class="hud" aria-label="Active FUT Magic run"><div class="top"><div class="brand-lockup">${brandSymbol()}<div class="brand">FUT Magic</div></div><div class="top-actions"><div class="status ${escapeHtml2(guard.state)}" aria-label="Run status: ${escapeHtml2(statusLabel)}"><span class="dot" aria-hidden="true"></span>${escapeHtml2(statusLabel)}</div>${guard.state === "normal" ? `<button class="button" data-command="collapse" aria-label="Collapse run HUD">${chevronIcon(true)}</button>` : ""}</div></div><div class="row title"><span>${escapeHtml2(runTitle)}</span><span class="meta">${escapeHtml2(total ? `${current} / ${total}` : current)}</span></div>${progressMarkup}<div class="eyebrow">${run.currentStep ? "Now" : "Next"}</div><div class="next">${escapeHtml2(run.currentStep?.label || run.nextStep?.label || "Preparing the next safe step")}</div>${run.nextStep && run.currentStep ? `<div class="meta">Next: ${escapeHtml2(run.nextStep.label)}</div>` : ""}<div class="row guard"><span class="meta">Activity Guard</span><span class="guard-status ${escapeHtml2(guard.state)}"><span class="guard-mark" aria-hidden="true"></span>${escapeHtml2(guard.label)}</span></div>${run.intervention ? `<div class="intervention ${escapeHtml2(guard.state)}" role="status" aria-live="polite"><span class="intervention-title">${escapeHtml2(interventionTitle)}</span>${escapeHtml2(run.intervention.message)}</div>` : ""}<div class="actions">${run.canPause ? '<button class="button" data-command="pause">Pause</button>' : ""}${run.canResume ? '<button class="button" data-command="resume">Resume</button>' : ""}${run.canStop ? '<button class="button stop" data-command="stop">Stop</button>' : ""}<button class="button primary" data-command="open" aria-label="${escapeHtml2(panelLabel)}" title="${escapeHtml2(panelLabel)}">${openPanelIcon()}<span>${escapeHtml2(panelLabel)}</span></button></div></section>`;
      this.shadow.querySelectorAll("[data-command]").forEach((button) => {
        button.addEventListener("click", async () => {
          const command = button.dataset.command;
          if (command === "collapse") {
            this.collapsed = true;
            this.render(this.runtime.getState());
            return;
          }
          if (command === "expand") {
            this.collapsed = false;
            this.render(this.runtime.getState());
            return;
          }
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          try {
            if (command === "pause") await this.runtime.pause();
            else if (command === "resume") await this.runtime.resume();
            else if (command === "stop") await this.runtime.stop();
            else await this.runtime.openSidePanel();
          } catch (error) {
            this.runtime.reportUiError(error);
          } finally {
            if (button.isConnected) {
              button.disabled = false;
              button.removeAttribute("aria-busy");
            }
          }
        });
      });
      if (focusedCommand) {
        const equivalentCommand = focusedCommand === "collapse" && compact ? "expand" : focusedCommand === "expand" && !compact ? "collapse" : focusedCommand === "pause" && run.canResume ? "resume" : focusedCommand === "resume" && run.canPause ? "pause" : focusedCommand;
        const focusTarget = this.shadow.querySelector(`[data-command="${equivalentCommand}"]`) || this.shadow.querySelector('[data-command="open"]');
        focusTarget?.focus({ preventScroll: true });
      }
    }
    dispose() {
      this.unsubscribe?.();
      this.host.remove();
    }
  };

  // src/workflow/constants.js
  var WORKFLOW_SCHEMA_VERSION = 1;
  var WorkflowStepType = Object.freeze({
    SOLVE_SBC: "SOLVE_SBC",
    SUBMIT_SBC: "SUBMIT_SBC",
    CLAIM_REWARD: "CLAIM_REWARD",
    OPEN_REWARD_PACK: "OPEN_REWARD_PACK",
    RESOLVE_ITEMS: "RESOLVE_ITEMS",
    ORGANIZE_ITEMS: "ORGANIZE_ITEMS",
    HANDLE_PLAYER_PICK: "HANDLE_PLAYER_PICK",
    DELAY: "DELAY",
    CONDITIONAL: "CONDITIONAL",
    LOOP: "LOOP",
    PAUSE: "PAUSE"
  });
  var WORKFLOW_STEP_TYPES = Object.freeze(
    Object.values(WorkflowStepType)
  );
  var WorkflowMode = Object.freeze({
    REVIEW: "REVIEW",
    ASSISTED: "ASSISTED",
    AUTO: "AUTO"
  });
  var WORKFLOW_MODES = Object.freeze(Object.values(WorkflowMode));
  var StepStatus = Object.freeze({
    PENDING: "pending",
    RUNNING: "running",
    WAITING: "waiting",
    COMPLETED: "completed",
    SKIPPED: "skipped",
    FAILED: "failed",
    PAUSED: "paused"
  });
  var RunStatus = Object.freeze({
    RUNNING: "running",
    WAITING: "waiting",
    PAUSED: "paused",
    STOPPING: "stopping",
    STOPPED: "stopped",
    COMPLETED: "completed",
    FAILED: "failed",
    RECOVERY_REQUIRED: "recovery_required"
  });
  var OnFailure = Object.freeze({
    PAUSE: "PAUSE",
    STOP: "STOP",
    SKIP: "SKIP"
  });
  var ON_FAILURE_VALUES = Object.freeze(Object.values(OnFailure));
  var DESTRUCTIVE_STEP_TYPES = /* @__PURE__ */ new Set([
    WorkflowStepType.SUBMIT_SBC,
    WorkflowStepType.CLAIM_REWARD,
    WorkflowStepType.OPEN_REWARD_PACK,
    WorkflowStepType.RESOLVE_ITEMS,
    WorkflowStepType.ORGANIZE_ITEMS,
    WorkflowStepType.HANDLE_PLAYER_PICK
  ]);
  var TERMINAL_RUN_STATUSES = /* @__PURE__ */ new Set([
    RunStatus.STOPPED,
    RunStatus.COMPLETED,
    RunStatus.FAILED
  ]);
  var DEFAULT_RETRY_POLICY = Object.freeze({
    maxAttempts: 1,
    delayMs: 500,
    backoffFactor: 2,
    maxDelayMs: 3e4,
    retryableCodes: Object.freeze([])
  });
  var DEFAULT_STEP_TIMEOUT_MS = 12e4;
  var MAX_STEP_TIMEOUT_MS = 10 * 6e4;
  var MAX_RETRY_ATTEMPTS = 10;
  var MAX_LOOP_ITERATIONS = 1e3;
  var MAX_WORKFLOW_STEPS = 2e3;
  var MAX_WORKFLOW_DEPTH = 24;
  var MAX_RUN_HISTORY = 500;

  // src/workflow/definitions.js
  var normalizeText2 = (value) => {
    const text = String(value ?? "").trim();
    return text || null;
  };
  var clampInteger = (value, minimum, maximum, fallback) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
  };
  var normalizeRetryPolicy = (value) => {
    const raw = isPlainObject2(value) ? value : {};
    const retryableCodes = Array.isArray(raw.retryableCodes) ? Array.from(
      new Set(raw.retryableCodes.map(normalizeText2).filter(Boolean))
    ).slice(0, 50) : [];
    return {
      maxAttempts: clampInteger(
        raw.maxAttempts,
        1,
        MAX_RETRY_ATTEMPTS,
        DEFAULT_RETRY_POLICY.maxAttempts
      ),
      delayMs: clampInteger(
        raw.delayMs,
        0,
        5 * 6e4,
        DEFAULT_RETRY_POLICY.delayMs
      ),
      backoffFactor: Math.max(
        1,
        Math.min(
          10,
          Number.isFinite(Number(raw.backoffFactor)) ? Number(raw.backoffFactor) : DEFAULT_RETRY_POLICY.backoffFactor
        )
      ),
      maxDelayMs: clampInteger(
        raw.maxDelayMs,
        0,
        30 * 6e4,
        DEFAULT_RETRY_POLICY.maxDelayMs
      ),
      retryableCodes
    };
  };
  var normalizeNestedSteps = (value, context, path) => {
    if (!Array.isArray(value)) return [];
    return value.map(
      (step2, index) => normalizeStep(step2, context, `${path}[${index}]`, context.depth)
    );
  };
  var normalizeStepConfig = (type, value, context, path) => {
    const raw = isPlainObject2(value) ? cloneSerializable(value) : {};
    if (type === WorkflowStepType.CONDITIONAL) {
      const conditionResult = validateCondition(raw.condition);
      if (!conditionResult.ok) {
        for (const issue of conditionResult.issues) {
          context.issues.push({
            ...issue,
            path: `${path}.condition.${issue.path.replace(/^condition\.?/, "")}`.replace(/\.$/, "")
          });
        }
      }
      return {
        condition: raw.condition ?? null,
        thenSteps: normalizeNestedSteps(
          raw.thenSteps ?? raw.whenTrue,
          { ...context, depth: context.depth + 1 },
          `${path}.thenSteps`
        ),
        elseSteps: normalizeNestedSteps(
          raw.elseSteps ?? raw.whenFalse,
          { ...context, depth: context.depth + 1 },
          `${path}.elseSteps`
        )
      };
    }
    if (type === WorkflowStepType.LOOP) {
      const body = normalizeNestedSteps(
        raw.body ?? raw.steps,
        { ...context, depth: context.depth + 1 },
        `${path}.body`
      );
      if (!body.length) {
        context.issues.push({
          path: `${path}.body`,
          code: "LOOP_BODY_REQUIRED",
          message: "LOOP requires at least one body step."
        });
      }
      const conditionResult = raw.condition == null ? null : validateCondition(raw.condition);
      if (conditionResult && !conditionResult.ok) {
        for (const issue of conditionResult.issues) {
          context.issues.push({
            ...issue,
            path: `${path}.condition.${issue.path.replace(/^condition\.?/, "")}`.replace(/\.$/, "")
          });
        }
      }
      return {
        body,
        maxIterations: clampInteger(
          raw.maxIterations ?? raw.iterations ?? raw.times,
          1,
          MAX_LOOP_ITERATIONS,
          1
        ),
        condition: raw.condition ?? null
      };
    }
    if (type === WorkflowStepType.DELAY) {
      return {
        ...raw,
        durationMs: clampInteger(
          raw.durationMs ?? raw.delayMs,
          0,
          24 * 60 * 6e4,
          0
        )
      };
    }
    if (type === WorkflowStepType.PAUSE) {
      return {
        ...raw,
        reason: normalizeText2(raw.reason) ?? "Workflow pause step reached."
      };
    }
    return raw;
  };
  function normalizeStep(value, context, path, depth = 0) {
    if (depth > MAX_WORKFLOW_DEPTH) {
      context.issues.push({
        path,
        code: "WORKFLOW_TOO_DEEP",
        message: `Workflow nesting may not exceed ${MAX_WORKFLOW_DEPTH} levels.`
      });
    }
    if (!isPlainObject2(value)) {
      context.issues.push({
        path,
        code: "STEP_INVALID",
        message: "Workflow step must be an object."
      });
      value = {};
    }
    context.stepCount.count += 1;
    if (context.stepCount.count > MAX_WORKFLOW_STEPS) {
      context.issues.push({
        path,
        code: "WORKFLOW_STEP_LIMIT",
        message: `Workflow may contain at most ${MAX_WORKFLOW_STEPS} steps.`
      });
    }
    const id = normalizeText2(value.id);
    if (!id) {
      context.issues.push({ path: `${path}.id`, code: "STEP_ID_REQUIRED", message: "Step id is required." });
    } else if (id.length > 128) {
      context.issues.push({ path: `${path}.id`, code: "STEP_ID_INVALID", message: "Step id is too long." });
    } else if (context.ids.has(id)) {
      context.issues.push({ path: `${path}.id`, code: "STEP_ID_DUPLICATE", message: `Duplicate step id: ${id}.` });
    } else {
      context.ids.add(id);
    }
    const type = String(value.type ?? "").trim().toUpperCase();
    if (!WORKFLOW_STEP_TYPES.includes(type)) {
      context.issues.push({
        path: `${path}.type`,
        code: "STEP_TYPE_INVALID",
        message: `Unsupported workflow step type: ${type || "<empty>"}.`
      });
    }
    const timeoutMs = clampInteger(
      value.timeoutMs ?? value.timeout,
      100,
      MAX_STEP_TIMEOUT_MS,
      DEFAULT_STEP_TIMEOUT_MS
    );
    const onFailureRaw = String(value.onFailure ?? OnFailure.PAUSE).trim().toUpperCase();
    const onFailure = ON_FAILURE_VALUES.includes(onFailureRaw) ? onFailureRaw : OnFailure.PAUSE;
    if (!ON_FAILURE_VALUES.includes(onFailureRaw)) {
      context.issues.push({
        path: `${path}.onFailure`,
        code: "STEP_ON_FAILURE_INVALID",
        message: `Unsupported onFailure behavior: ${onFailureRaw || "<empty>"}.`
      });
    }
    const nestedContext = { ...context, depth };
    return {
      id: id ?? `invalid-step-${context.stepCount.count}`,
      type,
      config: normalizeStepConfig(type, value.config, nestedContext, `${path}.config`),
      status: StepStatus.PENDING,
      retryPolicy: normalizeRetryPolicy(value.retryPolicy),
      timeoutMs,
      onFailure
    };
  }
  var validateWorkflowDefinition = (value) => {
    const issues = [];
    const raw = isPlainObject2(value) ? value : {};
    if (!isPlainObject2(value)) {
      issues.push({ path: "workflow", code: "WORKFLOW_INVALID", message: "Workflow must be an object." });
    }
    const id = normalizeText2(raw.id);
    if (!id) issues.push({ path: "workflow.id", code: "WORKFLOW_ID_REQUIRED", message: "Workflow id is required." });
    const name = normalizeText2(raw.name);
    if (!name) issues.push({ path: "workflow.name", code: "WORKFLOW_NAME_REQUIRED", message: "Workflow name is required." });
    if (!Array.isArray(raw.steps) || !raw.steps.length) {
      issues.push({ path: "workflow.steps", code: "WORKFLOW_STEPS_REQUIRED", message: "Workflow requires at least one step." });
    }
    const context = {
      ids: /* @__PURE__ */ new Set(),
      issues,
      stepCount: { count: 0 },
      depth: 0
    };
    const steps = Array.isArray(raw.steps) ? raw.steps.map((step2, index) => normalizeStep(step2, context, `workflow.steps[${index}]`, 0)) : [];
    const normalized = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      id: id ?? "invalid-workflow",
      name: name ?? "Invalid Workflow",
      description: normalizeText2(raw.description),
      version: clampInteger(raw.version, 1, Number.MAX_SAFE_INTEGER, 1),
      steps,
      metadata: isPlainObject2(raw.metadata) ? cloneSerializable(raw.metadata) : {}
    };
    try {
      assertSerializable(normalized, "Workflow definition");
    } catch (error) {
      issues.push({
        path: "workflow",
        code: error?.code ?? "WORKFLOW_NOT_SERIALIZABLE",
        message: error?.message ?? "Workflow is not serializable."
      });
    }
    return { ok: issues.length === 0, issues, value: normalized };
  };
  var normalizeWorkflowDefinition = (value) => {
    const result = validateWorkflowDefinition(value);
    if (!result.ok) throw new WorkflowValidationError(result.issues);
    return result.value;
  };
  var hashWorkflowDefinition = (value) => {
    const normalized = normalizeWorkflowDefinition(value);
    return `wf-${fnv1aHash(stableStringify2(normalized))}`;
  };
  var createAutoApproval = (workflow) => {
    const normalized = normalizeWorkflowDefinition(workflow);
    return {
      confirmed: true,
      workflowId: normalized.id,
      workflowVersion: normalized.version,
      workflowHash: hashWorkflowDefinition(normalized)
    };
  };

  // src/workflow/workflow-engine.js
  var defaultNow = () => Date.now();
  var defaultIdFactory = (prefix = "workflow") => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };
  var normalizeMode = (mode) => {
    const value = String(mode ?? WorkflowMode.REVIEW).trim().toUpperCase();
    if (!WORKFLOW_MODES.includes(value)) {
      throw new WorkflowError(`Unsupported workflow mode: ${value || "<empty>"}`, {
        code: "WORKFLOW_MODE_INVALID"
      });
    }
    return value;
  };
  var normalizeError = (error) => ({
    code: String(error?.code ?? "STEP_FAILED"),
    message: String(error?.message ?? error ?? "Workflow step failed"),
    details: cloneSerializable(error?.details ?? null),
    safeToRetry: typeof error?.safeToRetry === "boolean" ? error.safeToRetry : error?.notApplied === true,
    ambiguous: error?.ambiguous === true
  });
  var isDestructive = (step2) => DESTRUCTIVE_STEP_TYPES.has(step2?.type);
  var calculateRetryDelay = (policy, attempt) => {
    const exponent = Math.max(0, Number(attempt) - 1);
    return Math.min(
      Number(policy.maxDelayMs),
      Math.round(Number(policy.delayMs) * Number(policy.backoffFactor) ** exponent)
    );
  };
  var handlerFor = (handlers, type) => {
    if (handlers instanceof Map) return handlers.get(type) ?? null;
    return handlers?.[type] ?? null;
  };
  var callHandlerMethod = (handler, method, args) => {
    if (typeof handler === "function") {
      return method === "execute" ? handler(args) : void 0;
    }
    return typeof handler?.[method] === "function" ? handler[method](args) : void 0;
  };
  var evaluateWorkflowModeGate = ({ run, node }) => {
    if (!isDestructive(node?.step)) return { allowed: true };
    if (run.mode === WorkflowMode.REVIEW) {
      return {
        allowed: false,
        code: "REVIEW_MODE_DESTRUCTIVE_STEP",
        message: `${node.step.type} requires leaving REVIEW mode.`
      };
    }
    if (run.mode === WorkflowMode.ASSISTED) {
      if (run.authorizations?.[node.executionId] === true) return { allowed: true };
      return {
        allowed: false,
        code: "ASSISTED_APPROVAL_REQUIRED",
        message: `Approve ${node.step.type} before continuing.`
      };
    }
    const approval = run.approval;
    if (approval?.confirmed === true && approval?.workflowId === run.workflowId && Number(approval?.workflowVersion) === Number(run.workflowVersion) && approval?.workflowHash === run.workflowHash) {
      return { allowed: true };
    }
    return {
      allowed: false,
      code: "AUTO_APPROVAL_INVALID",
      message: "AUTO approval is missing or no longer matches the workflow."
    };
  };
  var createExecutionNode = (run, step2, runtime = {}) => {
    run.executionSequence += 1;
    return {
      executionId: `${step2.id}::${run.executionSequence}`,
      definitionStepId: step2.id,
      step: cloneSerializable(step2),
      status: StepStatus.PENDING,
      attempt: 0,
      intent: null,
      result: null,
      error: null,
      waitUntil: null,
      startedAt: null,
      completedAt: null,
      runtime: cloneSerializable(runtime)
    };
  };
  var createRun = ({ definition, mode, approval, now, idFactory }) => {
    const createdAt = now();
    const run = {
      schemaVersion: 1,
      revision: 0,
      runId: idFactory("workflow-run"),
      workflowId: definition.id,
      workflowVersion: definition.version,
      workflowHash: hashWorkflowDefinition(definition),
      definition: cloneSerializable(definition),
      mode,
      status: RunStatus.RUNNING,
      pauseReason: null,
      approval: approval ? cloneSerializable(approval) : null,
      authorizations: {},
      cursor: 0,
      executionSequence: 0,
      nodes: [],
      counters: {
        completed: 0,
        skipped: 0,
        failed: 0,
        loopIterations: 0,
        transitions: 0
      },
      history: [],
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      lastError: null
    };
    run.nodes = definition.steps.map((step2) => createExecutionNode(run, step2));
    return run;
  };
  var WorkflowEngine = class {
    constructor({
      repository,
      handlers = {},
      contextProvider = () => ({}),
      modeGate = evaluateWorkflowModeGate,
      operationScheduler = null,
      now = defaultNow,
      idFactory = defaultIdFactory,
      setTimer = globalThis.setTimeout?.bind(globalThis),
      clearTimer = globalThis.clearTimeout?.bind(globalThis)
    } = {}) {
      if (!repository) {
        throw new WorkflowPersistenceError("WorkflowEngine requires a repository");
      }
      this.repository = repository;
      this.handlers = handlers;
      this.contextProvider = contextProvider;
      this.modeGate = modeGate;
      this.operationScheduler = operationScheduler;
      this.now = now;
      this.idFactory = idFactory;
      this.setTimer = setTimer;
      this.clearTimer = clearTimer;
      this.run = null;
      this.listeners = /* @__PURE__ */ new Set();
      this.activeTick = null;
      this.controlRequest = null;
    }
    subscribe(listener) {
      if (typeof listener !== "function") return () => {
      };
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    getSnapshot() {
      return this.run ? cloneSerializable(this.run) : null;
    }
    async start(definitionValue, { mode = WorkflowMode.REVIEW, approval = null } = {}) {
      if (this.activeTick) throw new WorkflowError("Workflow engine is busy", { code: "WORKFLOW_BUSY" });
      const definition = normalizeWorkflowDefinition(definitionValue);
      const normalizedMode = normalizeMode(mode);
      const workflowHash = hashWorkflowDefinition(definition);
      if (normalizedMode === WorkflowMode.AUTO) {
        if (approval?.confirmed !== true || approval?.workflowId !== definition.id || Number(approval?.workflowVersion) !== Number(definition.version) || approval?.workflowHash !== workflowHash) {
          throw new WorkflowError("AUTO mode requires a matching confirmed approval", {
            code: "AUTO_APPROVAL_REQUIRED",
            details: { requiredApproval: createAutoApproval(definition) }
          });
        }
      }
      const existing = await this.repository.loadActiveRun();
      if (existing && !TERMINAL_RUN_STATUSES.has(existing.status)) {
        throw new WorkflowError("Another workflow run is still active", {
          code: "WORKFLOW_ALREADY_ACTIVE",
          details: { runId: existing.runId, status: existing.status }
        });
      }
      this.run = createRun({
        definition,
        mode: normalizedMode,
        approval,
        now: this.now,
        idFactory: this.idFactory
      });
      this._record("RUN_STARTED", { mode: normalizedMode });
      assertSerializable(this.run, "Workflow run");
      this.run = await this.repository.createRun(this.run);
      this._emit();
      return this.getSnapshot();
    }
    async load(runId = null) {
      const loaded = runId == null ? await this.repository.loadActiveRun() : await this.repository.loadRun(runId);
      this.run = loaded ? cloneSerializable(loaded) : null;
      this._emit();
      return this.getSnapshot();
    }
    async tick() {
      if (this.activeTick) return this.activeTick;
      this.activeTick = this._tickCore().finally(() => {
        this.activeTick = null;
      });
      return this.activeTick;
    }
    async runUntilBlocked({ maxTransitions = 1e3 } = {}) {
      const limit = Math.max(1, Math.min(1e4, Math.trunc(Number(maxTransitions) || 1e3)));
      for (let index = 0; index < limit; index += 1) {
        const beforeRevision = this.run?.revision ?? -1;
        const snapshot = await this.tick();
        if (!snapshot || snapshot.status !== RunStatus.RUNNING) return snapshot;
        if ((snapshot.revision ?? -1) === beforeRevision) return snapshot;
      }
      if (this.run?.status === RunStatus.RUNNING) {
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "TRANSITION_LIMIT_REACHED",
          message: "Workflow paused after reaching the transition safety limit."
        };
        this._record("RUN_PAUSED", this.run.pauseReason);
        await this._persist();
      }
      return this.getSnapshot();
    }
    async pause({ reason = "Paused by user." } = {}) {
      this._requireRun();
      if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
      this.controlRequest = { type: "pause", reason: String(reason) };
      if (this.activeTick) await this.activeTick;
      if (this.run.status !== RunStatus.PAUSED) await this._applyControlRequest();
      return this.getSnapshot();
    }
    async stop({ reason = "Stopped by user." } = {}) {
      this._requireRun();
      if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
      this.controlRequest = { type: "stop", reason: String(reason) };
      if (this.activeTick) await this.activeTick;
      if (this.run.status !== RunStatus.STOPPED) await this._applyControlRequest();
      return this.getSnapshot();
    }
    async resume({
      approveCurrent = false,
      acknowledgeRecovery = false,
      retryCurrent = false,
      skipCurrent = false
    } = {}) {
      this._requireRun();
      if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
      const node = this._currentNode();
      if (this.run.status === RunStatus.RECOVERY_REQUIRED && !acknowledgeRecovery) {
        throw new WorkflowError("Recovery must be acknowledged before resuming", {
          code: "RECOVERY_ACKNOWLEDGEMENT_REQUIRED"
        });
      }
      if (node?.status === StepStatus.FAILED) {
        if (skipCurrent) {
          node.status = StepStatus.SKIPPED;
          node.completedAt = this.now();
          this.run.counters.skipped += 1;
          this.run.cursor += 1;
        } else if (retryCurrent) {
          node.status = StepStatus.PENDING;
          node.attempt = 0;
          node.error = null;
          node.waitUntil = null;
        } else {
          throw new WorkflowError("Choose retryCurrent or skipCurrent for the failed step", {
            code: "FAILED_STEP_DECISION_REQUIRED"
          });
        }
      } else if (node?.status === StepStatus.PAUSED && node.step.type === WorkflowStepType.PAUSE) {
        this._completeNode(node, { resumed: true });
      } else if (node?.status === StepStatus.WAITING) {
        if (this.run.mode === WorkflowMode.REVIEW && isDestructive(node.step)) {
          throw new WorkflowError("REVIEW mode cannot authorize destructive steps", {
            code: "REVIEW_MODE_DESTRUCTIVE_STEP"
          });
        }
        if (this.run.mode === WorkflowMode.ASSISTED && isDestructive(node.step)) {
          if (!approveCurrent) {
            throw new WorkflowError("This step requires assisted approval", {
              code: "ASSISTED_APPROVAL_REQUIRED"
            });
          }
          this.run.authorizations[node.executionId] = true;
        }
        node.status = StepStatus.PENDING;
        node.waitUntil = null;
      }
      this.run.status = RunStatus.RUNNING;
      this.run.pauseReason = null;
      this.controlRequest = null;
      this._record("RUN_RESUMED", {
        approveCurrent: Boolean(approveCurrent),
        acknowledgeRecovery: Boolean(acknowledgeRecovery)
      });
      await this._persist();
      return this.getSnapshot();
    }
    async recover(runId = null) {
      await this.load(runId);
      this._requireRun();
      if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
      if (this.run.status === RunStatus.STOPPING) {
        this.run.status = RunStatus.STOPPED;
        this.run.pauseReason = null;
        this._record("RUN_RECOVERED_AS_STOPPED");
        await this._persist();
        return this.getSnapshot();
      }
      const node = this._currentNode();
      if (!node) {
        this.run.status = RunStatus.COMPLETED;
        this.run.completedAt = this.now();
        this._record("RUN_RECOVERED_AS_COMPLETED");
        await this._persist();
        return this.getSnapshot();
      }
      const failedDestructiveNeedsReconciliation = node.status === StepStatus.FAILED && this.run.status === RunStatus.RECOVERY_REQUIRED && isDestructive(node.step) && this.run.pauseReason?.executionId === node.executionId && this.run.lastError?.executionId === node.executionId;
      if (node.status === StepStatus.RUNNING || failedDestructiveNeedsReconciliation) {
        const handler = handlerFor(this.handlers, node.step.type);
        const recoveryMethod = typeof handler?.recover === "function";
        if (recoveryMethod) {
          const context = await this._getContext(node);
          let outcome2;
          try {
            outcome2 = await callHandlerMethod(handler, "recover", {
              step: cloneSerializable(node.step),
              node: cloneSerializable(node),
              run: this.getSnapshot(),
              context
            });
          } catch (error) {
            outcome2 = { status: "ambiguous", error: normalizeError(error) };
          }
          const status = String(outcome2?.status ?? "ambiguous").toLowerCase();
          if (status === "completed") {
            if (failedDestructiveNeedsReconciliation) {
              this.run.counters.failed = Math.max(0, this.run.counters.failed - 1);
              this.run.lastError = null;
            }
            this._completeNode(node, outcome2?.result ?? null);
            this.run.status = RunStatus.PAUSED;
            this.run.pauseReason = {
              code: "RECOVERED_STEP_COMPLETED",
              message: "The interrupted step was verified as completed. Resume to continue."
            };
          } else if (status === "not_applied" || status === "retry") {
            if (failedDestructiveNeedsReconciliation) {
              this.run.counters.failed = Math.max(0, this.run.counters.failed - 1);
              this.run.lastError = null;
            }
            node.status = StepStatus.PENDING;
            node.error = null;
            node.waitUntil = null;
            this.run.status = RunStatus.PAUSED;
            this.run.pauseReason = {
              code: "RECOVERED_STEP_NOT_APPLIED",
              message: "The interrupted step was verified as not applied. Resume to retry."
            };
          } else {
            this._requireRecovery(node, {
              code: "RECOVERY_AMBIGUOUS",
              message: outcome2?.error?.message ?? "The interrupted operation is ambiguous."
            });
          }
        } else if (isDestructive(node.step)) {
          this._requireRecovery(node, {
            code: "RECOVERY_HANDLER_REQUIRED",
            message: "A destructive operation was interrupted and cannot be verified."
          });
        } else {
          node.status = StepStatus.PENDING;
          node.error = null;
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: "RECOVERED_SAFE_RETRY",
            message: "The non-destructive step can be retried. Resume to continue."
          };
        }
      } else if (this.run.status === RunStatus.RUNNING) {
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "RECOVERED_SAFE_BOUNDARY",
          message: "Workflow recovered at a safe boundary. Resume to continue."
        };
      }
      this._record("RUN_RECOVERED", { status: this.run.status });
      await this._persist();
      return this.getSnapshot();
    }
    async _tickCore() {
      this._requireRun();
      if (this.controlRequest) {
        await this._applyControlRequest();
        return this.getSnapshot();
      }
      if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
      const node = this._currentNode();
      if (!node) {
        this.run.status = RunStatus.COMPLETED;
        this.run.completedAt = this.now();
        this.run.pauseReason = null;
        this._record("RUN_COMPLETED");
        await this._persist();
        return this.getSnapshot();
      }
      if (this.run.status === RunStatus.PAUSED || this.run.status === RunStatus.RECOVERY_REQUIRED) {
        return this.getSnapshot();
      }
      if (this.run.status === RunStatus.WAITING) {
        if (node.waitUntil == null || this.now() < node.waitUntil) return this.getSnapshot();
        node.status = StepStatus.PENDING;
        node.waitUntil = null;
        this.run.status = RunStatus.RUNNING;
        this._record("STEP_WAIT_FINISHED", { executionId: node.executionId });
        await this._persist();
        return this.getSnapshot();
      }
      if (node.status === StepStatus.COMPLETED || node.status === StepStatus.SKIPPED) {
        this.run.cursor += 1;
        await this._persist();
        return this.getSnapshot();
      }
      if (node.step.type === WorkflowStepType.CONDITIONAL) {
        await this._executeConditional(node);
      } else if (node.step.type === WorkflowStepType.LOOP) {
        await this._executeLoop(node);
      } else if (node.step.type === WorkflowStepType.DELAY) {
        await this._executeDelay(node);
      } else if (node.step.type === WorkflowStepType.PAUSE) {
        node.status = StepStatus.PAUSED;
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "PAUSE_STEP_REACHED",
          message: node.step.config.reason
        };
        this._record("STEP_PAUSED", { executionId: node.executionId });
        await this._persist();
      } else {
        await this._executeHandler(node);
      }
      if (this.controlRequest && !TERMINAL_RUN_STATUSES.has(this.run.status)) {
        await this._applyControlRequest();
      }
      return this.getSnapshot();
    }
    async _executeConditional(node) {
      try {
        const context = await this._getContext(node);
        const conditionResult = evaluateCondition(node.step.config.condition, context);
        const selected3 = conditionResult ? node.step.config.thenSteps : node.step.config.elseSteps;
        const inserted = selected3.map((step2) => createExecutionNode(this.run, step2, {
          parentExecutionId: node.executionId,
          branch: conditionResult ? "then" : "else"
        }));
        this.run.nodes.splice(this.run.cursor + 1, 0, ...inserted);
        this._completeNode(node, {
          conditionResult,
          branch: conditionResult ? "then" : "else",
          inserted: inserted.length
        });
        this._record("CONDITION_EVALUATED", {
          executionId: node.executionId,
          conditionResult
        });
        await this._persist();
      } catch (error) {
        await this._handleStepError(node, error);
      }
    }
    async _executeLoop(node) {
      try {
        const iteration = Math.max(0, Number(node.runtime?.iteration) || 0);
        const maxIterations = Number(node.step.config.maxIterations) || 1;
        let conditionResult = true;
        if (node.step.config.condition != null) {
          conditionResult = evaluateCondition(
            node.step.config.condition,
            await this._getContext(node, { loopIteration: iteration })
          );
        }
        if (iteration >= maxIterations || !conditionResult) {
          this._completeNode(node, {
            done: true,
            iterations: iteration,
            conditionResult
          });
          this._record("LOOP_COMPLETED", {
            executionId: node.executionId,
            iterations: iteration
          });
          await this._persist();
          return;
        }
        if (this.run.counters.loopIterations >= MAX_LOOP_ITERATIONS) {
          throw new WorkflowError("Workflow loop safety limit reached", {
            code: "LOOP_LIMIT_REACHED"
          });
        }
        this.run.counters.loopIterations += 1;
        const body = node.step.config.body.map(
          (step2) => createExecutionNode(this.run, step2, {
            parentExecutionId: node.executionId,
            loopStepId: node.step.id,
            iteration: iteration + 1
          })
        );
        const nextLoop = createExecutionNode(this.run, node.step, {
          ...node.runtime,
          iteration: iteration + 1
        });
        this.run.nodes.splice(this.run.cursor + 1, 0, ...body, nextLoop);
        this._completeNode(node, {
          done: false,
          iteration: iteration + 1,
          inserted: body.length
        });
        this._record("LOOP_ITERATION_STARTED", {
          executionId: node.executionId,
          iteration: iteration + 1
        });
        await this._persist();
      } catch (error) {
        await this._handleStepError(node, error);
      }
    }
    async _executeDelay(node) {
      const durationMs = Number(node.step.config.durationMs) || 0;
      if (durationMs <= 0) {
        this._completeNode(node, { durationMs: 0 });
        await this._persist();
        return;
      }
      node.status = StepStatus.WAITING;
      node.waitUntil = this.now() + durationMs;
      node.result = { durationMs, wakeAt: node.waitUntil };
      this.run.status = RunStatus.WAITING;
      this._record("STEP_WAITING", {
        executionId: node.executionId,
        wakeAt: node.waitUntil
      });
      await this._persist();
    }
    async _executeHandler(node) {
      const gate = await this.modeGate({
        run: this.getSnapshot(),
        node: cloneSerializable(node)
      });
      if (!gate?.allowed) {
        node.status = StepStatus.WAITING;
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: gate?.code ?? "STEP_APPROVAL_REQUIRED",
          message: gate?.message ?? "Step approval is required.",
          executionId: node.executionId
        };
        this._record("STEP_GATED", this.run.pauseReason);
        await this._persist();
        return;
      }
      const handler = handlerFor(this.handlers, node.step.type);
      if (!handler) {
        await this._handleStepError(
          node,
          new WorkflowError(`No handler registered for ${node.step.type}`, {
            code: "STEP_HANDLER_MISSING"
          })
        );
        return;
      }
      const context = await this._getContext(node);
      let executionDispatched = false;
      try {
        if (!node.intent) {
          const prepared = await callHandlerMethod(handler, "prepare", {
            step: cloneSerializable(node.step),
            run: this.getSnapshot(),
            context
          });
          node.intent = {
            operationId: this.idFactory("workflow-operation"),
            stepId: node.step.id,
            type: node.step.type,
            preparedAt: this.now(),
            ...isPlainObject2(prepared) ? cloneSerializable(prepared) : {}
          };
          assertSerializable(node.intent, "Workflow step intent");
          this._record("STEP_INTENT_PREPARED", {
            executionId: node.executionId,
            operationId: node.intent.operationId
          });
          await this._persist();
        }
        if (this.operationScheduler?.preflight) {
          const scheduled = await this.operationScheduler.preflight({
            run: this.getSnapshot(),
            node: cloneSerializable(node),
            context
          });
          if (scheduled?.decision === "WAIT_UNTIL") {
            node.status = StepStatus.WAITING;
            node.waitUntil = Number(scheduled.waitUntil);
            this.run.status = RunStatus.WAITING;
            this.run.pauseReason = null;
            this._record("STEP_ACTIVITY_WAIT", {
              executionId: node.executionId,
              wakeAt: node.waitUntil,
              code: scheduled.code ?? "ACTIVITY_WAIT"
            });
            await this._persist();
            return;
          }
          if (scheduled?.decision !== "ALLOW") {
            node.status = StepStatus.PAUSED;
            this.run.status = RunStatus.PAUSED;
            this.run.pauseReason = {
              code: scheduled?.code ?? "ACTIVITY_GUARD_PAUSED",
              message: "Activity Guard paused this workflow before EA dispatch.",
              executionId: node.executionId
            };
            this._record("STEP_ACTIVITY_PAUSED", this.run.pauseReason);
            await this._persist();
            return;
          }
        }
        node.attempt += 1;
        node.status = StepStatus.RUNNING;
        node.startedAt = node.startedAt ?? this.now();
        node.error = null;
        this._record("STEP_STARTED", {
          executionId: node.executionId,
          attempt: node.attempt
        });
        await this._persist();
        if (isDestructive(node.step) && typeof this.repository.assertOwnership === "function") {
          await this.repository.assertOwnership(this.run.runId);
        }
        const abortController = typeof AbortController === "function" ? new AbortController() : null;
        executionDispatched = true;
        const execution = callHandlerMethod(handler, "execute", {
          step: cloneSerializable(node.step),
          intent: cloneSerializable(node.intent),
          run: this.getSnapshot(),
          context,
          attempt: node.attempt,
          signal: abortController?.signal ?? null
        });
        const outcome2 = await this._withTimeout(
          execution,
          node.step.timeoutMs,
          abortController
        );
        assertSerializable(outcome2, "Workflow step result");
        const outcomeStatus = String(outcome2?.status ?? "completed").toLowerCase();
        if (outcomeStatus === "waiting") {
          const activityOutcome = String(outcome2?.activityOutcome ?? "not_applied");
          await this._recordActivityOutcome(node, activityOutcome, outcome2?.code ?? "HANDLER_WAITING");
          node.status = StepStatus.WAITING;
          node.result = cloneSerializable(outcome2?.result ?? null);
          node.waitUntil = Number.isFinite(Number(outcome2?.resumeAt)) ? Number(outcome2.resumeAt) : null;
          this.run.status = RunStatus.WAITING;
          this._record("STEP_WAITING", { executionId: node.executionId, wakeAt: node.waitUntil });
        } else if (outcomeStatus === "paused") {
          const activityOutcome = String(
            outcome2?.activityOutcome ?? (isDestructive(node.step) ? "ambiguous" : "not_applied")
          );
          await this._recordActivityOutcome(node, activityOutcome, outcome2?.code ?? "HANDLER_PAUSED");
          node.status = StepStatus.PAUSED;
          node.result = cloneSerializable(outcome2?.result ?? null);
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: String(outcome2?.code ?? "HANDLER_PAUSED"),
            message: String(outcome2?.message ?? "Step paused by its handler.")
          };
          if (activityOutcome === "ambiguous" && isDestructive(node.step)) {
            node.status = StepStatus.FAILED;
            node.error = {
              code: String(outcome2?.code ?? "HANDLER_PAUSED_AMBIGUOUS"),
              message: String(outcome2?.message ?? "The dispatched action has an ambiguous post-state."),
              details: cloneSerializable(outcome2?.result ?? null),
              safeToRetry: false,
              ambiguous: true
            };
            this.run.counters.failed += 1;
            this._requireRecovery(node, {
              code: "DESTRUCTIVE_STEP_AMBIGUOUS",
              message: node.error.message
            });
            this._record("STEP_AMBIGUOUS", { executionId: node.executionId, error: node.error });
          }
        } else if (outcomeStatus === "skipped") {
          this._skipNode(node, outcome2?.result ?? null);
        } else if (outcomeStatus === "failed") {
          const error = new WorkflowError(outcome2?.message ?? "Step handler reported failure", {
            code: outcome2?.code ?? "STEP_FAILED",
            details: outcome2?.details ?? null
          });
          if (typeof outcome2?.safeToRetry === "boolean") {
            error.safeToRetry = outcome2.safeToRetry;
          }
          error.ambiguous = outcome2?.ambiguous === true;
          throw error;
        } else {
          this._completeNode(node, outcome2?.result ?? outcome2 ?? null);
          if (this.operationScheduler?.recordSuccess) {
            try {
              await this.operationScheduler.recordSuccess({
                run: this.getSnapshot(),
                node: cloneSerializable(node),
                outcome: cloneSerializable(outcome2)
              });
            } catch (schedulerError) {
              if (this.run.status !== RunStatus.COMPLETED) {
                this.run.status = RunStatus.PAUSED;
                this.run.pauseReason = {
                  code: "ACTIVITY_LEDGER_UNAVAILABLE",
                  message: "The verified action was preserved, but future work paused because activity evidence could not be recorded.",
                  executionId: node.executionId
                };
              }
            }
          }
        }
        await this._persist();
      } catch (error) {
        await this._handleStepError(node, error, { executionDispatched });
      }
    }
    async _handleStepError(node, error, { executionDispatched = false } = {}) {
      if (node.status !== StepStatus.RUNNING) node.attempt += 1;
      const normalized = normalizeError(error);
      const destructive = isDestructive(node.step);
      const ambiguous = executionDispatched && (normalized.ambiguous || destructive && normalized.safeToRetry !== true);
      const retryExplicitlyDenied = error?.safeToRetry === false;
      if (executionDispatched && this.operationScheduler?.recordFailure) {
        try {
          await this.operationScheduler.recordFailure({
            run: this.getSnapshot(),
            node: cloneSerializable(node),
            error: normalized,
            ambiguous
          });
        } catch {
          node.status = StepStatus.PAUSED;
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: "ACTIVITY_LEDGER_UNAVAILABLE",
            message: "Activity evidence could not be recorded, so no retry was allowed.",
            executionId: node.executionId
          };
          this._record("RUN_PAUSED_AFTER_ACTIVITY_FAILURE", this.run.pauseReason);
          await this._persist();
          return;
        }
      }
      node.error = normalized;
      this.run.lastError = {
        ...normalized,
        executionId: node.executionId,
        at: this.now()
      };
      if (ambiguous) {
        node.status = StepStatus.FAILED;
        this.run.counters.failed += 1;
        this._requireRecovery(node, {
          code: "DESTRUCTIVE_STEP_AMBIGUOUS",
          message: normalized.message
        });
        this._record("STEP_AMBIGUOUS", { executionId: node.executionId, error: normalized });
        await this._persist();
        return;
      }
      const policy = node.step.retryPolicy;
      const retryCodes = Array.isArray(policy.retryableCodes) ? policy.retryableCodes : [];
      const codeAllowed = retryCodes.length === 0 || retryCodes.includes(normalized.code);
      if (!retryExplicitlyDenied && node.attempt < policy.maxAttempts && codeAllowed) {
        const delayMs = calculateRetryDelay(policy, node.attempt);
        node.status = StepStatus.WAITING;
        node.waitUntil = this.now() + delayMs;
        this.run.status = RunStatus.WAITING;
        this._record("STEP_RETRY_SCHEDULED", {
          executionId: node.executionId,
          attempt: node.attempt,
          wakeAt: node.waitUntil,
          error: normalized
        });
        await this._persist();
        return;
      }
      this.run.counters.failed += 1;
      node.status = StepStatus.FAILED;
      node.completedAt = this.now();
      if (node.step.onFailure === OnFailure.SKIP) {
        node.status = StepStatus.SKIPPED;
        this.run.counters.skipped += 1;
        this.run.cursor += 1;
        this.run.status = RunStatus.RUNNING;
        this._record("STEP_SKIPPED_AFTER_FAILURE", { executionId: node.executionId, error: normalized });
      } else if (node.step.onFailure === OnFailure.STOP) {
        this.run.status = RunStatus.FAILED;
        this.run.completedAt = this.now();
        this._record("RUN_FAILED", { executionId: node.executionId, error: normalized });
      } else {
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "STEP_FAILED",
          message: normalized.message,
          executionId: node.executionId
        };
        this._record("RUN_PAUSED_AFTER_FAILURE", this.run.pauseReason);
      }
      await this._persist();
    }
    async _withTimeout(value, timeoutMs, abortController = null) {
      if (!this.setTimer || !this.clearTimer) return Promise.resolve(value);
      let timerId;
      try {
        return await Promise.race([
          Promise.resolve(value),
          new Promise((_, reject) => {
            timerId = this.setTimer(
              () => {
                abortController?.abort?.();
                reject(new WorkflowTimeoutError(timeoutMs));
              },
              timeoutMs
            );
          })
        ]);
      } finally {
        if (timerId != null) this.clearTimer(timerId);
      }
    }
    async _getContext(node, extra = {}) {
      const context = await this.contextProvider({
        run: this.getSnapshot(),
        node: cloneSerializable(node),
        ...extra
      });
      return isPlainObject2(context) ? context : {};
    }
    async _recordActivityOutcome(node, outcome2, code) {
      if (!this.operationScheduler) return;
      const event = {
        run: this.getSnapshot(),
        node: cloneSerializable(node),
        outcome: outcome2,
        code
      };
      if (this.operationScheduler.recordOutcome) {
        await this.operationScheduler.recordOutcome(event);
        return;
      }
      if (outcome2 === "verified" && this.operationScheduler.recordSuccess) {
        await this.operationScheduler.recordSuccess(event);
        return;
      }
      if (outcome2 === "not_applied" && this.operationScheduler.recordNotApplied) {
        await this.operationScheduler.recordNotApplied(event);
        return;
      }
      if (this.operationScheduler.recordFailure) {
        await this.operationScheduler.recordFailure({
          ...event,
          error: {
            code,
            safeToRetry: outcome2 === "transient_failure"
          },
          ambiguous: outcome2 === "ambiguous"
        });
      }
    }
    _completeNode(node, result) {
      node.status = StepStatus.COMPLETED;
      node.result = cloneSerializable(result ?? null);
      node.error = null;
      node.waitUntil = null;
      node.completedAt = this.now();
      this.run.counters.completed += 1;
      this.run.cursor += 1;
      this._record("STEP_COMPLETED", { executionId: node.executionId, type: node.step.type });
    }
    _skipNode(node, result) {
      node.status = StepStatus.SKIPPED;
      node.result = cloneSerializable(result ?? null);
      node.completedAt = this.now();
      this.run.counters.skipped += 1;
      this.run.cursor += 1;
      this._record("STEP_SKIPPED", { executionId: node.executionId, type: node.step.type });
    }
    _requireRecovery(node, reason) {
      this.run.status = RunStatus.RECOVERY_REQUIRED;
      this.run.pauseReason = {
        ...cloneSerializable(reason),
        executionId: node?.executionId ?? null
      };
    }
    _currentNode() {
      return this.run?.nodes?.[this.run.cursor] ?? null;
    }
    _requireRun() {
      if (!this.run) throw new WorkflowError("No workflow run is loaded", { code: "WORKFLOW_NOT_LOADED" });
    }
    _record(type, details = null) {
      if (!this.run) return;
      this.run.counters.transitions += 1;
      this.run.history.push({
        sequence: this.run.counters.transitions,
        at: this.now(),
        type,
        details: details == null ? null : cloneSerializable(details)
      });
      if (this.run.history.length > MAX_RUN_HISTORY) {
        this.run.history.splice(0, this.run.history.length - MAX_RUN_HISTORY);
      }
    }
    async _applyControlRequest() {
      if (!this.controlRequest || !this.run) return;
      const request = this.controlRequest;
      this.controlRequest = null;
      if (request.type === "stop") {
        this.run.status = RunStatus.STOPPED;
        this.run.completedAt = this.now();
        this.run.pauseReason = null;
        this._record("RUN_STOPPED", { reason: request.reason });
      } else {
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "USER_PAUSED",
          message: request.reason
        };
        this._record("RUN_PAUSED", this.run.pauseReason);
      }
      await this._persist();
    }
    async _persist() {
      this._requireRun();
      const expectedRevision = Number(this.run.revision) || 0;
      this.run.revision = expectedRevision + 1;
      this.run.updatedAt = this.now();
      assertSerializable(this.run, "Workflow run");
      try {
        await this.repository.saveRun(this.run, { expectedRevision });
      } catch (error) {
        this.run.revision = expectedRevision;
        throw error;
      }
      this._emit();
      return this.run;
    }
    _emit() {
      const snapshot = this.getSnapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          console.error("[GrindPilot] Workflow listener failed", error);
        }
      }
    }
  };

  // src/workflow/templates.js
  var step = (id, type, config = {}) => ({ id, type, config });
  var rewardCycle = (prefix = "cycle") => [
    step(`${prefix}-solve`, WorkflowStepType.SOLVE_SBC, { target: { kind: "CURRENT_OPEN_SBC" } }),
    step(`${prefix}-submit`, WorkflowStepType.SUBMIT_SBC),
    step(`${prefix}-claim`, WorkflowStepType.CLAIM_REWARD),
    step(`${prefix}-open`, WorkflowStepType.OPEN_REWARD_PACK),
    step(`${prefix}-pick`, WorkflowStepType.HANDLE_PLAYER_PICK),
    step(`${prefix}-resolve`, WorkflowStepType.RESOLVE_ITEMS)
  ];
  var loopTemplate = (id, name, body, iterations = 1) => normalizeWorkflowDefinition({
    id,
    name,
    version: 1,
    metadata: { template: id, safetyModel: "fail-closed" },
    steps: [step(`${id}-loop`, WorkflowStepType.LOOP, { maxIterations: iterations, body })]
  });
  var WORKFLOW_TEMPLATES = Object.freeze({
    SIMPLE_REPEATABLE_SBC: loopTemplate(
      "simple-repeatable-sbc",
      "Simple Repeatable SBC",
      rewardCycle("repeatable")
    ),
    REWARD_PACK_LOOP: loopTemplate(
      "reward-pack-loop",
      "Reward Pack Loop",
      rewardCycle("reward")
    ),
    PLAYER_PICK_GRIND: loopTemplate(
      "player-pick-grind",
      "Player Pick Grind",
      rewardCycle("pick-grind")
    ),
    DAILY_UPGRADE_CHAIN: loopTemplate(
      "daily-upgrade-chain",
      "Daily Upgrade Chain",
      [
        ...rewardCycle("daily-a"),
        step("daily-chain-pause", WorkflowStepType.PAUSE, {
          reason: "Open the next stable-ID SBC target before continuing the chain."
        })
      ]
    ),
    TARGET_SBC_GRIND: loopTemplate(
      "target-sbc-grind",
      "Target SBC Grind",
      rewardCycle("target")
    )
  });
  var listWorkflowTemplates = () => Object.entries(WORKFLOW_TEMPLATES).map(([id, workflow]) => ({
    id,
    name: workflow.name,
    workflow: structuredClone(workflow)
  }));
  var getWorkflowTemplate = (id) => {
    const workflow = WORKFLOW_TEMPLATES[String(id)];
    if (!workflow) throw new TypeError(`Unknown workflow template: ${String(id)}`);
    return structuredClone(workflow);
  };
  var importLegacySequence = (plan) => {
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
      throw new TypeError("A legacy Sequence plan is required");
    }
    const body = [];
    for (const [index, legacy] of plan.steps.filter((entry) => entry?.enabled !== false).entries()) {
      const target = legacy?.target || legacy;
      const setId = target?.setId == null ? null : String(target.setId);
      const challengeId = target?.challengeId == null ? null : String(target.challengeId);
      const legacyKind = String(target?.kind ?? "").trim().toLowerCase();
      const kind = legacyKind.includes("challenge") || challengeId && !setId ? "SPECIFIC_CHALLENGE" : legacyKind.includes("set") || setId ? "SPECIFIC_SET" : "CURRENT_OPEN_SBC";
      const solve = step(`legacy-${index + 1}-solve`, WorkflowStepType.SOLVE_SBC, {
        target: { kind, setId, challengeId },
        solverSettings: legacy?.settingsSnapshot || {}
      });
      const submit = step(`legacy-${index + 1}-submit`, WorkflowStepType.SUBMIT_SBC);
      const count = Math.max(1, Math.min(1e3, Math.trunc(Number(legacy?.loopCount) || 1)));
      body.push(
        count === 1 ? solve : step(`legacy-${index + 1}-loop`, WorkflowStepType.LOOP, {
          maxIterations: count,
          body: [solve, submit]
        })
      );
      if (count === 1) body.push(submit);
    }
    if (!body.length) throw new TypeError("Legacy Sequence has no enabled steps");
    const planLoops = Math.max(
      1,
      Math.min(1e3, Math.trunc(Number(plan?.policy?.planLoopCount) || 1))
    );
    return normalizeWorkflowDefinition({
      id: `legacy-${String(plan.id ?? "sequence")}`,
      name: `Imported: ${String(plan.name ?? "Legacy Sequence")}`,
      version: 1,
      metadata: { source: "legacy-sequence", legacyPlanId: plan.id ?? null },
      steps: planLoops === 1 ? body : [step("legacy-plan-loop", WorkflowStepType.LOOP, { maxIterations: planLoops, body })]
    });
  };

  // src/workflow/builder.js
  var clone3 = (value) => structuredClone(value);
  var newId = (type) => `${String(type).toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  var createWorkflowStep = (type = WorkflowStepType.SOLVE_SBC) => {
    const normalized = String(type).toUpperCase();
    const config = normalized === WorkflowStepType.LOOP ? { maxIterations: 1, body: [createWorkflowStep()] } : normalized === WorkflowStepType.CONDITIONAL ? {
      condition: {
        type: "COMPARE",
        left: { type: "PATH", path: "unresolvedUnassigned" },
        operator: "EQ",
        right: { type: "LITERAL", value: 0 }
      },
      thenSteps: [createWorkflowStep()],
      elseSteps: [{ id: newId("pause"), type: WorkflowStepType.PAUSE, config: { reason: "Condition was not satisfied" } }]
    } : normalized === WorkflowStepType.DELAY ? { durationMs: 1e3 } : normalized === WorkflowStepType.PAUSE ? { reason: "Paused by workflow" } : normalized === WorkflowStepType.SOLVE_SBC ? { target: { kind: "CURRENT_OPEN_SBC" } } : {};
    return { id: newId(normalized), type: normalized, config, timeoutMs: 12e4, retryPolicy: { maxAttempts: 1, delayMs: 500, backoffFactor: 2, maxDelayMs: 3e4, retryableCodes: [] }, onFailure: "PAUSE" };
  };
  var getArray = (workflow, path = []) => {
    let steps = workflow.steps;
    for (const segment of path) {
      const step2 = steps[segment.index];
      if (!step2) throw new TypeError("Workflow builder path is stale");
      steps = step2.config?.[segment.branch];
      if (!Array.isArray(steps)) throw new TypeError("Workflow builder branch is invalid");
    }
    return steps;
  };
  var mutateWorkflowSteps = (workflow, path, mutation) => {
    const next = clone3(workflow);
    const steps = getArray(next, path);
    mutation(steps);
    return next;
  };
  var addWorkflowStep = (workflow, path = [], type) => mutateWorkflowSteps(workflow, path, (steps) => steps.push(createWorkflowStep(type)));
  var deleteWorkflowStep = (workflow, path, index) => mutateWorkflowSteps(workflow, path, (steps) => steps.splice(index, 1));
  var moveWorkflowStep = (workflow, path, index, direction) => mutateWorkflowSteps(workflow, path, (steps) => {
    const target = index + (direction < 0 ? -1 : 1);
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
  });
  var duplicateWorkflowStep = (workflow, path, index) => mutateWorkflowSteps(workflow, path, (steps) => {
    const copy = clone3(steps[index]);
    const renew = (entry) => {
      entry.id = newId(entry.type);
      for (const branch of ["body", "thenSteps", "elseSteps"]) {
        for (const child of entry.config?.[branch] || []) renew(child);
      }
    };
    renew(copy);
    steps.splice(index + 1, 0, copy);
  });
  var finalizeWorkflowDraft = (workflow) => normalizeWorkflowDefinition(workflow);

  // src/grindpilot-main.js
  var VERSION = globalThis.document?.documentElement?.dataset?.eaDataExtensionVersion || "unknown";
  var ACTIVITY_SESSION_STORAGE_KEY = "grindpilot.activity-session.v1";
  var ACTIVITY_MINIMUM_SPACING_MS = 1500;
  var newActivitySessionId = () => typeof globalThis.crypto?.randomUUID === "function" ? `session:${globalThis.crypto.randomUUID()}` : `session:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  var resolveActivitySession = ({ explicitId = null, sessionStore = void 0 } = {}) => {
    if (explicitId != null) return { sessionId: String(explicitId), restorable: true };
    let store = sessionStore;
    if (store === void 0) {
      try {
        store = globalThis.sessionStorage;
      } catch {
        store = null;
      }
    }
    try {
      const existing = store?.getItem?.(ACTIVITY_SESSION_STORAGE_KEY);
      if (/^session:[A-Za-z0-9._:-]{1,152}$/.test(String(existing ?? ""))) {
        return { sessionId: String(existing), restorable: true };
      }
      const sessionId = newActivitySessionId();
      store?.setItem?.(ACTIVITY_SESSION_STORAGE_KEY, sessionId);
      if (store?.getItem?.(ACTIVITY_SESSION_STORAGE_KEY) === sessionId) {
        return { sessionId, restorable: true };
      }
    } catch {
    }
    return { sessionId: newActivitySessionId(), restorable: false };
  };
  var outcome = (result) => ({ status: "completed", result });
  var latestResult = (run, type) => [...run?.nodes ?? []].reverse().find(
    (node) => node.step?.type === type && node.status === "completed"
  )?.result ?? null;
  var ownedItemId = (item) => String(item?.itemId ?? item?.id ?? "");
  var inventoryItemIds = (raw = {}) => new Set(
    [
      ...raw?.club ?? [],
      ...raw?.storage ?? [],
      ...raw?.unassigned ?? []
    ].map(ownedItemId).filter(Boolean)
  );
  var packCount = (packs = [], packId2) => (Array.isArray(packs) ? packs : []).reduce(
    (sum, pack) => String(pack?.packId ?? pack?.id ?? "") === String(packId2) ? sum + Math.max(0, Number(pack?.count ?? 1) || 0) : sum,
    0
  );
  var sameStringSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
  var recovery = (status, result = null, message = null) => ({
    status,
    result,
    ...message ? { error: { message } } : {}
  });
  var buildInventoryBuckets = (items = []) => {
    const labels = ["75–79", "80–84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94+"];
    const result = Object.fromEntries(labels.map((label) => [label, { club: 0, storage: 0, unassigned: 0 }]));
    const labelFor = (rating) => {
      if (rating >= 94) return "94+";
      if (rating >= 85) return String(rating);
      if (rating >= 80) return "80–84";
      if (rating >= 75) return "75–79";
      return null;
    };
    for (const item of items) {
      const label = labelFor(Math.trunc(Number(item?.rating) || 0));
      const location2 = item?.location === "sbc_storage" ? "storage" : item?.location;
      if (label && result[label] && Object.hasOwn(result[label], location2)) result[label][location2] += 1;
    }
    return result;
  };
  var buildWorkflow = (config) => ({
    id: "reward-grind-loop",
    name: "Reward Grind Loop",
    version: 1,
    metadata: { source: "grindpilot-ui", safetyModel: "fail-closed" },
    steps: [{
      id: "grind-loop",
      type: WorkflowStepType.LOOP,
      config: {
        maxIterations: config.maxIterations,
        body: [
          { id: "solve-sbc", type: WorkflowStepType.SOLVE_SBC, timeoutMs: 12e4, retryPolicy: { maxAttempts: 2, delayMs: 800, retryableCodes: ["EA_OPERATION_UNAVAILABLE"] } },
          { id: "submit-sbc", type: WorkflowStepType.SUBMIT_SBC, timeoutMs: 3e4 },
          { id: "claim-reward", type: WorkflowStepType.CLAIM_REWARD, timeoutMs: 3e4 },
          { id: "open-reward", type: WorkflowStepType.OPEN_REWARD_PACK, timeoutMs: 45e3 },
          { id: "handle-player-pick", type: WorkflowStepType.HANDLE_PLAYER_PICK, timeoutMs: 3e4 },
          { id: "resolve-items", type: WorkflowStepType.RESOLVE_ITEMS, timeoutMs: 45e3 }
        ]
      }
    }]
  });
  var GrindPilotRuntime = class {
    constructor(options = {}) {
      this.storage = options.storage ?? new PageStorageArea();
      this.adapter = options.adapter ?? new ControllerAdapter();
      this.inventory = options.inventory ?? new InventoryService();
      this.routingEngine = options.routingEngine ?? new RoutingEngine();
      const activitySession = resolveActivitySession({
        explicitId: options.activitySessionId,
        sessionStore: options.activitySessionStorage
      });
      this.activitySessionId = activitySession.sessionId;
      this.activitySessionRestorable = activitySession.restorable;
      this.activityLedger = options.activityLedger ?? new ActivityLedger({ maxEvents: 5e3 });
      this.logger = options.logger ?? new ActivityLogger({ maxEntries: 500 });
      this.targets = options.targets ?? new TargetProjectService();
      this.enableUi = options.enableUi !== false;
      this.enableActivityPersistence = options.enableActivityPersistence !== false;
      this.activityLedgerPersistenceSupported = this.enableActivityPersistence && typeof this.storage.loadActivityLedger === "function" && typeof this.storage.saveActivityLedger === "function";
      this.activityEvidenceAvailable = !this.activityLedgerPersistenceSupported || this.activitySessionRestorable;
      this.confirm = options.confirm ?? ((message) => globalThis.window?.confirm?.(message) === true);
      const runtimeRoot = options.root ?? globalThis.window ?? globalThis;
      const runtimeOrigin = options.origin ?? globalThis.location?.origin ?? "https://example.invalid";
      this.profileService = new ProfileService({
        repository: options.profileRepository ?? new ChromeStorageProfileRepository(this.storage)
      });
      this.dev = options.dev ?? createDeveloperMode({
        root: runtimeRoot,
        extensionVersion: VERSION,
        capabilityDefinitions: [
          { id: "ea-bridge", path: "eaData.grindPilot", requiredMethods: ["getHealth", "solveCurrentSbc", "submitCurrentSbc"] }
        ],
        allowedNetworkOrigins: [runtimeOrigin]
      });
      this.listeners = /* @__PURE__ */ new Set();
      this.drivePromise = null;
      this.inventoryRefreshPromise = null;
      this.inventoryRefreshEpoch = 0;
      this.inventoryRefreshQueuedPromise = null;
      this.inventoryRefreshQueuedAfterEpoch = 0;
      this.inventoryAvailable = false;
      this.sbcPlanCache = /* @__PURE__ */ new Map();
      this.duplicateRoutePlanCache = /* @__PURE__ */ new Map();
      this.duplicateRouteApprovalInFlight = false;
      this.wakeTimer = null;
      this.config = this.defaultConfig();
      this.state = {
        bridgeHealth: "checking",
        runStatus: "idle",
        currentStep: null,
        iterations: 0,
        maxIterations: 0,
        sbcCompleted: 0,
        packsOpened: 0,
        duplicatesRecycled: 0,
        protectedCardsSaved: 0,
        storageCount: 0,
        storageCapacity: 100,
        unassignedCount: 0,
        inventory: {},
        logs: [],
        profiles: [],
        projects: [],
        diagnostics: { enabled: false },
        draft: this.config,
        targetDashboard: [],
        solveDetails: null,
        picksCompleted: 0,
        workflowDraft: buildWorkflow(this.config),
        workflowTemplates: listWorkflowTemplates().map(({ id, name }) => ({ id, name })),
        legacySequences: [],
        inventoryBuckets: buildInventoryBuckets(),
        timeline: [],
        capabilityHealth: [],
        analytics: summarizeRunAnalytics(null),
        currentContext: null,
        contextObservedAt: null,
        inventoryAvailable: false,
        gameVersion: GameVersion.UNKNOWN,
        gameVersionObservation: "unverified",
        gameVersionSource: "none",
        runName: null,
        runModeLabel: null,
        productRevision: 0,
        legacyPanelOpen: false,
        sbcPlanPreviews: {},
        sbcPlanNotices: {},
        duplicateRoutePlan: null,
        duplicateRouteNotice: null,
        routerRecommendation: null,
        routerRecommendationNotice: null,
        fodderReviewPlan: null,
        pauseReason: null,
        error: null
      };
      this.inventoryFacade = {
        getState: async () => ({ unassigned: this.inventory.getSnapshot().unassigned.items }),
        refresh: async () => this.refreshInventory({ requireNewer: true })
      };
      this.rewardService = new RewardService({ adapter: this.adapter, logger: this.domainLogger() });
      this.packService = new PackService({ adapter: this.adapter, inventoryService: this.inventoryFacade, logger: this.domainLogger() });
      this.playerPickService = new PlayerPickService({
        adapter: this.adapter,
        logger: this.domainLogger()
      });
      this.operationScheduler = options.operationScheduler ?? new OperationScheduler({
        ledger: this.activityLedger,
        activityContextProvider: () => ({
          // EA does not expose a verified persona identifier. This opaque browser
          // session partition is restored only within the same tab session.
          personaKey: this.activityEvidenceAvailable ? this.activitySessionId : "",
          gameVersion: String(this.state.gameVersion || GameVersion.UNKNOWN).toLowerCase(),
          sessionId: this.activitySessionId
        }),
        minimumSpacingMs: options.minimumActivitySpacingMs ?? ACTIVITY_MINIMUM_SPACING_MS,
        failureThreshold: 3,
        persistSnapshot: (snapshot) => this.persistActivityLedger(snapshot)
      });
      this.engine = new WorkflowEngine({
        repository: options.workflowRepository ?? new PageWorkflowRepository(this.storage),
        handlers: this.createHandlers(),
        contextProvider: () => this.conditionContext(),
        modeGate: (input) => this.evaluateRunGate(input),
        operationScheduler: this.operationScheduler
      });
      this.engineUnsubscribe = null;
      this.logger.subscribe(() => {
        this.state.logs = this.logger.entries();
        if (this.enableActivityPersistence) this.persistActivity();
        this.emit();
      });
    }
    defaultConfig() {
      return {
        mode: WorkflowMode.REVIEW,
        maxIterations: 1,
        storageCapacity: 100,
        protectRatingAtOrAbove: 94,
        protectedCardTypes: ["FOF"],
        protectedItemIds: [],
        protectedPlayerIds: [],
        protectedResourceIds: [],
        protectStartingSquad: true,
        protectFavorites: true,
        protectTradables: false,
        preferUntradeables: true,
        preferDuplicates: true,
        preferSbcStorage: true,
        minimumReserveByRating: {},
        packMode: "OPEN_CURRENT_REWARD",
        maxPacks: 1,
        organizerTargetProjectId: null,
        pickMode: "PAUSE_FOR_USER",
        workflow: null,
        runLimits: { maxIterations: 1 },
        stopConditions: []
      };
    }
    createFodderPolicy() {
      return new FodderPolicy({
        protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
        protectedCardTypes: this.config.protectedCardTypes,
        allowedSpecialTypes: this.config.allowedSpecialTypes,
        protectedItemIds: this.config.protectedItemIds || [],
        protectedPlayerIds: this.config.protectedPlayerIds || [],
        protectedResourceIds: this.config.protectedResourceIds || [],
        protectedRatings: this.config.protectedRatings || [],
        protectStartingSquad: this.config.protectStartingSquad === true,
        protectFavorites: this.config.protectFavorites === true,
        protectTradables: this.config.protectTradables === true,
        preferUntradeables: this.config.preferUntradeables !== false,
        preferDuplicates: this.config.preferDuplicates !== false,
        preferSbcStorage: this.config.preferSbcStorage !== false,
        minimumReserveByRating: this.config.minimumReserveByRating || {},
        specialReserveByCardType: this.config.specialReserveByCardType || {}
      }, { targetProjects: this.targets });
    }
    domainLogger() {
      return { info: (action, data) => this.logger.info(action, action, data), warn: (action, data) => this.logger.warn(action, action, data) };
    }
    invalidateRouterRecommendation(message = null) {
      const hadRecommendation = Boolean(this.state.routerRecommendation);
      this.state.routerRecommendation = null;
      if (hadRecommendation && message) {
        this.state.routerRecommendationNotice = String(message);
      }
    }
    invalidateDuplicateRoutePreview(message = null) {
      const hadPreview = Boolean(this.state.duplicateRoutePlan);
      this.duplicateRoutePlanCache?.clear?.();
      this.state.duplicateRoutePlan = null;
      if (hadPreview && message) {
        this.state.duplicateRouteNotice = String(message);
      }
    }
    invalidateGameSemanticPlans(message = null) {
      const hadSbcPreviews = this.sbcPlanCache.size > 0 || Object.keys(this.state.sbcPlanPreviews || {}).length > 0;
      this.sbcPlanCache.clear();
      this.state.sbcPlanPreviews = {};
      if (hadSbcPreviews && message) {
        this.state.sbcPlanNotices = Object.fromEntries(
          Object.keys(this.state.sbcPlanNotices || {}).map((key) => [key, String(message)])
        );
      }
      this.state.fodderReviewPlan = null;
      this.invalidateDuplicateRoutePreview(message);
      this.invalidateRouterRecommendation(message);
    }
    async refreshGameContext() {
      const previous = this.state.currentContext || null;
      let observed = null;
      try {
        const raw = await this.adapter.getContext();
        let gameVersion = GameVersion.UNKNOWN;
        try {
          gameVersion = normalizeGameVersion(raw?.gameVersion);
        } catch {
        }
        observed = {
          route: raw?.route == null ? null : String(raw.route),
          setId: raw?.setId == null ? null : String(raw.setId),
          setName: raw?.setName == null ? null : String(raw.setName),
          challengeId: raw?.challengeId == null ? null : String(raw.challengeId),
          challengeName: raw?.challengeName == null ? null : String(raw.challengeName),
          challengeKind: raw?.challengeKind == null ? null : String(raw.challengeKind),
          gameVersion,
          gameVersionObservation: ["observed", "compatibility_default"].includes(raw?.gameVersionObservation) ? raw.gameVersionObservation : gameVersion === GameVersion.UNKNOWN ? "unverified" : "observed",
          gameVersionSource: raw?.gameVersionSource == null ? "none" : String(raw.gameVersionSource)
        };
      } catch {
        observed = {
          gameVersion: GameVersion.UNKNOWN,
          gameVersionObservation: "unverified",
          gameVersionSource: "none"
        };
      }
      this.state.currentContext = observed;
      this.state.gameVersion = observed.gameVersion;
      this.state.gameVersionObservation = observed.gameVersionObservation;
      this.state.gameVersionSource = observed.gameVersionSource;
      this.state.contextObservedAt = Date.now();
      const beforeKey = previous && JSON.stringify([
        previous.gameVersion,
        previous.gameVersionObservation,
        previous.gameVersionSource,
        previous.challengeKind,
        previous.setId,
        previous.challengeId
      ]);
      const afterKey = JSON.stringify([
        observed.gameVersion,
        observed.gameVersionObservation,
        observed.gameVersionSource,
        observed.challengeKind,
        observed.setId,
        observed.challengeId
      ]);
      if (beforeKey && beforeKey !== afterKey) {
        this.invalidateGameSemanticPlans(
          "The observed EA game context changed. Preview again before approving anything."
        );
      }
      return this.currentGameContext();
    }
    currentRouterActivityGuard() {
      const run = this.engine?.getSnapshot?.();
      if (!run || [RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(run.status)) {
        return {
          state: RouterActivityGuardState.IDLE,
          evidence: { runStatus: run?.status || "idle" }
        };
      }
      if (Object.values(RunStatus).includes(run.status)) {
        return {
          state: RouterActivityGuardState.NON_IDLE,
          evidence: { runStatus: run.status, currentStep: run.nodes?.[run.cursor]?.step?.type || null }
        };
      }
      return {
        state: RouterActivityGuardState.UNKNOWN,
        evidence: { runStatus: String(run.status || "unknown") }
      };
    }
    async initialize() {
      await this.restoreActivityLedger();
      await this.loadPersistentState();
      await this.refreshStatus();
      const active = await this.engine.load();
      if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
        await this.engine.recover(active.runId);
        this.logger.warn("Recovery", "Recovered a suspended run at a safe boundary", { runId: active.runId });
      }
      this.engineUnsubscribe = this.engine.subscribe((run) => this.onRun(run));
      if (this.engine.getSnapshot()) this.onRun(this.engine.getSnapshot());
      if (this.enableUi) {
        this.panel = new GrindPanel(this);
        this.surfaceActions = new EaSurfaceActions(this);
        this.runHud = new RunHud(this);
      }
      this.emit();
    }
    async loadPersistentState() {
      const stored = await this.storage.loadBootstrap();
      for (const entry of Array.isArray(stored.activity) ? stored.activity : []) {
        this.logger.log(entry.level || "info", entry.action || "Restored", entry.message || "", entry.data ?? null);
      }
      const projects = Array.isArray(stored.projects) ? stored.projects : [];
      this.targets = new TargetProjectService(projects);
      this.state.projects = this.targets.list();
      this.config = {
        ...this.defaultConfig(),
        ...stored.settings || {},
        // This is a non-configurable invariant: active-squad cards are never fodder.
        protectStartingSquad: true
      };
      this.state.storageCapacity = Math.max(1, Math.min(100, Math.trunc(this.config.storageCapacity || 100)));
      this.state.draft = this.config;
      this.state.workflowDraft = structuredClone(
        this.config.workflow || buildWorkflow(this.config)
      );
      this.state.profiles = await this.profileService.list();
    }
    createHandlers() {
      return {
        [WorkflowStepType.SOLVE_SBC]: {
          execute: async ({ run, step: step2 }) => {
            const target = step2?.config?.target || { kind: "CURRENT_OPEN_SBC" };
            const context = await this.adapter.getContext();
            if (target.kind === "SPECIFIC_CHALLENGE" && (String(context?.challengeId ?? "") !== String(target.challengeId ?? "") || target.setId != null && String(context?.setId ?? "") !== String(target.setId ?? ""))) {
              return {
                status: "paused",
                activityOutcome: "not_applied",
                code: "SBC_TARGET_NOT_OPEN",
                message: "Open the workflow's stable challenge ID before continuing.",
                result: { target, observed: context }
              };
            }
            if (target.kind === "SPECIFIC_SET" && String(context?.setId ?? "") !== String(target.setId ?? "")) {
              return {
                status: "paused",
                activityOutcome: "not_applied",
                code: "SBC_TARGET_NOT_OPEN",
                message: "Open the workflow's stable SBC set ID before continuing.",
                result: { target, observed: context }
              };
            }
            await this.refreshInventory();
            const policy = this.createFodderPolicy();
            const inventoryItems = this.inventory.getSnapshot().items;
            const analysis = policy.analyze(inventoryItems);
            this.currentProtectedItemIds = analysis.protectedItemIds;
            const solved = await this.adapter.solveCurrentSbc({
              previewOnly: run.mode === WorkflowMode.REVIEW,
              protectedItemIds: analysis.protectedItemIds,
              conservationPolicy: {
                ...policy.toSolverConservationPolicy(),
                protectedItemIds: analysis.protectedItemIds
              },
              prioritize: {
                duplicates: this.config.preferDuplicates !== false,
                untradeables: this.config.preferUntradeables !== false,
                storage: this.config.preferSbcStorage !== false
              },
              solverSettings: {
                ...this.config.solverSettings || {},
                ...step2?.config?.solverSettings || {}
              }
            });
            if (target.kind === "SPECIFIC_CHALLENGE" && (String(solved?.challengeId ?? "") !== String(target.challengeId ?? "") || target.setId != null && String(solved?.setId ?? "") !== String(target.setId ?? ""))) {
              const error = new Error("The solved squad no longer matches the approved SBC challenge");
              error.code = "SBC_TARGET_CHANGED_DURING_SOLVE";
              throw error;
            }
            const explanation = policy.explainSelection(
              solved.solutionIds,
              inventoryItems
            );
            const selectedIds = new Set((solved.solutionIds ?? []).map(String));
            const selectedItems = inventoryItems.filter((item) => selectedIds.has(String(item.itemId))).map((item) => ({ itemId: item.itemId, rating: item.rating }));
            const protectedIds = new Set(analysis.protectedItemIds.map(String));
            if ([...selectedIds].some((id) => protectedIds.has(id))) {
              const error = new Error("The solved squad contains a protected card");
              error.code = "PROTECTED_ITEM_SELECTED";
              throw error;
            }
            if (selectedIds.size !== 11 || selectedItems.length !== 11) {
              const error = new Error("The solved squad is not a verified 11-card Club selection");
              error.code = "SOLUTION_ITEMS_UNOBSERVED";
              throw error;
            }
            this.state.protectedCardsSaved = analysis.protectedItemIds.length;
            this.state.solveDetails = explanation;
            this.logger.info("Solve", "Verified squad solution", {
              challengeId: solved.challengeId,
              protected: analysis.protectedItemIds.length,
              explanation: explanation.explanations,
              objectiveTuple: solved?.stats?.conservationObjectiveTuple ?? explanation.objectiveTuple
            });
            return outcome({
              ...solved,
              protectedItemIds: analysis.protectedItemIds,
              explanation,
              selectedItems
            });
          }
        },
        [WorkflowStepType.SUBMIT_SBC]: {
          prepare: ({ run }) => {
            const solved = latestResult(run, WorkflowStepType.SOLVE_SBC);
            if (!solved?.submitReady) throw Object.assign(new Error("No submit-ready verified solution"), { code: "SOLUTION_NOT_READY", safeToRetry: true });
            return { expectedChallengeId: solved.challengeId, expectedSetId: solved.setId ?? null, expectedItemIds: solved.solutionIds, protectedItemIds: solved.protectedItemIds || [] };
          },
          execute: async ({ intent }) => {
            const result = await this.adapter.submitCurrentSbc(intent);
            await this.recordVerifiedTargetCompletion(intent);
            this.logger.info("Submit", "SBC submission verified", { challengeId: intent.expectedChallengeId });
            return outcome(result);
          },
          recover: async ({ node }) => {
            const intent = node?.intent ?? {};
            if (typeof this.adapter.reconcileSubmit === "function") {
              return this.adapter.reconcileSubmit(intent);
            }
            let project = null;
            try {
              project = await this.adapter.readCurrentSbcProject();
            } catch {
            }
            const challenge = project?.challenges?.find(
              (entry) => String(entry?.id ?? "") === String(intent.expectedChallengeId ?? "")
            );
            if (challenge?.completed === true) {
              await this.recordVerifiedTargetCompletion(intent);
              return recovery("completed", { challengeId: intent.expectedChallengeId });
            }
            let observed;
            let context;
            try {
              [observed, context] = await Promise.all([
                this.adapter.readInventory(),
                this.adapter.getContext()
              ]);
            } catch (error) {
              return recovery("ambiguous", null, error?.message || "SBC post-state is unavailable");
            }
            const ids = inventoryItemIds(observed);
            const expected = (intent.expectedItemIds ?? []).map(String);
            const present = expected.filter((id) => ids.has(id));
            if (expected.length > 0 && present.length === 0 && (context?.challengeCompleted === true || String(context?.challengeId ?? "") !== String(intent.expectedChallengeId ?? ""))) {
              await this.recordVerifiedTargetCompletion(intent);
              return recovery("completed", { challengeId: intent.expectedChallengeId });
            }
            if (present.length === expected.length && String(context?.challengeId ?? "") === String(intent.expectedChallengeId ?? "") && context?.challengeCompleted !== true) {
              return recovery("not_applied");
            }
            return recovery("ambiguous", null, "SBC submission post-state is mixed or inconclusive");
          }
        },
        [WorkflowStepType.CLAIM_REWARD]: {
          prepare: async () => ({ packsBefore: await this.adapter.listOwnedPacks() }),
          execute: async ({ intent, node }) => {
            const reward = await this.rewardService.claimAndIdentify(
              { source: "current-sbc" },
              intent.packsBefore,
              {
                operationId: node?.executionId || "reward-claim",
                inventoryGeneration: this.inventory.getSnapshot().generation
              }
            );
            this.logger.info("Reward", "Reward claimed and pack identified", { packId: reward.identifiedPackId });
            return outcome(reward);
          },
          recover: async ({ node }) => {
            const intent = node?.intent ?? {};
            if (typeof this.adapter.reconcileRewardClaim === "function") {
              return this.adapter.reconcileRewardClaim(intent);
            }
            try {
              const packsAfter = await this.adapter.listOwnedPacks();
              const pack = identifyClaimedRewardPack({
                packsBefore: intent.packsBefore ?? [],
                packsAfter
              });
              return recovery("completed", {
                identifiedPackId: String(pack?.packId ?? pack?.id ?? ""),
                pack
              });
            } catch (error) {
              const beforeTotal = (intent.packsBefore ?? []).reduce(
                (sum, pack) => sum + Number(pack?.count ?? 1),
                0
              );
              let packsAfter = [];
              try {
                packsAfter = await this.adapter.listOwnedPacks();
              } catch {
              }
              const afterTotal = packsAfter.reduce(
                (sum, pack) => sum + Number(pack?.count ?? 1),
                0
              );
              if (afterTotal === beforeTotal) {
                return recovery("ambiguous", null, "Reward availability cannot be proven after interruption");
              }
              return recovery("ambiguous", null, error?.message || "Reward claim post-state is ambiguous");
            }
          }
        },
        [WorkflowStepType.OPEN_REWARD_PACK]: {
          prepare: async ({ run, step: step2 }) => {
            const reward = latestResult(run, WorkflowStepType.CLAIM_REWARD);
            const quickOpen = step2?.config?.quickOpen === true;
            const quickPackId = String(step2?.config?.packId ?? "");
            const plan = await this.packService.plan({
              policy: quickOpen ? {
                mode: "OPEN_ALL_ALLOWED_PACKS",
                maxPacks: 1,
                allowedPackIds: quickPackId ? [quickPackId] : []
              } : { mode: this.config.packMode, maxPacks: this.config.maxPacks || 1 },
              currentReward: quickOpen ? null : reward
            });
            if (plan.packs.length !== 1) {
              throw Object.assign(new Error("Exactly one verified owned reward pack is required"), {
                code: "PACK_PLAN_AMBIGUOUS"
              });
            }
            const inventoryBefore = await this.adapter.readInventory();
            return {
              plan,
              packBinding: reward?.packBinding ?? null,
              packId: String(plan.packs[0]?.packId ?? plan.packs[0]?.id ?? ""),
              packsBefore: await this.adapter.listOwnedPacks(),
              inventoryItemIdsBefore: [...inventoryItemIds(inventoryBefore)]
            };
          },
          execute: async ({ intent }) => {
            const opened = await this.packService.openPlan(intent.plan);
            const packOpened = Array.isArray(opened.opened) && opened.opened.length > 0;
            const expectedUnassignedStop = packOpened && opened.reason === "UNASSIGNED_BLOCKING";
            if (!packOpened || opened.status !== "completed" && !expectedUnassignedStop) {
              return { status: "paused", activityOutcome: "not_applied", code: opened.reason || "PACK_NOT_OPENED", message: "Reward pack opening requires attention", result: opened };
            }
            const beforeIds = new Set((intent.inventoryItemIdsBefore ?? []).map(String));
            const receivedItems = this.inventory.getSnapshot().items.filter((item) => !beforeIds.has(String(item.itemId))).map((item) => ({ itemId: item.itemId, rating: item.rating }));
            const postPackSnapshot = this.inventory.getSnapshot();
            const postPackProtection = this.createFodderPolicy().analyze(postPackSnapshot.items);
            const postPackRoutingPlan = this.routingEngine.plan({
              inventorySnapshot: postPackSnapshot,
              duplicateRelations: this.inventory.getDuplicateRelations(),
              ruleset: { schemaVersion: 1, id: "fut-magic.default", rules: [] },
              protectionAnalysis: postPackProtection,
              activityGuard: this.operationScheduler.currentGuard({
                stepType: WorkflowStepType.RESOLVE_ITEMS
              })
            });
            this.logger.info("Pack", "Reward pack opened", { packId: opened.opened[0].packId });
            return outcome({ ...opened, receivedItems, postPackRoutingPlan });
          },
          recover: async ({ node }) => {
            const intent = node?.intent ?? {};
            if (typeof this.adapter.reconcilePackOpen === "function") {
              return this.adapter.reconcilePackOpen(intent);
            }
            try {
              const [packsAfter, inventoryAfter] = await Promise.all([
                this.adapter.listOwnedPacks(),
                this.adapter.readInventory()
              ]);
              const beforeCount = packCount(intent.packsBefore, intent.packId);
              const afterCount = packCount(packsAfter, intent.packId);
              const beforeIds = new Set((intent.inventoryItemIdsBefore ?? []).map(String));
              const afterIds = inventoryItemIds(inventoryAfter);
              const addedIds = [...afterIds].filter((id) => !beforeIds.has(id));
              if (beforeCount - afterCount === 1 && addedIds.length > 0) {
                const receivedItems = [
                  ...inventoryAfter.club ?? [],
                  ...inventoryAfter.storage ?? [],
                  ...inventoryAfter.unassigned ?? []
                ].filter((item) => addedIds.includes(ownedItemId(item))).map((item) => ({ itemId: ownedItemId(item), rating: Number(item?.rating) || 0 }));
                return recovery("completed", {
                  packId: intent.packId,
                  itemIds: addedIds,
                  receivedItems
                });
              }
              if (beforeCount === afterCount && sameStringSet(beforeIds, afterIds)) {
                return recovery("not_applied");
              }
              return recovery("ambiguous", null, "Owned-pack and inventory evidence do not agree");
            } catch (error) {
              return recovery("ambiguous", null, error?.message || "Pack post-state is unavailable");
            }
          }
        },
        [WorkflowStepType.RESOLVE_ITEMS]: {
          prepare: async ({ step: step2 }) => {
            const approvedBoundary = Array.isArray(step2?.config?.approvedRouteActions);
            if (approvedBoundary) await this.refreshStatus();
            else await this.refreshInventory();
            const resolutionPolicy = approvedBoundary ? { ...step2.config.resolutionPolicy } : {
              preferSbcStorage: this.config.preferSbcStorage !== false,
              tradableWhenStorageUnavailable: "SAFE_HOLD",
              untradeableWhenStorageUnavailable: "PAUSE"
            };
            const plan = this.inventory.planUnassignedResolution(resolutionPolicy);
            const currentRouteActions = canonicalDuplicateRouteActions(plan.actions);
            const currentUnassignedItemIds = this.inventory.getSnapshot().unassigned.items.map((item) => String(item.itemId)).sort();
            if (approvedBoundary) {
              const capabilities = buildRuntimeCapabilityRegistry(this.state.capabilityHealth).require([
                ...DUPLICATE_ROUTE_READ_CAPABILITIES,
                ...DUPLICATE_ROUTE_MOVE_CAPABILITIES
              ]);
              if (!capabilities.ok) {
                const error = new Error(
                  "A required EA item-move capability changed after approval"
                );
                error.code = "DUPLICATE_CAPABILITY_CHANGED";
                error.notApplied = true;
                error.safeToRetry = false;
                throw error;
              }
              const approvedRouteActions = canonicalDuplicateRouteActions(
                step2.config.approvedRouteActions
              );
              const expectedUnassignedItemIdsBefore = [
                ...step2.config.expectedUnassignedItemIdsBefore || []
              ].map(String).sort();
              if (JSON.stringify(currentRouteActions) !== JSON.stringify(approvedRouteActions) || JSON.stringify(currentUnassignedItemIds) !== JSON.stringify(expectedUnassignedItemIdsBefore)) {
                const error = new Error(
                  "Unassigned items or their safe destinations changed after approval"
                );
                error.code = "DUPLICATE_PLAN_STALE";
                error.notApplied = true;
                error.safeToRetry = false;
                throw error;
              }
            }
            const allowPartial = step2?.config?.allowPartial === true;
            const expectedActions = approvedBoundary ? canonicalDuplicateRouteActions(step2.config.approvedActions || []) : allowPartial ? plan.actions.filter(
              (action) => ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(action.type)
            ) : plan.actions;
            return {
              plan,
              expectedActions,
              allowPartial,
              allowUnresolved: step2?.config?.allowUnresolved === true,
              approvedBoundary,
              expectedUnassignedItemIdsBefore: approvedBoundary ? [...step2.config.expectedUnassignedItemIdsBefore] : null,
              expectedRemainingItemIdsAfter: approvedBoundary ? [...step2.config.expectedRemainingItemIdsAfter] : null,
              actionSetFingerprint: approvedBoundary ? String(step2.config.actionSetFingerprint || "") : null
            };
          },
          execute: async ({ intent }) => {
            if (intent?.plan?.requiresUserAction && !intent?.allowPartial && !intent?.approvedBoundary) {
              return {
                status: "paused",
                activityOutcome: "not_applied",
                code: "UNASSIGNED_USER_ACTION_REQUIRED",
                message: "The persisted duplicate plan requires a user decision; no item was moved.",
                result: intent.plan
              };
            }
            const result = await this.adapter.resolveUnassigned({
              storageCapacity: this.state.storageCapacity,
              expectedActions: intent.expectedActions,
              allowPartial: intent.allowPartial === true,
              expectedUnassignedItemIdsBefore: intent.expectedUnassignedItemIdsBefore,
              expectedRemainingItemIdsAfter: intent.expectedRemainingItemIdsAfter,
              actionSetFingerprint: intent.actionSetFingerprint
            });
            await this.refreshInventory();
            if (result.unresolvedUnassigned > 0 && !intent?.allowUnresolved) {
              this.logger.warn("Duplicate", "Unresolved items require user action", { count: result.unresolvedUnassigned });
              return { status: "paused", activityOutcome: "verified", code: "UNRESOLVED_UNASSIGNED", message: `${result.unresolvedUnassigned} unassigned item(s) require a safe policy decision`, result };
            }
            this.logger.info("Duplicate", "Unassigned items resolved safely", { storage: result.movedToStorage?.length || 0 });
            return outcome(result);
          },
          recover: async ({ node }) => {
            const intent = node?.intent ?? {};
            if (typeof this.adapter.reconcileUnassignedResolution === "function") {
              return this.adapter.reconcileUnassignedResolution(intent);
            }
            try {
              const observed = await this.adapter.readInventory();
              const byLocation = {
                club: new Set((observed.club ?? []).map(ownedItemId)),
                sbc_storage: new Set((observed.storage ?? []).map(ownedItemId)),
                unassigned: new Set((observed.unassigned ?? []).map(ownedItemId))
              };
              const actions = (intent.expectedActions ?? []).filter(
                (action) => ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(action?.type)
              );
              if (!actions.length) return recovery("completed", { movedToClub: [], movedToStorage: [] });
              const atDestination = actions.filter(
                (action) => byLocation[action.to]?.has(String(action.itemId))
              ).length;
              const stillUnassigned = actions.filter(
                (action) => byLocation.unassigned.has(String(action.itemId))
              ).length;
              if (atDestination === actions.length) {
                if (Array.isArray(intent.expectedRemainingItemIdsAfter)) {
                  const expectedRemaining = new Set(
                    intent.expectedRemainingItemIdsAfter.map(String)
                  );
                  if (!sameStringSet(byLocation.unassigned, expectedRemaining)) {
                    return recovery(
                      "ambiguous",
                      null,
                      "Moved items reached their destinations, but the remaining Unassigned set changed"
                    );
                  }
                }
                return recovery("completed", {
                  movedToClub: actions.filter((action) => action.to === "club").map((action) => action.itemId),
                  movedToStorage: actions.filter((action) => action.to === "sbc_storage").map((action) => action.itemId)
                });
              }
              if (stillUnassigned === actions.length) {
                if (Array.isArray(intent.expectedUnassignedItemIdsBefore)) {
                  const expectedBefore = new Set(
                    intent.expectedUnassignedItemIdsBefore.map(String)
                  );
                  if (!sameStringSet(byLocation.unassigned, expectedBefore)) {
                    return recovery(
                      "ambiguous",
                      null,
                      "Approved items remain, but the complete Unassigned set changed"
                    );
                  }
                }
                return recovery("not_applied");
              }
              return recovery("ambiguous", null, "Unassigned resolution is partial or items are missing");
            } catch (error) {
              return recovery("ambiguous", null, error?.message || "Unassigned post-state is unavailable");
            }
          }
        },
        [WorkflowStepType.ORGANIZE_ITEMS]: {
          prepare: async ({ step: step2 }) => {
            await this.refreshInventory();
            const snapshot = this.inventory.getSnapshot();
            const unassigned = snapshot.unassigned.items;
            const approved = step2?.config?.approvedRecycle ?? null;
            const target = approved ? {
              targetId: String(approved.target?.targetId ?? ""),
              name: String(approved.target?.targetId ?? "Approved duplicate recipe"),
              setId: String(approved.target?.setId ?? ""),
              challengeId: String(approved.target?.challengeId ?? "")
            } : null;
            const exactSolutionItemIds = approved ? [...approved.exactSolutionItemIds ?? []].map(String) : null;
            const blockingItemIds = approved ? [...approved.requiredItemIds ?? []].map(String) : null;
            if (approved) {
              const uniqueSolution = new Set(exactSolutionItemIds);
              const uniqueBlocking = new Set(blockingItemIds);
              const currentIds = new Set(snapshot.items.map((item) => String(item.itemId)));
              const currentUnassignedIds = new Set(unassigned.map((item) => String(item.itemId)));
              const currentInventoryFingerprint = fingerprintDuplicateRecycleInventory(snapshot);
              const currentProjectFingerprint = fingerprintDuplicateRecycleProjects(this.targets.list());
              const [currentSet, currentCapabilities] = await Promise.all([
                this.adapter.readCurrentSbcProject(),
                this.adapter.getCapabilityHealth()
              ]);
              const currentChallenge = (currentSet?.challenges ?? []).find(
                (challenge) => String(challenge?.id ?? "") === target.challengeId
              );
              const requirementsVerified = String(currentSet?.setId ?? "") === target.setId && currentChallenge && currentChallenge.completed !== true && Array.isArray(currentChallenge.unknownRequirements) && currentChallenge.unknownRequirements.length === 0;
              const currentRequirementsFingerprint = requirementsVerified ? fingerprintDuplicateRecycleRequirement({ setId: currentSet.setId, challenge: currentChallenge }) : null;
              const currentCapabilityFingerprint = fingerprintDuplicateRecycleCapabilities(currentCapabilities);
              const invalid = !target.setId || !target.challengeId || exactSolutionItemIds.length !== 11 || uniqueSolution.size !== 11 || blockingItemIds.length === 0 || uniqueBlocking.size !== blockingItemIds.length || blockingItemIds.some((id) => !uniqueSolution.has(id)) || exactSolutionItemIds.some((id) => !currentIds.has(id)) || blockingItemIds.some((id) => !currentUnassignedIds.has(id));
              if (invalid) {
                const error = new Error("The approved duplicate recipe no longer references one exact available squad");
                error.code = "DUPLICATE_RECIPE_STALE";
                error.notApplied = true;
                error.safeToRetry = false;
                throw error;
              }
              if (String(approved.inventoryFingerprint ?? "") !== currentInventoryFingerprint || String(approved.projectFingerprint ?? "") !== currentProjectFingerprint || String(approved.requirementsFingerprint ?? "") !== currentRequirementsFingerprint || String(approved.capabilityFingerprint ?? "") !== currentCapabilityFingerprint) {
                const error = new Error("Inventory, Target Projects, requirements, or capabilities changed after duplicate-recipe approval");
                error.code = "DUPLICATE_RECIPE_EVIDENCE_CHANGED";
                error.notApplied = true;
                error.safeToRetry = false;
                throw error;
              }
            }
            const requiredItemIds = approved ? exactSolutionItemIds : unassigned.map((item) => String(item.itemId));
            if (!requiredItemIds.length) return { requiredItemIds: [], target: null };
            if (requiredItemIds.length > 11) {
              const error = new Error(
                "More than 11 cards remain unassigned; Organizer will not consume only a partial batch"
              );
              error.code = "ORGANIZER_TOO_MANY_ITEMS";
              throw error;
            }
            const resolvedTarget = target ?? await this.getOrganizerTarget();
            const policy = new FodderPolicy({
              protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
              protectedCardTypes: this.config.protectedCardTypes,
              protectedItemIds: this.config.protectedItemIds || [],
              protectedPlayerIds: this.config.protectedPlayerIds || [],
              protectedResourceIds: this.config.protectedResourceIds || [],
              protectStartingSquad: this.config.protectStartingSquad === true,
              protectFavorites: this.config.protectFavorites === true,
              protectTradables: this.config.protectTradables === true,
              minimumReserveByRating: this.config.minimumReserveByRating || {}
            }, { targetProjects: this.targets });
            const analysis = policy.analyze(snapshot.items);
            const protectedIds = new Set(analysis.protectedItemIds.map(String));
            const protectedRequiredItemIds = requiredItemIds.filter((id) => protectedIds.has(id));
            if (protectedRequiredItemIds.length) {
              const error = new Error(
                "At least one remaining unassigned card is protected; no SBC was submitted"
              );
              error.code = "ORGANIZER_PROTECTED_ITEM";
              error.details = { protectedRequiredItemIds };
              throw error;
            }
            return {
              target: resolvedTarget,
              requiredItemIds,
              blockingItemIds,
              approvedRecycle: Boolean(approved),
              protectedItemIds: analysis.protectedItemIds,
              solverSettings: { ...this.config.solverSettings || {}, useUnassigned: true }
            };
          },
          execute: async ({ intent }) => {
            if (!intent?.requiredItemIds?.length) {
              return outcome({ organizedItemIds: [], noOp: true });
            }
            const result = await this.adapter.organizeIntoSbc({
              setId: intent.target.setId,
              challengeId: intent.target.challengeId,
              requiredItemIds: intent.requiredItemIds,
              protectedItemIds: intent.protectedItemIds,
              solverSettings: intent.solverSettings
            });
            await this.recordVerifiedTargetCompletion({
              expectedSetId: result.setId ?? intent.target.setId,
              expectedChallengeId: result.challengeId ?? intent.target.challengeId
            });
            await this.refreshInventory();
            const remaining = new Set(
              this.inventory.getSnapshot().unassigned.items.map((item) => String(item.itemId))
            );
            const stillUnassigned = intent.requiredItemIds.filter((id) => remaining.has(String(id)));
            if (stillUnassigned.length) {
              return {
                status: "paused",
                activityOutcome: "ambiguous",
                code: "ORGANIZER_POST_STATE_UNVERIFIED",
                message: "Organizer could not verify that every required card was consumed",
                result: { ...result, stillUnassigned }
              };
            }
            this.logger.info("Organizer", "Remaining cards consumed in selected SBC", {
              target: intent.target.name,
              count: intent.requiredItemIds.length
            });
            return outcome({ ...result, organizedItemIds: intent.requiredItemIds });
          },
          recover: async ({ node }) => {
            const intent = node?.intent ?? {};
            try {
              const [observed, challengeState] = await Promise.all([
                this.adapter.readInventory(),
                this.adapter.readSbcChallengeState({
                  setId: intent.target?.setId,
                  challengeId: intent.target?.challengeId
                })
              ]);
              const ids = inventoryItemIds(observed);
              const expected = (intent.requiredItemIds ?? []).map(String);
              const present = expected.filter((id) => ids.has(id));
              if (!expected.length || present.length === 0 && challengeState?.completed === true) {
                await this.recordVerifiedTargetCompletion({
                  expectedSetId: intent.target?.setId,
                  expectedChallengeId: intent.target?.challengeId
                });
                return recovery("completed", { organizedItemIds: expected });
              }
              if (present.length === expected.length && challengeState?.available === true && challengeState?.completed === false) {
                return recovery("not_applied");
              }
              return recovery("ambiguous", null, "Organizer required-card post-state is mixed");
            } catch (error) {
              return recovery("ambiguous", null, error?.message || "Organizer post-state is unavailable");
            }
          }
        },
        [WorkflowStepType.HANDLE_PLAYER_PICK]: {
          prepare: async ({ run }) => {
            const decision = await this.playerPickService.handle({
              policy: this.currentPickPolicy(),
              context: this.playerPickContext(),
              execute: false
            });
            const inventoryItems = this.inventory.getSnapshot().items;
            const selectedResourceId = decision.intent?.selectedResourceId ?? null;
            const pickIntent = decision.intent ? {
              ...decision.intent,
              inventoryItemIdsBefore: inventoryItems.map((item) => item.itemId),
              selectedResourceCountBefore: selectedResourceId ? inventoryItems.filter(
                (item) => String(item.resourceId ?? "") === String(selectedResourceId)
              ).length : 0
            } : null;
            return {
              pickIntent,
              decisionStatus: decision.status,
              decisionReason: decision.reason,
              reviewOnly: run.mode === WorkflowMode.REVIEW
            };
          },
          execute: async ({ intent, run }) => {
            if (!intent?.pickIntent) {
              if (intent?.decisionReason === "PICK_ALREADY_RESOLVED") {
                return outcome({ pending: false });
              }
              return {
                status: "paused",
                activityOutcome: "not_applied",
                code: intent?.decisionReason || "PLAYER_PICK_UNVERIFIED",
                message: "Player-pick offers are unavailable, incomplete, or ambiguous. No selection was made.",
                result: { policy: this.currentPickPolicy() }
              };
            }
            const decision = await this.playerPickService.handle({
              pickId: intent.pickIntent.pickIdentity,
              policy: this.currentPickPolicy(),
              context: this.playerPickContext(),
              execute: run.mode !== WorkflowMode.REVIEW,
              approved: run.mode !== WorkflowMode.REVIEW,
              expectedIntent: intent.pickIntent
            });
            if (decision.status === "completed" || run.mode === WorkflowMode.REVIEW && decision.status === "selected") {
              if (decision.status === "completed") this.state.picksCompleted = Number(this.state.picksCompleted || 0) + 1;
              return outcome({ ...decision, reviewOnly: run.mode === WorkflowMode.REVIEW });
            }
            return {
              status: "paused",
              activityOutcome: decision.reason === "PICK_SELECTION_UNVERIFIED" ? "ambiguous" : "not_applied",
              code: decision.reason || "PLAYER_PICK_USER_REQUIRED",
              message: `Player pick paused safely: ${decision.reason || "no unique verified selection"}.`,
              result: decision
            };
          },
          recover: async ({ node }) => {
            const result = await this.playerPickService.recover(
              node?.intent?.pickIntent,
              { ...this.playerPickContext(), inventoryItems: this.inventory.getSnapshot().items }
            );
            return result;
          }
        }
      };
    }
    async recordVerifiedTargetCompletion(intent = {}) {
      const updated = this.targets.markVerifiedChallengeCompleted({
        setId: intent.expectedSetId,
        challengeId: intent.expectedChallengeId
      });
      if (!updated) return null;
      this.state.projects = this.targets.list();
      let items = [];
      try {
        items = this.inventory.getSnapshot().items;
      } catch {
      }
      this.state.targetDashboard = this.targets.getDashboard(items);
      await this.storage.saveProjects(this.state.projects);
      return updated;
    }
    async restoreActivityLedger() {
      if (!this.activityLedgerPersistenceSupported) return;
      if (!this.activitySessionRestorable) {
        this.activityEvidenceAvailable = false;
        return;
      }
      try {
        const snapshot = await this.storage.loadActivityLedger(this.activitySessionId);
        if (snapshot != null) this.activityLedger.restore(snapshot);
      } catch (error) {
        this.activityEvidenceAvailable = false;
        this.logger.warn("Activity Guard", "Stored activity evidence could not be verified", {
          code: error?.code || "ACTIVITY_LEDGER_RESTORE_FAILED"
        });
      }
    }
    async persistActivityLedger(snapshot) {
      if (!this.activityLedgerPersistenceSupported) return true;
      if (!this.activityEvidenceAvailable) {
        const error = new Error("Activity evidence is unavailable");
        error.code = "ACTIVITY_EVIDENCE_UNAVAILABLE";
        throw error;
      }
      await this.storage.saveActivityLedger(this.activitySessionId, snapshot);
      return true;
    }
    currentGameContext({ requireSbcTarget = false } = {}) {
      const observed = this.state.currentContext || {};
      let gameVersion = GameVersion.UNKNOWN;
      try {
        gameVersion = normalizeGameVersion(observed.gameVersion ?? this.state.gameVersion);
      } catch {
      }
      const verified = this.state.bridgeHealth === "healthy" && gameVersion === GameVersion.FC26 && ["observed", "compatibility_default"].includes(
        observed.gameVersionObservation ?? this.state.gameVersionObservation
      ) && (!requireSbcTarget || Boolean(observed.setId) && Boolean(observed.challengeId));
      return createGameContext({
        gameVersion,
        state: verified ? "verified" : "unverified",
        challengeKind: observed.challengeKind,
        gameVersionObservation: observed.gameVersionObservation ?? this.state.gameVersionObservation,
        gameVersionSource: observed.gameVersionSource ?? this.state.gameVersionSource,
        route: observed.route,
        setId: observed.setId,
        setName: observed.setName,
        challengeId: observed.challengeId,
        challengeName: observed.challengeName,
        observedAt: Number(this.state.contextObservedAt || Date.now())
      });
    }
    currentSbcGameContext() {
      return this.currentGameContext({ requireSbcTarget: true });
    }
    async requireFc26PlanningContext({ requireSbcTarget = false } = {}) {
      await this.refreshGameContext();
      const context = this.currentGameContext({ requireSbcTarget });
      if (context.gameVersion !== GameVersion.FC26 || context.state !== "verified") {
        const error = new Error(context.gameVersion === GameVersion.FC27 ? "FC 27 planning is observe-only in this build" : "The active EA game version could not be verified for planning");
        error.code = context.gameVersion === GameVersion.FC27 ? "GAME_VERSION_UNSUPPORTED" : "GAME_CONTEXT_UNVERIFIED";
        throw error;
      }
      return context;
    }
    buildDuplicateRouteEvidence() {
      const inventorySnapshot = this.inventory.getSnapshot();
      const policy = {
        ...DUPLICATE_ROUTE_POLICY,
        preferSbcStorage: this.config.preferSbcStorage !== false
      };
      const resolutionPlan = this.inventory.planUnassignedResolution(policy);
      const capabilityRegistry = buildRuntimeCapabilityRegistry(this.state.capabilityHealth);
      if (!this.inventoryAvailable) {
        capabilityRegistry.declare("ea.inventory.read", {
          state: "unavailable",
          reason: "A current Club snapshot is unavailable"
        });
        capabilityRegistry.declare("ea.unassigned.read", {
          state: "unavailable",
          reason: "A current Unassigned snapshot is unavailable"
        });
      }
      const capabilitySnapshot = capabilityRegistry.snapshot();
      const gameContext = this.currentGameContext();
      const routingPlan = this.routingEngine.plan({
        inventorySnapshot,
        duplicateRelations: this.inventory.getDuplicateRelations(),
        ruleset: { schemaVersion: 1, id: "fut-magic.default", rules: [] },
        activityGuard: this.currentRouterActivityGuard()
      });
      const summary = summarizeDuplicateRoute({ plan: resolutionPlan, inventorySnapshot });
      const fingerprints = buildDuplicateRouteFingerprints({
        gameContext,
        inventorySnapshot,
        capabilitySnapshot,
        policy,
        routeActions: summary.routeActions
      });
      return {
        inventorySnapshot,
        policy,
        resolutionPlan,
        routingPlan,
        summary,
        capabilityRegistry,
        capabilitySnapshot,
        gameContext,
        fingerprints
      };
    }
    async previewDuplicateRoute() {
      await this.refreshStatus();
      const evidence = this.buildDuplicateRouteEvidence();
      const protectionPolicy = this.createFodderPolicy();
      const protectionAnalysis = protectionPolicy.analyze(evidence.inventorySnapshot.items);
      const routerRecommendation = recommendRouterNextAction({
        inventorySnapshot: evidence.inventorySnapshot,
        routeSummary: evidence.summary,
        capabilitySnapshot: evidence.capabilitySnapshot,
        gameContext: evidence.gameContext,
        activityGuard: this.currentRouterActivityGuard(),
        protectionAnalysis: {
          protectedItemIds: [...protectionAnalysis.protectedItemIds].map(String).sort(),
          reasonsByItemId: protectionAnalysis.reasonsByItemId,
          activeTargetProjectIds: [...protectionAnalysis.activeTargetProjectIds].map(String).sort()
        },
        conservationPolicy: protectionPolicy.toSolverConservationPolicy(),
        duplicatePolicy: evidence.policy,
        observedAt: Number(evidence.inventorySnapshot.updatedAt || this.state.contextObservedAt || Date.now())
      });
      const strategy = async () => {
        const { summary, fingerprints } = evidence;
        const blockers = [...summary.blockers];
        if (summary.totalCount > 0 && summary.safeCount === 0) {
          blockers.push({
            code: "NO_SAFE_ROUTE",
            message: "No current Unassigned item has a verified safe destination."
          });
        }
        const requiredCapabilities = summary.safeCount > 0 ? [...DUPLICATE_ROUTE_READ_CAPABILITIES, ...DUPLICATE_ROUTE_MOVE_CAPABILITIES] : DUPLICATE_ROUTE_READ_CAPABILITIES;
        return {
          requiredCapabilities,
          blockers,
          fingerprints,
          explanation: [
            "Only the listed moves to Club or SBC Storage can run.",
            "SBC submission, pack opening, and quicksell are outside this plan."
          ],
          preview: {
            ...summary,
            status: blockers.length ? "blocked" : summary.status,
            safetyBoundary: "SAFE_ITEM_MOVES_ONLY"
          },
          steps: blockers.length || summary.safeCount === 0 ? [] : [{
            type: "CALL_EXISTING_SERVICE",
            service: "workflow",
            command: "RESOLVE_APPROVED_UNASSIGNED",
            approvedActions: summary.approvedActions,
            routeActions: summary.routeActions,
            expectedUnassignedItemIdsBefore: summary.expectedUnassignedItemIdsBefore,
            expectedRemainingItemIdsAfter: summary.expectedRemainingItemIdsAfter,
            actionSetFingerprint: summary.actionSetFingerprint
          }]
        };
      };
      strategy.requiredCapabilities = DUPLICATE_ROUTE_READ_CAPABILITIES;
      const compiler = new PlanCompiler({
        capabilityRegistry: evidence.capabilityRegistry,
        entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
        strategies: { [GoalKind.CLEAR_DUPLICATES]: strategy },
        compilerVersion: 2
      });
      const goal = createGoal({
        kind: GoalKind.CLEAR_DUPLICATES,
        intent: "Preview one bounded safe route for current Unassigned items",
        inputs: { policyVersion: evidence.policy.schemaVersion },
        createdAt: 0
      });
      const plan = await compiler.compile(goal, evidence.gameContext);
      this.duplicateRoutePlanCache.clear();
      this.duplicateRoutePlanCache.set(plan.id, plan);
      this.state.duplicateRoutePlan = plan;
      this.state.duplicateRouteNotice = null;
      this.state.routerRecommendation = routerRecommendation;
      this.state.routerRecommendationNotice = null;
      this.logger.info("Duplicate Preview", plan.state === "ready" ? "Built a safe duplicate route preview; no cards were changed" : "Duplicate route preview blocked safely", {
        planId: plan.id,
        safeMoves: plan.preview?.safeCount || 0,
        attention: plan.preview?.attentionCount || 0,
        blockerCodes: plan.blockers.map((blocker) => blocker.code),
        routerState: routerRecommendation.state,
        routerKind: routerRecommendation.outcome.kind,
        routerReason: routerRecommendation.outcome.reasonCode
      });
      this.emit();
      return plan;
    }
    buildFodderReviewEvidence() {
      const inventorySnapshot = this.inventory.getSnapshot();
      const items = inventorySnapshot.items || [];
      const verifiedWhenComplete = (field) => items.length > 0 && items.every((item) => item?.[field] === true) ? "verified" : "unverified";
      const startingSquadState = verifiedWhenComplete("hasStartingSquadEvidence");
      const sourceEvidence = {
        schemaVersion: 1,
        fields: {
          locked: verifiedWhenComplete("hasLockedEvidence"),
          protected: verifiedWhenComplete("hasProtectedEvidence"),
          favorite: verifiedWhenComplete("hasFavoriteEvidence"),
          special: verifiedWhenComplete("hasSpecialEvidence"),
          tradability: verifiedWhenComplete("hasTradabilityEvidence"),
          startingSquad: startingSquadState
        },
        activeSquadProtection: {
          state: startingSquadState,
          mode: "per_item_flag"
        },
        loansIncluded: false
      };
      const capabilityRegistry = buildRuntimeCapabilityRegistry(this.state.capabilityHealth);
      if (!this.inventoryAvailable) {
        capabilityRegistry.declare("ea.inventory.read", {
          state: "unavailable",
          reason: "A current Club snapshot is unavailable"
        });
      }
      return {
        inventorySnapshot,
        policy: this.createFodderPolicy(),
        targetProjects: this.targets,
        capabilityRegistry,
        capabilitySnapshot: capabilityRegistry.snapshot(),
        gameContext: this.currentGameContext(),
        sourceEvidence
      };
    }
    async previewFodderReview() {
      await this.refreshStatus();
      const evidence = this.buildFodderReviewEvidence();
      const strategy = async () => buildFodderReview(evidence);
      strategy.requiredCapabilities = FODDER_REVIEW_CAPABILITIES;
      const compiler = new PlanCompiler({
        capabilityRegistry: evidence.capabilityRegistry,
        entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
        strategies: { [GoalKind.OPTIMIZE_FODDER]: strategy },
        compilerVersion: 2
      });
      const goal = createGoal({
        kind: GoalKind.OPTIMIZE_FODDER,
        intent: "Review current card protection and local squad preferences",
        inputs: { scope: "current_inventory", reviewSchemaVersion: 1 },
        createdAt: 0
      });
      const plan = await compiler.compile(goal, evidence.gameContext);
      this.state.fodderReviewPlan = plan;
      this.logger.info("Card protection", plan.state === "ready" ? "Reviewed current protection; no cards were changed" : "Protection review is unavailable with current evidence", {
        planId: plan.id,
        verificationState: plan.preview?.verificationState || "blocked",
        protectedCount: plan.preview?.uniqueHardProtectedCount ?? null,
        blockerCodes: plan.blockers.map((blocker) => blocker.code)
      });
      this.emit();
      return plan;
    }
    async approveDuplicateRoute(planId) {
      if (this.duplicateRouteApprovalInFlight) {
        const error = new Error("A duplicate-route approval is already being checked");
        error.code = "DUPLICATE_APPROVAL_IN_FLIGHT";
        throw error;
      }
      this.duplicateRouteApprovalInFlight = true;
      try {
        const expected = this.duplicateRoutePlanCache.get(String(planId || ""));
        if (!expected || expected.id !== String(planId || "") || expected.state !== "ready" || expected.preview?.safeCount <= 0 || expected.preview?.safetyBoundary !== "SAFE_ITEM_MOVES_ONLY") {
          const error = new Error("Preview the safe duplicate route again before approving it");
          error.code = "DUPLICATE_PLAN_NOT_APPROVABLE";
          throw error;
        }
        const active = this.engine.getSnapshot();
        if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
          const error = new Error("Finish or stop the active run before moving these items");
          error.code = "WORKFLOW_ALREADY_ACTIVE";
          throw error;
        }
        await this.refreshStatus();
        const current = this.buildDuplicateRouteEvidence();
        const comparison = compareDuplicateRouteFingerprints(
          expected.fingerprints,
          current.fingerprints
        );
        if (!comparison.ok || current.summary.actionSetFingerprint !== expected.preview.actionSetFingerprint) {
          this.duplicateRoutePlanCache.clear();
          this.state.duplicateRoutePlan = null;
          this.state.duplicateRouteNotice = "Unassigned items, destinations, or EA capabilities changed. Preview again.";
          this.invalidateRouterRecommendation(
            "Unassigned items, destinations, or EA capabilities changed. Nothing moved."
          );
          this.logger.warn("Duplicate Approval", "Stale duplicate route rejected", {
            changedEvidence: comparison.changed
          });
          this.emit();
          return { started: false, stale: true, changed: comparison.changed };
        }
        const preview = expected.preview;
        const definition = {
          id: `fut-magic-duplicates-${expected.id}`,
          name: `Move ${preview.safeCount} safe item${preview.safeCount === 1 ? "" : "s"}`,
          version: 1,
          metadata: {
            source: "fut-magic-duplicate-route",
            planId: expected.id,
            safetyModel: "exact-refresh-verify-move"
          },
          steps: [{
            id: "approved-safe-item-moves",
            type: WorkflowStepType.RESOLVE_ITEMS,
            config: {
              approvedActions: preview.approvedActions,
              approvedRouteActions: preview.routeActions,
              expectedUnassignedItemIdsBefore: preview.expectedUnassignedItemIdsBefore,
              expectedRemainingItemIdsAfter: preview.expectedRemainingItemIdsAfter,
              resolutionPolicy: current.policy,
              actionSetFingerprint: preview.actionSetFingerprint,
              allowPartial: false,
              allowUnresolved: preview.expectedRemainingItemIdsAfter.length > 0
            },
            timeoutMs: 45e3,
            retryPolicy: { maxAttempts: 1 },
            onFailure: "PAUSE"
          }]
        };
        this.state.maxIterations = 1;
        await this.engine.start(definition, {
          mode: WorkflowMode.AUTO,
          approval: createAutoApproval(definition)
        });
        this.duplicateRoutePlanCache.clear();
        this.state.duplicateRoutePlan = null;
        this.state.duplicateRouteNotice = null;
        this.invalidateRouterRecommendation();
        this.state.routerRecommendationNotice = null;
        this.logger.info("Duplicate Approval", "Approved one exact set of safe item moves", {
          planId: expected.id,
          safeMoves: preview.safeCount
        });
        queueMicrotask(() => this.drive());
        this.emit();
        return { started: true, runId: this.engine.getSnapshot()?.runId || null };
      } finally {
        this.duplicateRouteApprovalInFlight = false;
      }
    }
    buildSbcPlanningEvidence(projectId) {
      const project = this.targets.list().find((candidate) => String(candidate.id) === String(projectId));
      if (!project) {
        const error = new Error("The selected Target Project no longer exists");
        error.code = "PROJECT_NOT_FOUND";
        throw error;
      }
      const inventorySnapshot = this.inventory.getSnapshot();
      const policy = this.createFodderPolicy();
      const analysis = policy.analyze(inventorySnapshot.items);
      const policySnapshot = {
        protectedItemIds: [...analysis.protectedItemIds].map(String).sort(),
        reasonsByItemId: analysis.reasonsByItemId,
        activeTargetProjectIds: [...analysis.activeTargetProjectIds].map(String).sort(),
        conservationPolicy: policy.toSolverConservationPolicy()
      };
      const capabilityRegistry = buildRuntimeCapabilityRegistry(
        this.state.capabilityHealth
      );
      if (!this.inventoryAvailable) {
        capabilityRegistry.declare("ea.inventory.read", {
          state: "unavailable",
          reason: "A current Club snapshot is unavailable"
        });
      }
      const capabilitySnapshot = capabilityRegistry.snapshot();
      const gameContext = this.currentSbcGameContext();
      const fingerprints = buildSbcPlanFingerprints({
        gameContext,
        inventorySnapshot,
        project,
        policySnapshot,
        capabilitySnapshot
      });
      return {
        project,
        inventorySnapshot,
        policy,
        analysis,
        capabilityRegistry,
        capabilitySnapshot,
        gameContext,
        fingerprints
      };
    }
    async previewSbcProject(projectId) {
      await this.refreshStatus();
      const evidence = this.buildSbcPlanningEvidence(projectId);
      const strategy = async () => {
        const { project, gameContext, inventorySnapshot, policy, analysis, fingerprints } = evidence;
        const challenge = projectChallengeForContext(project, gameContext);
        const blockers = [];
        if (String(project.sourceSetId || "") !== String(gameContext.setId || "")) {
          blockers.push({
            code: "OPEN_PROJECT_REQUIRED",
            message: "Open this project's SBC set in EA before previewing a squad."
          });
        } else if (!challenge) {
          blockers.push({
            code: "CURRENT_CHALLENGE_NOT_IN_PROJECT",
            message: "The open challenge is not mapped to this Target Project."
          });
        } else if (challenge.completed) {
          blockers.push({
            code: "CHALLENGE_COMPLETED",
            message: "The open challenge is already complete."
          });
        } else if (challenge.unknownRequirements?.length) {
          blockers.push({
            code: "UNKNOWN_REQUIREMENTS",
            message: "EA exposed requirements that FUT Magic cannot verify safely.",
            count: challenge.unknownRequirements.length
          });
        }
        const basePreview = {
          status: blockers.length ? "blocked" : "planning",
          projectId: project.id,
          setId: project.sourceSetId,
          challengeId: challenge?.id || gameContext.challengeId,
          challengeName: challenge?.name || gameContext.challengeName || "Open challenge",
          targetRating: challenge?.requiredSquadRating ?? null
        };
        if (blockers.length) {
          return {
            requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
            blockers,
            fingerprints,
            preview: basePreview
          };
        }
        let solution;
        try {
          solution = await this.adapter.solveCurrentSbc({
            previewOnly: true,
            protectedItemIds: analysis.protectedItemIds,
            conservationPolicy: {
              ...policy.toSolverConservationPolicy(),
              protectedItemIds: analysis.protectedItemIds
            },
            prioritize: {
              duplicates: this.config.preferDuplicates !== false,
              untradeables: this.config.preferUntradeables !== false,
              storage: this.config.preferSbcStorage !== false
            },
            solverSettings: { ...this.config.solverSettings || {} }
          });
        } catch (error) {
          return {
            requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
            blockers: [{
              code: String(error?.code || "NO_VERIFIED_SOLUTION"),
              message: String(error?.message || "No verified squad solution is available.")
            }],
            fingerprints,
            preview: { ...basePreview, status: "blocked" }
          };
        }
        const summary = summarizeSbcSolution({
          solution,
          inventorySnapshot,
          protectedItemIds: analysis.protectedItemIds
        });
        if (!summary.solved || summary.selectedCount !== 11) {
          blockers.push({
            code: "NO_VERIFIED_SOLUTION",
            message: "The solver did not return a submit-ready 11-card squad."
          });
        }
        if (summary.unobservedItemIds.length) {
          blockers.push({
            code: "SOLUTION_ITEMS_UNOBSERVED",
            message: "The preview referenced cards outside the current Club snapshot."
          });
        }
        if (summary.protectedViolations.length) {
          blockers.push({
            code: "PROTECTED_ITEM_SELECTED",
            message: "The preview included a protected card."
          });
        }
        const explanation = policy.explainSelection(
          solution.solutionIds,
          inventorySnapshot.items,
          { targetRating: challenge.requiredSquadRating }
        );
        return {
          requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
          blockers,
          fingerprints,
          explanation: explanation.explanations,
          preview: {
            ...basePreview,
            status: blockers.length ? "blocked" : "ready",
            solved: summary.solved,
            selectedCount: summary.selectedCount,
            cards: summary.cards,
            ratingRange: summary.ratingRange,
            specialCount: summary.specialCount,
            duplicateCount: summary.duplicateCount,
            storageCount: summary.storageCount,
            protectedCount: analysis.protectedItemIds.length,
            selectedProtectedCount: summary.selectedProtectedCount,
            objectiveTuple: summary.objectiveTuple
          },
          steps: blockers.length ? [] : [{
            type: "CALL_EXISTING_SERVICE",
            service: "workflow",
            command: "COMPLETE_CURRENT_SBC",
            projectId: project.id,
            setId: project.sourceSetId,
            challengeId: challenge.id
          }]
        };
      };
      strategy.requiredCapabilities = SBC_PREVIEW_CAPABILITIES;
      const compiler = new PlanCompiler({
        capabilityRegistry: evidence.capabilityRegistry,
        entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
        strategies: { [GoalKind.COMPLETE_SBC]: strategy },
        compilerVersion: 2
      });
      const goal = createGoal({
        kind: GoalKind.COMPLETE_SBC,
        intent: "Preview a protected squad for the open challenge",
        inputs: { projectId: evidence.project.id },
        createdAt: 0
      });
      const plan = await compiler.compile(goal, evidence.gameContext);
      this.sbcPlanCache.set(String(projectId), plan);
      this.state.sbcPlanPreviews = {
        ...this.state.sbcPlanPreviews,
        [String(projectId)]: plan
      };
      this.state.sbcPlanNotices = {
        ...this.state.sbcPlanNotices,
        [String(projectId)]: null
      };
      this.logger.info("SBC Preview", plan.state === "ready" ? "Built a protected squad preview; no cards were changed" : "Squad preview blocked safely", {
        projectId: String(projectId),
        planId: plan.id,
        blockerCodes: plan.blockers.map((blocker) => blocker.code)
      });
      this.emit();
      return plan;
    }
    async approveSbcPlan(projectId, planId) {
      const key = String(projectId || "");
      const expected = this.sbcPlanCache.get(key);
      if (!expected || expected.id !== String(planId || "") || expected.state !== "ready") {
        const error = new Error("Preview this squad again before approving it");
        error.code = "SBC_PLAN_NOT_APPROVABLE";
        throw error;
      }
      const active = this.engine.getSnapshot();
      if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
        const error = new Error("Finish or stop the active run before approving this squad");
        error.code = "WORKFLOW_ALREADY_ACTIVE";
        throw error;
      }
      await this.refreshStatus();
      const current = this.buildSbcPlanningEvidence(key);
      const comparison = compareSbcPlanFingerprints(expected.fingerprints, current.fingerprints);
      if (!comparison.ok) {
        this.sbcPlanCache.delete(key);
        const nextPreviews2 = { ...this.state.sbcPlanPreviews };
        delete nextPreviews2[key];
        this.state.sbcPlanPreviews = nextPreviews2;
        this.state.sbcPlanNotices = {
          ...this.state.sbcPlanNotices,
          [key]: "Club, protections, project, capabilities, or the open EA squad changed. Preview again."
        };
        this.logger.warn("SBC Approval", "Stale squad preview rejected", {
          projectId: key,
          changedEvidence: comparison.changed
        });
        this.emit();
        return { started: false, stale: true, changed: comparison.changed };
      }
      const preview = expected.preview;
      const definition = {
        id: `fut-magic-sbc-${expected.id}`,
        name: `Complete ${preview?.challengeName || "open SBC"}`,
        version: 1,
        metadata: {
          source: "fut-magic-sbc-plan",
          planId: expected.id,
          projectId: key,
          safetyModel: "refresh-re-solve-verify-submit"
        },
        steps: [
          {
            id: "approved-sbc-solve",
            type: WorkflowStepType.SOLVE_SBC,
            config: {
              target: {
                kind: "SPECIFIC_CHALLENGE",
                setId: preview.setId,
                challengeId: preview.challengeId
              }
            },
            timeoutMs: 12e4,
            retryPolicy: { maxAttempts: 1 },
            onFailure: "PAUSE"
          },
          {
            id: "approved-sbc-submit",
            type: WorkflowStepType.SUBMIT_SBC,
            timeoutMs: 3e4,
            retryPolicy: { maxAttempts: 1 },
            onFailure: "PAUSE"
          }
        ]
      };
      this.state.maxIterations = 1;
      await this.engine.start(definition, {
        mode: WorkflowMode.AUTO,
        approval: createAutoApproval(definition)
      });
      this.sbcPlanCache.delete(key);
      const nextPreviews = { ...this.state.sbcPlanPreviews };
      delete nextPreviews[key];
      this.state.sbcPlanPreviews = nextPreviews;
      this.state.sbcPlanNotices = { ...this.state.sbcPlanNotices, [key]: null };
      this.logger.info("SBC Approval", "Approved one refreshed, verified squad submission", {
        projectId: key,
        planId: expected.id
      });
      queueMicrotask(() => this.drive());
      this.emit();
      return { started: true, runId: this.engine.getSnapshot()?.runId || null };
    }
    stopConditionTriggered(condition, context) {
      const type = String(condition?.type ?? "").trim().toUpperCase();
      if (type === "UNRESOLVED_UNASSIGNED") {
        return Number(context.unresolvedUnassigned ?? 0) > 0;
      }
      if (type === "STORAGE_FULL") {
        return Number(context.storageFreeSlots ?? 0) <= 0;
      }
      if (type === "REQUIRED_SPECIAL_MISSING") {
        if (context.inventoryAvailable !== true) {
          throw new Error(
            context.inventoryUnavailableReason || "Current inventory is unavailable for required-special evaluation"
          );
        }
        const requestedTypes = condition?.requiredSpecialTypes ?? condition?.cardTypes;
        if (requestedTypes != null) {
          if (!Array.isArray(requestedTypes)) {
            throw new TypeError("Required special types must be an array");
          }
          const normalizedTypes = new Set(
            requestedTypes.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
          );
          if (normalizedTypes.size) {
            if (!Array.isArray(context.requiredSpecialCardTypes)) {
              throw new Error("Current special-card types are unavailable");
            }
            return !context.requiredSpecialCardTypes.some(
              (cardType) => normalizedTypes.has(cardType)
            );
          }
        }
        const requiredSpecialCount = Number(context.requiredSpecialCount);
        return !Number.isSafeInteger(requiredSpecialCount) || requiredSpecialCount <= 0;
      }
      if (type === "CONDITION") return evaluateCondition(condition.condition, context);
      if (["COMPARE", "ALL", "ANY", "NOT", "TRUTHY", "EXISTS"].includes(type)) {
        return evaluateCondition(condition, context);
      }
      return true;
    }
    async evaluateRunGate({ run, node }) {
      const versionSensitiveSteps = /* @__PURE__ */ new Set([
        WorkflowStepType.SOLVE_SBC,
        WorkflowStepType.SUBMIT_SBC,
        WorkflowStepType.CLAIM_REWARD,
        WorkflowStepType.OPEN_REWARD_PACK,
        WorkflowStepType.RESOLVE_ITEMS,
        WorkflowStepType.ORGANIZE_ITEMS,
        WorkflowStepType.HANDLE_PLAYER_PICK
      ]);
      if (versionSensitiveSteps.has(node?.step?.type)) {
        const gameContext = await this.refreshGameContext();
        if (gameContext.gameVersion !== GameVersion.FC26) {
          return {
            allowed: false,
            code: gameContext.gameVersion === GameVersion.FC27 ? "GAME_VERSION_UNSUPPORTED" : "GAME_CONTEXT_UNVERIFIED",
            message: gameContext.gameVersion === GameVersion.FC27 ? "FC 27 is observe-only in this build. No workflow action was run." : "The active EA game version could not be verified. No workflow action was run."
          };
        }
        if (gameContext.state !== "verified") {
          return {
            allowed: false,
            code: "GAME_CONTEXT_UNVERIFIED",
            message: "The current FC 26 context is not verified. No workflow action was run."
          };
        }
      }
      const limits = this.config.runLimits || { maxIterations: this.config.maxIterations };
      const cleanupStep = [WorkflowStepType.HANDLE_PLAYER_PICK, WorkflowStepType.RESOLVE_ITEMS, WorkflowStepType.ORGANIZE_ITEMS].includes(node?.step?.type);
      const completed2 = (type) => (run?.nodes || []).filter(
        (entry) => entry.step?.type === type && entry.status === "completed"
      ).length;
      const checks = [
        [limits.maxIterations != null && Number(run?.counters?.loopIterations || 0) > Number(limits.maxIterations), "Maximum workflow iterations reached"],
        [limits.maxSbcSubmissions != null && [WorkflowStepType.SOLVE_SBC, WorkflowStepType.SUBMIT_SBC].includes(node?.step?.type) && completed2(WorkflowStepType.SUBMIT_SBC) >= Number(limits.maxSbcSubmissions), "Maximum SBC submissions reached"],
        [limits.maxPacksOpened != null && !cleanupStep && completed2(WorkflowStepType.OPEN_REWARD_PACK) >= Number(limits.maxPacksOpened), "Maximum opened packs reached"],
        [limits.maxDurationMinutes != null && !cleanupStep && Date.now() - Number(run?.createdAt || Date.now()) >= Number(limits.maxDurationMinutes) * 6e4, "Maximum workflow duration reached"]
      ];
      const reached = checks.find(([blocked2]) => blocked2);
      if (reached) return { allowed: false, code: "RUN_LIMIT_REACHED", message: reached[1] };
      const context = this.conditionContext(run);
      for (const condition of this.config.stopConditions || []) {
        try {
          if (!cleanupStep && this.stopConditionTriggered(condition, context)) {
            return { allowed: false, code: "STOP_CONDITION_REACHED", message: `Stop condition reached: ${condition.type}` };
          }
        } catch (error) {
          return { allowed: false, code: "STOP_CONDITION_INVALID", message: error?.message || "Stop condition could not be evaluated" };
        }
      }
      if (run?.mode === WorkflowMode.REVIEW && node?.step?.type === WorkflowStepType.HANDLE_PLAYER_PICK) {
        return { allowed: true };
      }
      return evaluateWorkflowModeGate({ run, node });
    }
    currentPickPolicy() {
      return {
        type: this.config.pickMode || "PAUSE_FOR_USER",
        ...this.config.pickPolicy || {}
      };
    }
    playerPickContext() {
      let items = [];
      try {
        items = this.inventory.getSnapshot().items;
      } catch {
      }
      const duplicateResourceIds = this.inventoryAvailable ? this.inventory.getDuplicateGroups().flatMap(
        (group) => group.items.map((item) => item.resourceId).filter(Boolean)
      ) : [];
      const overlay = this.targets.getFodderPolicyOverlay();
      return {
        existingResourceIds: items.map((item) => item.resourceId).filter(Boolean),
        duplicateResourceIds,
        duplicateItemIds: items.filter((item) => item.isDuplicate).map((item) => item.itemId),
        requiredSpecialTypes: Object.keys(overlay.specialReserveByCardType || {}),
        activeTargetProjectIds: overlay.activeProjectIds || []
      };
    }
    conditionContext(runOverride = null) {
      const inventory = this.inventory.getStatus();
      let snapshot = null;
      let inventoryUnavailableReason = null;
      try {
        snapshot = this.inventory.getSnapshot();
      } catch (error) {
        inventoryUnavailableReason = error?.message || "Current inventory snapshot is unavailable";
      }
      const inventoryAvailable = this.inventoryAvailable === true && snapshot?.updatedAt != null && Array.isArray(snapshot?.items);
      const specialItems = inventoryAvailable ? snapshot.items.filter((item) => item?.isSpecial === true) : [];
      const run = runOverride || this.engine?.getSnapshot();
      return {
        inventory,
        workflowIterations: run?.counters?.loopIterations || 0,
        storageFreeSlots: inventory.storageFreeSlots,
        unresolvedUnassigned: inventory.unassignedCount,
        inventoryAvailable,
        requiredSpecialCount: inventoryAvailable ? specialItems.length : null,
        inventoryUnavailableReason,
        requiredSpecialCardTypes: inventoryAvailable ? specialItems.flatMap((item) => [item.cardType, item.rarityName, ...item.specialGroups || []]).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean) : null
      };
    }
    getState() {
      return structuredClone(this.state);
    }
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.getState());
      return () => this.listeners.delete(listener);
    }
    emit() {
      this.state.productRevision += 1;
      const snapshot = this.getState();
      for (const listener of this.listeners) listener(snapshot);
    }
    onRun(run) {
      if (!run) return;
      if (![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(run.status)) {
        this.invalidateDuplicateRoutePreview(
          "Activity Guard changed while a workflow was active. Preview again."
        );
      }
      this.invalidateRouterRecommendation(
        "Activity Guard changed while a workflow was active. Check again."
      );
      const node = run.nodes?.[run.cursor];
      const completed2 = (type) => run.nodes.filter((entry) => entry.step?.type === type && entry.status === "completed");
      this.state.runStatus = run.status;
      this.state.currentStep = node?.step?.type || null;
      this.state.runName = run.definition?.name || "FUT Magic run";
      this.state.runModeLabel = run.mode === WorkflowMode.REVIEW ? "Preview only" : run.mode === WorkflowMode.ASSISTED ? "Ask before each action" : "Approved plan";
      this.state.iterations = run.counters?.loopIterations || 0;
      this.state.maxIterations = this.config.maxIterations;
      this.state.sbcCompleted = completed2(WorkflowStepType.SUBMIT_SBC).length;
      this.state.packsOpened = completed2(WorkflowStepType.OPEN_REWARD_PACK).length;
      this.state.picksCompleted = completed2(WorkflowStepType.HANDLE_PLAYER_PICK).filter(
        (entry) => entry.result?.pending !== false
      ).length;
      this.state.duplicatesRecycled = completed2(WorkflowStepType.RESOLVE_ITEMS).reduce((sum, entry) => sum + Number(entry.result?.movedToStorage?.length || 0), 0);
      this.state.pauseReason = run.pauseReason?.message || null;
      this.state.error = run.lastError?.message || null;
      const timelineTypes = [
        WorkflowStepType.SOLVE_SBC,
        WorkflowStepType.SUBMIT_SBC,
        WorkflowStepType.CLAIM_REWARD,
        WorkflowStepType.OPEN_REWARD_PACK,
        WorkflowStepType.HANDLE_PLAYER_PICK,
        WorkflowStepType.RESOLVE_ITEMS,
        WorkflowStepType.ORGANIZE_ITEMS
      ];
      this.state.timeline = timelineTypes.map((type) => {
        const entries = run.nodes.filter((entry) => entry.step?.type === type);
        const active = entries.find((entry) => entry.executionId === node?.executionId);
        const latest = active || entries.at(-1);
        return { type, status: latest?.status || "pending", active: Boolean(active) };
      });
      this.state.analytics = summarizeRunAnalytics(run);
      this.emit();
      if (run.status === RunStatus.RUNNING) queueMicrotask(() => this.drive());
      if (run.status === RunStatus.WAITING) this.scheduleWake(run);
    }
    async drive() {
      if (this.drivePromise) return this.drivePromise;
      this.drivePromise = this.engine.runUntilBlocked({ maxTransitions: 200 }).catch((error) => this.reportUiError(error)).finally(() => {
        this.drivePromise = null;
      });
      return this.drivePromise;
    }
    scheduleWake(run) {
      clearTimeout(this.wakeTimer);
      const node = run.nodes?.[run.cursor];
      const delay = Math.max(0, Number(node?.waitUntil || Date.now()) - Date.now());
      this.wakeTimer = setTimeout(() => this.drive(), Math.min(delay + 20, 2147e6));
    }
    async start(config) {
      const previous = this.config || this.defaultConfig();
      const ceilings = previous.profileCeilings || null;
      const requestedIterations = Math.max(1, Math.min(1e3, Math.trunc(config.maxIterations || previous.maxIterations || 1)));
      const maxIterations = ceilings?.maxIterations == null ? requestedIterations : Math.min(requestedIterations, Number(ceilings.maxIterations));
      const requestedLimits = { ...previous.runLimits || {}, ...config.runLimits || {}, maxIterations };
      if (ceilings) {
        for (const field of ["maxSbcSubmissions", "maxPacksOpened", "maxDurationMinutes"]) {
          if (ceilings[field] != null) {
            requestedLimits[field] = requestedLimits[field] == null ? Number(ceilings[field]) : Math.min(Number(requestedLimits[field]), Number(ceilings[field]));
          }
        }
      }
      this.config = {
        ...this.defaultConfig(),
        ...previous,
        ...config,
        workflow: finalizeWorkflowDraft(config.workflow || this.state.workflowDraft || buildWorkflow(config)),
        maxIterations,
        runLimits: requestedLimits
      };
      this.config.maxPacks = Math.max(1, Math.min(100, Math.trunc(this.config.maxPacks || 1)));
      if (ceilings?.maxPacks != null) this.config.maxPacks = Math.min(this.config.maxPacks, Number(ceilings.maxPacks));
      this.state.storageCapacity = Math.max(1, Math.min(100, Math.trunc(this.config.storageCapacity || 100)));
      const definition = this.config.workflow || buildWorkflow(this.config);
      let approval = null;
      if (this.config.mode === WorkflowMode.AUTO) {
        const summary = [`Workflow: ${definition.name}`, `Iterations: ${this.config.maxIterations}`, `Max submissions: ${requestedLimits.maxSbcSubmissions ?? "workflow bound"}`, `Max opened packs: ${requestedLimits.maxPacksOpened ?? "workflow bound"}`, `Max duration: ${requestedLimits.maxDurationMinutes ? `${requestedLimits.maxDurationMinutes} min` : "workflow bound"}`, `Protected rating: ${this.config.protectRatingAtOrAbove}+`, `Protected types: ${this.config.protectedCardTypes.join(", ") || "none"}`, `Packs: ${this.config.packMode}, max ${this.config.maxPacks} per step (owned rewards only)`, `Duplicates: Storage, otherwise pause`, `Player picks: ${this.config.pickMode}`].join("\n");
        if (!this.confirm(`Authorize this GrindPilot AUTO run?

${summary}`)) return;
        approval = createAutoApproval(definition);
      }
      await this.storage.saveSettings(this.config);
      this.state.draft = this.config;
      this.state.maxIterations = this.config.maxIterations;
      await this.engine.start(definition, { mode: this.config.mode, approval });
      this.logger.info("Start", `Workflow started in ${this.config.mode} mode`, { maxIterations: this.config.maxIterations });
      await this.drive();
    }
    async recycleCards() {
      const active = this.engine.getSnapshot();
      if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
        const error = new Error("Finish or stop the active workflow before recycling cards");
        error.code = "WORKFLOW_ALREADY_ACTIVE";
        throw error;
      }
      await this.refreshInventory({ requireNewer: true });
      const plan = this.inventory.planUnassignedResolution({
        preferSbcStorage: this.config.preferSbcStorage !== false,
        tradableWhenStorageUnavailable: "SAFE_HOLD",
        untradeableWhenStorageUnavailable: "PAUSE"
      });
      if (!plan.actions.length) {
        this.logger.info("Recycle Cards", "No unassigned cards need recycling", null);
        return { status: "completed", result: plan };
      }
      const toClub = plan.actions.filter((action) => action.type === "SEND_TO_CLUB").length;
      const toStorage = plan.actions.filter(
        (action) => action.type === "MOVE_TO_SBC_STORAGE"
      ).length;
      const definition = {
        id: "recycle-cards",
        name: "Recycle Cards",
        version: 1,
        metadata: { source: "grindpilot-recycle-button", safetyModel: "fail-closed" },
        steps: [
          {
            id: "recycle-unassigned-items",
            type: WorkflowStepType.RESOLVE_ITEMS,
            config: {
              allowPartial: true,
              allowUnresolved: false
            },
            timeoutMs: 45e3,
            retryPolicy: { maxAttempts: 1 },
            onFailure: "PAUSE"
          }
        ]
      };
      await this.engine.start(definition, {
        mode: WorkflowMode.AUTO,
        approval: createAutoApproval(definition)
      });
      this.logger.info("Recycle Cards", "Approved safe unassigned-card recycling", {
        toClub,
        toStorage,
        unresolvedRequiresReviewedRecipe: plan.requiresUserAction
      });
      await this.drive();
      return this.engine.getSnapshot();
    }
    async getOrganizerTarget() {
      const candidates = this.targets.getActiveProjects().filter(
        (project2) => project2.sourceSetId && (project2.sourceChallenges?.length || project2.sourceChallengeIds?.length)
      );
      const configuredId = String(this.config.organizerTargetProjectId ?? "");
      let project = configuredId ? candidates.find((entry) => String(entry.id) === configuredId) : null;
      if (configuredId && !project) {
        const error = new Error(
          "The selected Organizer Target Project is inactive, complete, or has no stable EA IDs"
        );
        error.code = "ORGANIZER_TARGET_UNAVAILABLE";
        throw error;
      }
      project ??= candidates.find((entry) => /85\s*[x×]\s*10/i.test(entry.name));
      project ??= candidates[0] ?? null;
      if (!project) {
        const target = await this.adapter.findSbcTarget({
          preferredNames: ["10x 85+ Upgrade", "85x10"]
        });
        return {
          projectId: null,
          name: target.name || "10x 85+ Upgrade",
          setId: target.setId,
          challengeId: target.challengeId
        };
      }
      const challenge = project.sourceChallenges?.find((entry) => entry.completed !== true) ?? null;
      const challengeId = challenge?.id ?? project.sourceChallengeIds?.[0] ?? null;
      if (!challengeId) {
        const error = new Error("The Organizer target has no incomplete mapped challenge");
        error.code = "ORGANIZER_CHALLENGE_REQUIRED";
        throw error;
      }
      return {
        projectId: project.id,
        name: project.name,
        setId: project.sourceSetId,
        challengeId
      };
    }
    async saveOrganizerSettings(projectId = null) {
      this.config = {
        ...this.config,
        organizerTargetProjectId: projectId ? String(projectId) : null
      };
      this.state.draft = this.config;
      await this.storage.saveSettings(this.config);
      this.emit();
      return { organizerTargetProjectId: this.config.organizerTargetProjectId };
    }
    async listQuickOpenPacks() {
      const plan = await this.packService.plan({
        policy: { mode: "OPEN_ALL_ALLOWED_PACKS", maxPacks: 100 }
      });
      return plan.packs.map((pack) => ({ ...pack }));
    }
    async quickOpenPack(selection = null) {
      const active = this.engine.getSnapshot();
      if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
        const error = new Error("Finish or stop the active workflow before opening a pack");
        error.code = "WORKFLOW_ALREADY_ACTIVE";
        throw error;
      }
      await this.refreshInventory({ requireNewer: true });
      const requestedPackId = String(
        typeof selection === "object" ? selection?.packId ?? "" : selection ?? ""
      );
      const plan = await this.packService.plan({
        policy: {
          mode: "OPEN_ALL_ALLOWED_PACKS",
          maxPacks: 1,
          ...requestedPackId ? { allowedPackIds: [requestedPackId] } : {}
        }
      });
      if (plan.packs.length !== 1) {
        const error = new Error("No uniquely selected owned pack is ready to open safely");
        error.code = "QUICK_OPEN_PACK_UNAVAILABLE";
        throw error;
      }
      const pack = plan.packs[0];
      const packId2 = String(pack?.packId ?? pack?.id ?? "");
      const label = String(pack?.name ?? pack?.packName ?? pack?.type ?? packId2);
      if (!requestedPackId && !this.confirm(`Open ${label} safely?

Only this already-owned pack will be opened. No purchase is allowed.`)) {
        return { status: "cancelled", result: { packId: packId2 } };
      }
      const definition = {
        id: "quick-open-pack",
        name: "Open safely",
        version: 1,
        metadata: { source: "grindpilot-quick-open", safetyModel: "owned-only" },
        steps: [{
          id: "quick-open-owned-pack",
          type: WorkflowStepType.OPEN_REWARD_PACK,
          config: { quickOpen: true, packId: packId2 },
          timeoutMs: 45e3,
          retryPolicy: { maxAttempts: 1 },
          onFailure: "PAUSE"
        }]
      };
      await this.engine.start(definition, {
        mode: WorkflowMode.AUTO,
        approval: createAutoApproval(definition)
      });
      this.logger.info("Open safely", "Approved one verified owned pack", { packId: packId2 });
      await this.drive();
      return this.engine.getSnapshot();
    }
    async pause() {
      await this.engine.pause({ reason: "Paused by user" });
    }
    async stop() {
      clearTimeout(this.wakeTimer);
      await this.engine.stop({ reason: "Stopped by user" });
    }
    async resume() {
      const run = this.engine.getSnapshot();
      const current = run?.nodes?.[run.cursor];
      if (run?.status === RunStatus.RECOVERY_REQUIRED) {
        const error = new Error("The interrupted destructive step must be reconciled before this run can resume");
        error.code = "RECOVERY_RECONCILIATION_REQUIRED";
        throw error;
      }
      let approveCurrent = false;
      if (run?.mode === WorkflowMode.ASSISTED && current && [WorkflowStepType.SUBMIT_SBC, WorkflowStepType.CLAIM_REWARD, WorkflowStepType.OPEN_REWARD_PACK, WorkflowStepType.RESOLVE_ITEMS, WorkflowStepType.ORGANIZE_ITEMS, WorkflowStepType.HANDLE_PLAYER_PICK].includes(current.step.type)) {
        approveCurrent = this.confirm(`Approve destructive step ${current.step.type}?`);
        if (!approveCurrent) return;
      }
      await this.engine.resume({ approveCurrent, retryCurrent: current?.status === "failed" });
      await this.drive();
    }
    async refreshStatus() {
      try {
        const health = await this.adapter.health();
        this.state.bridgeHealth = health.eaReady ? "healthy" : "initializing";
        this.state.error = null;
      } catch (error) {
        this.state.bridgeHealth = "unavailable";
        this.state.error = error.message;
      }
      try {
        await this.refreshInventory();
      } catch (error) {
        this.state.error = this.state.error || `Inventory refresh failed: ${error?.message || error}`;
      }
      await this.refreshGameContext();
      try {
        this.state.capabilityHealth = await this.adapter.getCapabilityHealth();
      } catch (error) {
        this.state.capabilityHealth = (Array.isArray(this.state.capabilityHealth) ? this.state.capabilityHealth : []).filter((entry) => String(entry?.id || "").trim()).map((entry) => ({ id: entry.id, status: "UNAVAILABLE", evidence: null }));
        this.state.error = this.state.error || `Capability refresh failed: ${error?.message || error}`;
      }
      this.emit();
      return this.getState();
    }
    async refreshInventory({ requireNewer = false } = {}) {
      if (this.inventoryRefreshPromise) {
        if (!requireNewer) return this.inventoryRefreshPromise;
        const activeEpoch = Number(this.inventoryRefreshEpoch) || 0;
        if (this.inventoryRefreshQueuedPromise && this.inventoryRefreshQueuedAfterEpoch >= activeEpoch) {
          return this.inventoryRefreshQueuedPromise;
        }
        const activeRefresh = this.inventoryRefreshPromise;
        let queuedRefresh;
        queuedRefresh = activeRefresh.catch(() => null).then(() => {
          if (this.inventoryRefreshQueuedPromise === queuedRefresh) {
            this.inventoryRefreshQueuedPromise = null;
            this.inventoryRefreshQueuedAfterEpoch = 0;
          }
          return this.refreshInventory();
        }).finally(() => {
          if (this.inventoryRefreshQueuedPromise === queuedRefresh) {
            this.inventoryRefreshQueuedPromise = null;
            this.inventoryRefreshQueuedAfterEpoch = 0;
          }
        });
        this.inventoryRefreshQueuedPromise = queuedRefresh;
        this.inventoryRefreshQueuedAfterEpoch = activeEpoch;
        return queuedRefresh;
      }
      this.inventoryRefreshEpoch = (Number(this.inventoryRefreshEpoch) || 0) + 1;
      this.inventoryRefreshPromise = (async () => {
        this.inventoryAvailable = false;
        this.state.inventoryAvailable = false;
        this.state.fodderReviewPlan = null;
        this.invalidateDuplicateRoutePreview(
          "Club or Unassigned evidence was refreshed. Preview the safe route again."
        );
        this.invalidateRouterRecommendation(
          "Club or Unassigned evidence was refreshed. Check the next action again."
        );
        const raw = await this.adapter.readInventory();
        const snapshot = this.inventory.synchronize({ club: raw.club, storage: raw.storage, unassigned: raw.unassigned, storageCapacity: this.state.storageCapacity });
        this.inventoryAvailable = true;
        const status = this.inventory.getStatus();
        this.inventoryAvailable = true;
        this.state.inventoryAvailable = true;
        this.state.inventory = status;
        this.state.storageCount = status.storageCount;
        this.state.unassignedCount = status.unassignedCount;
        this.state.targetDashboard = this.targets?.getDashboard?.(snapshot.items) ?? [];
        this.state.inventoryBuckets = buildInventoryBuckets(snapshot.items);
        this.emit();
        return snapshot;
      })().finally(() => {
        this.inventoryRefreshPromise = null;
      });
      return this.inventoryRefreshPromise;
    }
    async saveDraftProfile() {
      const fodderPolicy = Object.fromEntries(["protectRatingAtOrAbove", "preferredFodderRange", "protectedCardTypes", "allowedSpecialTypes", "protectedItemIds", "protectedPlayerIds", "protectedResourceIds", "protectedRatings", "protectStartingSquad", "protectFavorites", "protectTradables", "preferUntradeables", "preferDuplicates", "preferSbcStorage", "minimumReserveByRating", "specialReserveByCardType"].map((key) => [key, this.config[key]]));
      const id = `profile-${Date.now()}`;
      const profile = await this.profileService.save({ id, name: `Grind profile ${(/* @__PURE__ */ new Date()).toLocaleString()}`, automationMode: this.config.mode, workflow: this.config.workflow || buildWorkflow(this.config), solverSettings: this.config.solverSettings || {}, fodderPolicy, duplicatePolicy: { ...this.config.duplicatePolicy || {}, quicksell: false, unresolved: "PAUSE", storageCapacity: this.config.storageCapacity }, packPolicy: { mode: this.config.packMode, maxPacks: this.config.maxPacks || 1 }, pickPolicy: { type: this.config.pickMode, ...this.config.pickPolicy || {} }, runLimits: { ...this.config.runLimits || {}, maxIterations: this.config.maxIterations }, stopConditions: this.config.stopConditions || [], targetProjects: this.targets.list() });
      this.state.profiles = await this.profileService.list();
      this.emit();
      return profile;
    }
    async loadProfile(id) {
      const p = await this.profileService.get(id);
      if (!p) return;
      this.config = { ...this.defaultConfig(), ...p.fodderPolicy, mode: p.automationMode || WorkflowMode.REVIEW, workflow: p.workflow, runLimits: { ...p.runLimits }, maxIterations: p.runLimits.maxIterations, storageCapacity: Math.min(100, p.duplicatePolicy.storageCapacity || 100), solverSettings: p.solverSettings, duplicatePolicy: p.duplicatePolicy, packMode: p.packPolicy.mode, maxPacks: p.packPolicy.maxPacks, pickMode: p.pickPolicy.type, pickPolicy: p.pickPolicy, stopConditions: p.stopConditions, loadedProfileId: p.id, profileCeilings: { ...p.runLimits, maxPacks: p.packPolicy.maxPacks }, protectStartingSquad: true };
      this.state.storageCapacity = this.config.storageCapacity;
      this.state.workflowDraft = structuredClone(p.workflow);
      if (Array.isArray(p.targetProjects)) {
        this.targets = new TargetProjectService(p.targetProjects);
        this.state.projects = this.targets.list();
      }
      this.state.draft = this.config;
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation("Protection or project settings changed. Check the next action again.");
      this.emit();
    }
    async exportCurrentProfile() {
      const p = this.state.profiles.at(-1) || await this.saveDraftProfile();
      return this.profileService.export(p.id);
    }
    exportRunAnalytics() {
      return exportRunAnalytics(this.engine.getSnapshot());
    }
    async importProfile(text) {
      await this.profileService.import(text, { overwrite: false });
      this.state.profiles = await this.profileService.list();
      this.emit();
    }
    async saveProtectionSettings(input) {
      this.config = { ...this.config, ...input, protectStartingSquad: true };
      this.state.draft = this.config;
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation(
        "Protection settings changed. Check the next action again."
      );
      this.sbcPlanCache.clear();
      this.state.sbcPlanPreviews = {};
      await this.storage.saveSettings(this.config);
      this.emit();
    }
    useWorkflowTemplate(id) {
      this.state.workflowDraft = getWorkflowTemplate(id);
      this.emit();
      return this.state.workflowDraft;
    }
    addWorkflowBuilderStep(path = [], type = WorkflowStepType.SOLVE_SBC) {
      this.state.workflowDraft = addWorkflowStep(this.state.workflowDraft, path, type);
      this.emit();
    }
    deleteWorkflowBuilderStep(path, index) {
      this.state.workflowDraft = deleteWorkflowStep(this.state.workflowDraft, path, index);
      this.emit();
    }
    moveWorkflowBuilderStep(path, index, direction) {
      this.state.workflowDraft = moveWorkflowStep(this.state.workflowDraft, path, index, direction);
      this.emit();
    }
    duplicateWorkflowBuilderStep(path, index) {
      this.state.workflowDraft = duplicateWorkflowStep(this.state.workflowDraft, path, index);
      this.emit();
    }
    updateWorkflowBuilderStep(path, index, patch) {
      this.state.workflowDraft = mutateWorkflowSteps(this.state.workflowDraft, path, (steps) => {
        const current = steps[index];
        if (!current) throw new TypeError("Workflow step is no longer available");
        if (patch.type && patch.type !== current.type) {
          steps[index] = { ...createWorkflowStep(patch.type), id: current.id };
          return;
        }
        steps[index] = {
          ...current,
          ...patch,
          config: { ...current.config || {}, ...patch.config || {} },
          retryPolicy: {
            ...current.retryPolicy || {},
            ...patch.retryPolicy || {}
          }
        };
      });
      this.emit();
    }
    saveWorkflowDraft() {
      const workflow = finalizeWorkflowDraft(this.state.workflowDraft);
      this.config = { ...this.config, workflow };
      this.state.draft = this.config;
      this.state.workflowDraft = workflow;
      this.emit();
      return workflow;
    }
    async refreshLegacySequences() {
      this.state.legacySequences = await this.adapter.readLegacySequences();
      this.emit();
      return this.state.legacySequences;
    }
    async importLegacySequencePlan(id) {
      const plans = this.state.legacySequences.length ? this.state.legacySequences : await this.adapter.readLegacySequences();
      const plan = plans.find((entry) => String(entry.id) === String(id)) || (plans.length === 1 ? plans[0] : null);
      if (!plan) throw new TypeError("Select one legacy Sequence plan to import");
      this.state.workflowDraft = importLegacySequence(plan);
      this.emit();
      return this.state.workflowDraft;
    }
    async addTargetProject(input) {
      const name = String(input?.name || "").trim();
      if (!name) throw new Error("Target project name is required");
      const project = this.targets.upsert({ id: `project-${Date.now()}`, name, active: true, priority: Math.max(0, Math.trunc(input.priority || 0)), requiredSquadsRemaining: Math.max(0, Math.trunc(input.requiredSquadsRemaining || 0)), protectedRatings: { atOrAbove: input.protectRatingAtOrAbove || null }, ratingRequirements: [], specialCardRequirements: [], completionProgress: 0 });
      this.state.projects = this.targets.list();
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation("Target Projects changed. Check the next action again.");
      await this.storage.saveProjects(this.state.projects);
      this.emit();
      return project;
    }
    async saveTargetProject(input) {
      const project = this.targets.upsert({
        ...input,
        id: input?.id || `project-${Date.now()}`
      });
      this.state.projects = this.targets.list();
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation(
        "Target Projects changed. Check the next action again."
      );
      let items = [];
      try {
        items = this.inventory.getSnapshot().items;
      } catch {
      }
      this.state.targetDashboard = this.targets.getDashboard(items);
      await this.storage.saveProjects(this.state.projects);
      this.emit();
      return project;
    }
    async importCurrentSbcProject() {
      await this.requireFc26PlanningContext({ requireSbcTarget: true });
      const snapshot = await this.adapter.readCurrentSbcProject();
      const project = this.targets.importCurrentSbc(snapshot);
      this.state.projects = this.targets.list();
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation(
        "Target Projects changed. Check the next action again."
      );
      this.state.targetDashboard = this.targets.getDashboard(
        this.inventoryAvailable ? this.inventory.getSnapshot().items : []
      );
      await this.storage.saveProjects(this.state.projects);
      this.logger.info("Target Project", "Imported current SBC set", {
        setId: snapshot.setId,
        challenges: snapshot.challenges.length,
        unknownRequirements: snapshot.challenges.reduce(
          (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
          0
        )
      });
      this.emit();
      return project;
    }
    async syncTargetProject(id) {
      await this.requireFc26PlanningContext({ requireSbcTarget: true });
      const snapshot = await this.adapter.readCurrentSbcProject();
      const project = this.targets.synchronizeFromCurrentSbc(id, snapshot);
      this.state.projects = this.targets.list();
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation(
        "Target Projects changed. Check the next action again."
      );
      this.state.targetDashboard = this.targets.getDashboard(
        this.inventoryAvailable ? this.inventory.getSnapshot().items : []
      );
      await this.storage.saveProjects(this.state.projects);
      this.emit();
      return project;
    }
    async removeTargetProject(id) {
      this.targets.remove(id);
      this.state.projects = this.targets.list();
      this.state.fodderReviewPlan = null;
      this.invalidateRouterRecommendation("Target Projects changed. Check the next action again.");
      await this.storage.saveProjects(this.state.projects);
      this.emit();
    }
    async setDeveloperMode(enabled) {
      enabled ? this.dev.enable() : this.dev.disable();
      this.state.diagnostics = { ...this.dev.getStatus(), latest: this.state.diagnostics.latest || null };
      this.emit();
    }
    async takeDiagnosticSnapshot() {
      const health = await this.adapter.health().catch((error) => ({ error: error.message }));
      const latest = this.dev.captureSnapshot({ bridgeHealth: health, route: location.pathname, selectors: { controllerBridge: Boolean(window.eaData?.grindPilot) } });
      this.state.diagnostics = { ...this.dev.getStatus(), latest, diff: this.dev.compareLatestSnapshots() };
      this.emit();
      return latest;
    }
    async exportDiagnostics() {
      return this.dev.exportDiagnostics({ healthChecks: [await this.adapter.health().catch((error) => ({ error: error.message }))], logs: this.logger.entries() });
    }
    getProductShellViewModel() {
      return buildProductShellViewModel({
        ...this.state,
        gameContext: this.currentGameContext()
      });
    }
    /** Execute only a previously reviewed, exact duplicate-recycle preview. */
    async startApprovedDuplicateRecycle(preview) {
      const active = this.engine.getSnapshot();
      if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
        const error = new Error("Finish or stop the active workflow before recycling duplicates");
        error.code = "WORKFLOW_ALREADY_ACTIVE";
        throw error;
      }
      const definition = compileDuplicateRecycleWorkflow(preview);
      await this.engine.start(definition, {
        mode: WorkflowMode.AUTO,
        approval: createAutoApproval(definition)
      });
      this.logger.info("Duplicate Recycle", "Approved one exact reviewed duplicate recipe", {
        targetId: preview.target.targetId,
        blockingCount: preview.blockingItemIds.length
      });
      await this.drive();
      return this.engine.getSnapshot();
    }
    async executeProductShellCommand(command = {}) {
      const type = String(command?.type || "");
      if (type === "REFRESH") return this.refreshStatus().then(() => this.getProductShellViewModel());
      if (type === "PAUSE_RUN") await this.pause();
      else if (type === "RESUME_RUN") await this.resume();
      else if (type === "STOP_RUN") await this.stop();
      else if (type === "IMPORT_CURRENT_SBC_PROJECT") await this.importCurrentSbcProject();
      else if (type === "PREVIEW_SBC_PROJECT") {
        await this.previewSbcProject(String(command.projectId || ""));
      } else if (type === "APPROVE_SBC_PLAN") {
        await this.approveSbcPlan(
          String(command.projectId || ""),
          String(command.planId || "")
        );
      } else if (type === "PREVIEW_CLEAR_DUPLICATES") {
        await this.previewDuplicateRoute();
      } else if (type === "PREVIEW_FODDER_REVIEW") {
        await this.previewFodderReview();
      } else if (type === "APPROVE_CLEAR_DUPLICATES_PLAN") {
        await this.approveDuplicateRoute(String(command.planId || ""));
      } else if (type === "OPEN_LEGACY_UI") {
        const allowed = /* @__PURE__ */ new Set(["Easy Loop", "SBC Solver", "Workflows", "Profiles", "Inventory", "Protected Cards", "Target Projects", "Activity", "Settings", "Developer"]);
        const section = allowed.has(String(command.section)) ? String(command.section) : "Easy Loop";
        this.panel?.openSection?.(section);
      } else {
        const error = new Error("Unsupported FUT Magic surface command");
        error.code = "FUT_MAGIC_COMMAND_FORBIDDEN";
        throw error;
      }
      return this.getProductShellViewModel();
    }
    async openSidePanel() {
      return new Promise((resolve, reject) => {
        const api = globalThis.chrome?.runtime;
        if (!api?.sendMessage) {
          this.panel?.openSection?.("Easy Loop");
          resolve({ opened: false, legacy: true });
          return;
        }
        api.sendMessage({ type: "FUT_MAGIC_OPEN_PANEL_V1" }, (response) => {
          const error = api.lastError;
          if (error || !response?.ok) reject(new Error(error?.message || response?.error?.message || "FUT Magic Side Panel could not open"));
          else resolve(response.data || { opened: true });
        });
      });
    }
    reportUiError(error) {
      this.state.error = error?.message || String(error);
      this.logger.error("Error", this.state.error, { code: error?.code || null });
      this.emit();
    }
    persistActivity() {
      clearTimeout(this.activityTimer);
      this.activityTimer = setTimeout(() => this.storage.saveActivity(this.logger.entries()).catch((error) => {
        console.warn("[GrindPilot] Activity persistence failed", { code: error?.code || null, message: error?.message || String(error) });
      }), 250);
    }
  };
  var mountGrindPilotRuntime = async () => {
    if (!globalThis.window || globalThis.window.__grindPilotRuntime) return;
    await (globalThis.__grindPilotIsolatedReady || Promise.resolve());
    const runtime = new GrindPilotRuntime();
    globalThis.window.__grindPilotRuntime = runtime;
    await runtime.initialize();
  };
  void mountGrindPilotRuntime().catch((error) => {
    console.error("[GrindPilot] Initialization failed", { message: error?.message, code: error?.code });
  });
})();
