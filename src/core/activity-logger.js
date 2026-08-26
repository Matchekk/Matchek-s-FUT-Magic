const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const TRUNCATED = "[Truncated]";
const LEVELS = new Set(["debug", "info", "warn", "error"]);

const normalizeSecretKey = (key) =>
  String(key)
    .normalize("NFKC")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const SECRET_KEYS = new Set([
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
  "credentials",
]);

const isSecretKey = (key) => {
  const normalized = normalizeSecretKey(key);
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("sessiontoken") ||
    normalized.endsWith("token") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("apisecret")
  );
};

const redactString = (value, maxLength = 4096) => {
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`)
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
      REDACTED,
    )
    .replace(
      /([?&](?:access_token|refresh_token|id_token|token|session|session_id|sid|x-ut-sid|api_key|code|password|secret)=)[^&#\s]*/gi,
      `$1${encodeURIComponent(REDACTED)}`,
    )
    .replace(
      /\b((?:access_token|refresh_token|id_token|token|session|session_id|sid|x-ut-sid|api_key|password|secret|cookie)\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    );
  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}…${TRUNCATED}`
    : redacted;
};

/**
 * Returns a logging-safe copy while recursively redacting common credential
 * fields. Traversal is bounded so hostile/cyclic values cannot lock the UI.
 *
 * @param {unknown} value
 * @param {{maxDepth?: number, maxArrayLength?: number, maxObjectKeys?: number,
 * maxNodes?: number, maxStringLength?: number}} [options]
 * @returns {unknown}
 */
export const redactSecrets = (
  value,
  {
    maxDepth = 12,
    maxArrayLength = 100,
    maxObjectKeys = 100,
    maxNodes = 2000,
    maxStringLength = 4096,
  } = {},
) => {
  const seen = new WeakSet();
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
        ...(typeof current.code === "string" ? { code: current.code } : {}),
      };
    }
    if (seen.has(current)) return CIRCULAR;
    seen.add(current);
    if (Array.isArray(current)) {
      const result = current
        .slice(0, Math.max(0, maxArrayLength))
        .map((entry) => visit(entry, depth + 1));
      if (current.length > maxArrayLength) result.push(TRUNCATED);
      return result;
    }
    if (current instanceof Map) {
      return visit(Object.fromEntries(current), depth + 1);
    }
    if (current instanceof Set) {
      return visit([...current], depth + 1);
    }
    const result = {};
    const entries = Object.entries(current);
    for (const [entryKey, entryValue] of entries.slice(0, Math.max(0, maxObjectKeys))) {
      result[entryKey] = visit(entryValue, depth + 1, entryKey);
    }
    if (entries.length > maxObjectKeys) result.__truncated__ = TRUNCATED;
    return result;
  };

  return visit(value, 0);
};

const cloneLogValue = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

/**
 * Bounded in-memory activity log. Persistence is deliberately delegated to a
 * caller so this domain module has no Chrome or service-worker dependency.
 */
export class ActivityLogger {
  #clock;
  #sequence;
  #buffer;
  #subscribers;

  /**
   * @param {{maxEntries?: number, clock?: () => Date | string | number}} [options]
   */
  constructor({ maxEntries = 500, clock = () => new Date() } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 5000) {
      throw new RangeError("maxEntries must be an integer between 1 and 5000");
    }
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.maxEntries = maxEntries;
    this.#clock = clock;
    this.#sequence = 0;
    this.#buffer = [];
    this.#subscribers = new Set();
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
      data: redactSecrets(data),
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
}

export const ACTIVITY_LOG_REDACTION = REDACTED;
