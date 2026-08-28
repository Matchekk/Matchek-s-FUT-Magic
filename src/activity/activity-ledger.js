export const ActivityOutcome = Object.freeze({
  VERIFIED: "verified",
  NOT_APPLIED: "not_applied",
  TRANSIENT_FAILURE: "transient_failure",
  TERMINAL_FAILURE: "terminal_failure",
  AMBIGUOUS: "ambiguous",
});

export const ActivityWindow = Object.freeze({
  ONE_MINUTE: 60_000,
  FIVE_MINUTES: 5 * 60_000,
  FIFTEEN_MINUTES: 15 * 60_000,
  ONE_HOUR: 60 * 60_000,
  ONE_DAY: 24 * 60 * 60_000,
});

const OUTCOMES = new Set(Object.values(ActivityOutcome));
const safeToken = (value, field) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new TypeError(`${field} must be a safe non-empty token`);
  }
  return value;
};

const normalizeEvent = (event) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("Activity event must be an object");
  }
  const timestamp = Number(event.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Activity timestamp is invalid");
  const outcome = String(event.outcome);
  if (!OUTCOMES.has(outcome)) throw new TypeError("Activity outcome is unsupported");
  return Object.freeze({
    eventId: safeToken(event.eventId, "eventId"),
    timestamp,
    personaKey: safeToken(event.personaKey, "personaKey"),
    gameVersion: safeToken(event.gameVersion, "gameVersion"),
    sessionId: safeToken(event.sessionId, "sessionId"),
    operationFamily: safeToken(event.operationFamily, "operationFamily"),
    outcome,
    failureClass: event.failureClass == null ? null : safeToken(event.failureClass, "failureClass"),
  });
};

export class ActivityLedger {
  #events = [];
  #prunedBefore = null;

  constructor({ maxEvents = 5000, clock = () => Date.now(), snapshot = null } = {}) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 20_000) {
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
    const events = snapshot.events.map(normalizeEvent)
      .sort((left, right) => left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId));
    const ids = new Set();
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
    if (!Number.isSafeInteger(now) || now < 0 || event.timestamp > now + 60_000) {
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
    const events = this.#events.filter((event) =>
      event.personaKey === persona &&
      event.gameVersion === game &&
      (session == null || event.sessionId === session) &&
      event.timestamp > from && event.timestamp <= current,
    );
    const complete = this.#prunedBefore == null || this.#prunedBefore <= from;
    return Object.freeze({
      from,
      to: current,
      complete,
      total: events.length,
      verified: events.filter(({ outcome }) => outcome === ActivityOutcome.VERIFIED).length,
      failures: events.filter(({ outcome }) => [
        ActivityOutcome.TRANSIENT_FAILURE,
        ActivityOutcome.TERMINAL_FAILURE,
        ActivityOutcome.AMBIGUOUS,
      ].includes(outcome)).length,
      events: Object.freeze(events.map((event) => Object.freeze({ ...event }))),
    });
  }

  consecutiveFailures({ personaKey, gameVersion, sessionId, operationFamily }) {
    const matching = this.#events.filter((event) =>
      event.personaKey === personaKey &&
      event.gameVersion === gameVersion &&
      event.sessionId === sessionId &&
      event.operationFamily === operationFamily,
    );
    let count = 0;
    for (let index = matching.length - 1; index >= 0; index -= 1) {
      const outcome = matching[index].outcome;
      if (outcome === ActivityOutcome.VERIFIED) break;
      if ([ActivityOutcome.TRANSIENT_FAILURE, ActivityOutcome.TERMINAL_FAILURE, ActivityOutcome.AMBIGUOUS].includes(outcome)) {
        count += 1;
      }
    }
    return count;
  }

  snapshot() {
    return Object.freeze({
      schemaVersion: 1,
      prunedBefore: this.#prunedBefore,
      events: Object.freeze(this.#events.map((event) => Object.freeze({ ...event }))),
    });
  }

  publicSummary({ personaKey, gameVersion, sessionId, now = this.clock() }) {
    const windows = Object.fromEntries(Object.entries(ActivityWindow).map(([key, windowMs]) => [
      key,
      this.query({ personaKey, gameVersion, sessionId, windowMs, now }).total,
    ]));
    return Object.freeze({ schemaVersion: 1, windows: Object.freeze(windows) });
  }
}
