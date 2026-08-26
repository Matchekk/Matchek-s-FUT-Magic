(() => {
  // src/core/activity-logger.js
  var REDACTED = "[REDACTED]";
  var CIRCULAR = "[Circular]";
  var TRUNCATED = "[Truncated]";
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
    const redacted = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`).replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
      REDACTED
    ).replace(
      /([?&](?:access_token|refresh_token|token|session_id|sid|api_key)=)[^&#\s]*/gi,
      `$1${encodeURIComponent(REDACTED)}`
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
        const result2 = current.slice(0, Math.max(0, maxArrayLength)).map((entry) => visit(entry, depth + 1));
        if (current.length > maxArrayLength) result2.push(TRUNCATED);
        return result2;
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
  var OMITTED_ACCESSOR = "[Accessor omitted]";
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
      /\b(?:access_token|refresh_token|id_token|token|session|sid|x-ut-sid|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.slice(0, Math.max(match.indexOf(":"), match.indexOf("=")) + 1)}${REDACTED2}`
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
        for (const entry of value.slice(0, options.maxItems)) {
          const sanitized = sanitizeInternal(entry, options, depth + 1, seen);
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
          result[safeKey] = OMITTED_ACCESSOR;
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
    return sanitizeInternal(value, normalizeOptions(options), 0, /* @__PURE__ */ new WeakSet());
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
    return (Array.isArray(logs) ? logs : []).slice(-limits.maxLogs).map(
      (entry) => sanitizeDiagnosticValue(entry, {
        maxDepth: 5,
        maxItems: 50,
        maxKeys: 50,
        maxStringLength: 750
      })
    );
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
      product: truncateDiagnosticString(input.product || "GrindPilot FC26", 100),
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
      healthChecks: sanitizeDiagnosticValue(input.healthChecks ?? [], {
        maxDepth: 5,
        maxItems: 100,
        maxKeys: 50,
        maxStringLength: 500
      }),
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
  function normalizeCapabilities(capabilities, limits) {
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
      capabilities: normalizeCapabilities(sourceCapabilities, limits),
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
  var ControllerAdapter = class {
    async health() {
      return verifiedValue(await requireBridge().getHealth(), "Bridge health check");
    }
    async getContext() {
      return requireBridge().getContext();
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
    profiles: "grindpilot.profiles.v1",
    projects: "grindpilot.projects.v1",
    settings: "grindpilot.settings.v1"
  });
  var DIRECT_STORAGE_ACTIONS = /* @__PURE__ */ new Set([
    "BOOTSTRAP_LOAD",
    "SETTINGS_SAVE",
    "ACTIVITY_SAVE",
    "PROJECTS_SAVE",
    "PROFILE_LIST",
    "PROFILE_GET",
    "PROFILE_PUT",
    "PROFILE_DELETE"
  ]);
  var requestId = () => globalThis.crypto?.randomUUID?.() ?? `gp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      isMovable: raw.isMovable == null ? true : Boolean(raw.isMovable),
      isStorable: raw.isStorable == null ? true : Boolean(raw.isStorable),
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
        if (item.isMovable === false) {
          actions.push(
            createAction(
              item,
              INVENTORY_RESOLUTION_ACTIONS.PAUSE,
              "unassigned_item_not_movable"
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
      if (effectivePolicy.preferSbcStorage && storageFreeSlots > 0 && item.isStorable !== false) {
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
      const normalizeSource = (items, location2) => (Array.isArray(items) ? items : []).map(
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
      const normalizedPolicy = normalizePackPolicy(policy);
      const selected3 = selectPacksForPolicy({ packs, policy: normalizedPolicy, currentReward });
      return { policy: normalizedPolicy, packs: selected3.map((pack) => ({ ...pack })) };
    }
    async open({ policy, currentReward } = {}) {
      const plan = await this.plan({ policy, currentReward });
      return this.openPlan(plan);
    }
    async openPlan(plan = {}) {
      if (!Array.isArray(plan?.packs)) {
        throw new PackPolicyError("INVALID_PACK_PLAN", "A verified owned-pack plan is required");
      }
      const opened = [];
      for (const pack of plan.packs) {
        assertNoUnassigned(await this.inventoryService.getState());
        assertOwnedFreePack(pack);
        const packId2 = idOf(pack);
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
          unresolved = getUnassignedCount(inventory);
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
  var countPacksById = (packs) => {
    const counts = /* @__PURE__ */ new Map();
    const packsById = /* @__PURE__ */ new Map();
    for (const pack of packs) {
      const id = idOf2(pack);
      const count = Number(pack?.count ?? 1);
      if (!id || !Number.isSafeInteger(count) || count < 0) {
        throw new PackPolicyError("INVALID_PACKS", "Pack snapshot contains an invalid ID or count");
      }
      const nextCount = (counts.get(id) ?? 0) + count;
      if (!Number.isSafeInteger(nextCount)) {
        throw new PackPolicyError("INVALID_PACKS", "Pack snapshot count exceeds the safe range");
      }
      counts.set(id, nextCount);
      const matches = packsById.get(id) ?? [];
      matches.push(pack);
      packsById.set(id, matches);
    }
    return { counts, packsById };
  };
  function identifyClaimedRewardPack({ claim, packsBefore = [], packsAfter = [] } = {}) {
    if (!Array.isArray(packsBefore) || !Array.isArray(packsAfter)) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshots must be arrays");
    }
    const before = countPacksById(packsBefore);
    const after = countPacksById(packsAfter);
    const positiveDeltaIds = Array.from(after.counts.entries()).filter(([id, count]) => count - (before.counts.get(id) ?? 0) > 0).map(([id]) => id);
    const explicitId = String(claim?.packId ?? claim?.rewardPackId ?? "");
    if (positiveDeltaIds.length !== 1 || explicitId && positiveDeltaIds[0] !== explicitId) {
      throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Could not uniquely identify the newly claimed pack", {
        explicitId: explicitId || null,
        positiveDeltaIds
      });
    }
    const correlatedId = positiveDeltaIds[0];
    const matches = after.packsById.get(correlatedId) ?? [];
    if (!matches.length) {
      throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "Correlated reward pack was not present");
    }
    for (const pack of matches) assertOwnedFreePack(pack);
    return matches[0];
  }
  var RewardService = class {
    constructor({ adapter, logger = null } = {}) {
      if (!adapter?.listOwnedPacks || !adapter?.claimReward) {
        throw new TypeError("RewardService requires listOwnedPacks and claimReward adapter methods");
      }
      this.adapter = adapter;
      this.logger = logger;
    }
    async claimAndIdentify(rewardRef, packsBefore = null) {
      const before = Array.isArray(packsBefore) ? packsBefore.map((pack2) => ({ ...pack2 })) : await this.adapter.listOwnedPacks();
      const claim = await this.adapter.claimReward(rewardRef, before);
      if (claim?.claimed !== true && claim?.success !== true) {
        throw new PackPolicyError("REWARD_CLAIM_UNVERIFIED", "Reward claim was not verified", { rewardRef });
      }
      const after = await this.adapter.listOwnedPacks();
      const pack = identifyClaimedRewardPack({ claim, packsBefore: before, packsAfter: after });
      this.logger?.info?.("reward.claimed", { rewardRef, packId: idOf2(pack) });
      return { claim, pack, identifiedPackId: idOf2(pack), packType: pack.packType ?? pack.type ?? null };
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
  function compareTuples(left, right) {
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
        return uniqueBest(
          offers,
          (offer) => offer.estimatedValue ?? Math.pow(Math.max(0, offer.rating ?? 0), 3),
          "HIGHEST_VALUE"
        );
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
    "targetProjectDemandPenalty",
    "nonExpendableCardUsage",
    "replacementCost",
    "ratingOvershoot",
    "nonDuplicateUsage",
    "nonStorageUsage",
    "tradableUsage",
    "premiumFodderPenalty"
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
        targetProjectDemandPenalty,
        nonExpendableCardUsage,
        replacementCost,
        ratingOvershoot,
        nonDuplicateUsage,
        nonStorageUsage,
        tradableUsage,
        premiumFodderPenalty
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
    }
    async #readRecords() {
      const stored = await this.storageArea.get(this.storageKey);
      const value = stored?.[this.storageKey];
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
      if (this.domainApi) return clone2(await this.storageArea.putProfile(clone2(profile)));
      const records = await this.#readRecords();
      records[profile.id] = clone2(profile);
      await this.storageArea.set({ [this.storageKey]: records });
      return clone2(profile);
    }
    async delete(id) {
      if (this.domainApi) return Boolean(await this.storageArea.deleteProfile(id));
      const records = await this.#readRecords();
      if (!Object.hasOwn(records, id)) return false;
      delete records[id];
      if (Object.keys(records).length === 0) await this.storageArea.remove(this.storageKey);
      else await this.storageArea.set({ [this.storageKey]: records });
      return true;
    }
  };

  // src/workflow/serialization.js
  var isPlainObject = (value) => {
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
        if (!isPlainObject(entry)) {
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
    if (isPlainObject(value)) {
      const next = {};
      for (const key of Object.keys(value).sort()) next[key] = stableValue(value[key]);
      return next;
    }
    return value;
  };
  var stableStringify = (value) => JSON.stringify(stableValue(value));
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
    if (!isPlainObject(operand)) {
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
    if (!isPlainObject(condition)) {
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
      if (isPlainObject(value)) return Object.keys(value).length;
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
  function isPlainObject2(value) {
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
      if (!isPlainObject2(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} must be a plain object`);
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
    if (!isPlainObject2(workflow) || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new ProfileValidationError("INVALID_PROFILE", "workflow.steps must be a non-empty array");
    }
    const ids = /* @__PURE__ */ new Set();
    for (const [index, step2] of workflow.steps.entries()) {
      if (!isPlainObject2(step2)) throw new ProfileValidationError("INVALID_PROFILE", `workflow step ${index} must be an object`);
      validIdentifier(step2.id, `workflow.steps[${index}].id`);
      if (ids.has(step2.id)) throw new ProfileValidationError("INVALID_PROFILE", `Duplicate workflow step ID: ${step2.id}`);
      ids.add(step2.id);
      if (typeof step2.type !== "string" || !step2.type.trim()) {
        throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].type is required`);
      }
      if (step2.config != null && !isPlainObject2(step2.config)) {
        throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].config must be an object`);
      }
    }
  }
  function validateRunLimits(runLimits) {
    if (!isPlainObject2(runLimits) || !Number.isSafeInteger(runLimits.maxIterations) || runLimits.maxIterations < 1 || runLimits.maxIterations > 1e4) {
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
      if (!isPlainObject2(condition) || typeof condition.type !== "string" || !condition.type.trim()) {
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
    if (!isPlainObject2(input)) throw new ProfileValidationError("INVALID_PROFILE", "Profile must be an object");
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
      if (!isPlainObject2(profile[field])) throw new ProfileValidationError("INVALID_PROFILE", `${field} must be an object`);
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
      if (!isPlainObject2(envelope) || envelope.format !== "grindpilot-profile" || envelope.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import envelope is invalid or unsupported");
      }
      return this.save(envelope.profile, { overwrite });
    }
  };

  // src/ui/grind-panel.js
  var css = `
:host{all:initial;color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}.launcher{position:fixed;right:18px;top:45%;z-index:2147483600;width:46px;height:46px;border:0;border-radius:15px;background:linear-gradient(145deg,#75bfff,#1e70d2);color:#fff;font-weight:900;box-shadow:0 10px 32px #0008;cursor:pointer}
.panel{position:fixed;z-index:2147483599;right:18px;top:72px;width:min(960px,calc(100vw - 36px));height:min(760px,calc(100vh - 100px));display:grid;grid-template-columns:170px 1fr;background:#10140ff2;backdrop-filter:blur(18px) saturate(140%);border:1px solid #4f6043;border-radius:18px;box-shadow:0 24px 80px #000c;overflow:hidden;color:#edf5e7}.hidden{display:none!important}
aside{padding:16px 10px;background:#151b13;border-right:1px solid #36432f;overflow:auto}.brand{padding:4px 8px 15px;font-size:17px;font-weight:800;color:#75bfff}.brand small{display:block;color:#85917e;font-size:10px;font-weight:600;margin-top:3px}.nav{display:block;width:100%;border:0;background:transparent;color:#b7c2b1;text-align:left;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:12px}.nav:hover,.nav.active{background:#263747;color:#fff}.main{padding:18px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.top h2{font-size:18px;margin:0}.close{border:0;background:#2d3529;color:#dce6d6;width:31px;height:31px;border-radius:9px;cursor:pointer}.view{display:none}.view.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.card{background:#1a2118;border:1px solid #36432f;border-radius:12px;padding:12px;margin-bottom:10px}.metric{font-size:24px;font-weight:800;color:#75bfff}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8f9b89}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}button.action{border:1px solid #53684a;background:#263420;color:#edf5e7;padding:8px 12px;border-radius:9px;cursor:pointer}button.primary{background:#2f8ee5;color:#fff;border-color:#63b0f5;font-weight:800}button.danger{background:#3a211f;border-color:#79413b}button:disabled{opacity:.42;cursor:not-allowed}.form{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:11px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-size:11px;color:#9da996}input,select,textarea{width:100%;border:1px solid #46543f;background:#11160f;color:#f4f8f0;border-radius:8px;padding:8px;font:inherit;font-size:12px}textarea{min-height:90px;resize:vertical}.hint{font-size:11px;color:#87927f;line-height:1.45}.banner{border-radius:10px;padding:9px 11px;margin-bottom:12px;background:#263747;color:#d7e7f4;font-size:12px}.banner.warn{background:#3d321d;color:#ffe3a3}.banner.error{background:#45201e;color:#ffc0b8}.log{display:grid;grid-template-columns:72px 92px 1fr;gap:8px;border-bottom:1px solid #293226;padding:7px 2px;font-size:11px}.muted{color:#86907f}.section-title{margin:18px 0 8px;font-size:13px;color:#c9d7c1}.empty{padding:25px;text-align:center;color:#778270;border:1px dashed #3e4939;border-radius:10px}.workflow-step{border-left:3px solid #2f8ee5;background:#151d20;padding:10px;margin:9px 0;border-radius:8px}.nested{margin:8px 0 12px 20px;padding-left:10px;border-left:1px dashed #526474}.requirement-row input{max-width:150px}.timeline{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.timeline span{padding:6px 9px;border-radius:20px;background:#252d25;color:#899487;font-size:11px}.timeline .done{color:#bfffc4}.timeline .active{background:#244a6d;color:#fff}.bucket-table{width:100%;border-collapse:collapse;font-size:11px}.bucket-table th,.bucket-table td{padding:7px;border-bottom:1px solid #303a2c;text-align:right}.bucket-table th:first-child,.bucket-table td:first-child{text-align:left}.health{display:grid;grid-template-columns:minmax(130px,1fr) 110px 2fr;gap:8px;padding:7px;border-bottom:1px solid #303a2c;font-size:11px}@media(max-width:680px){.panel{grid-template-columns:1fr;top:12px;height:calc(100vh - 24px)}aside{display:flex;gap:3px;overflow:auto;border-right:0;border-bottom:1px solid #36432f;padding:8px}.brand{display:none}.nav{white-space:nowrap;width:auto}.form{grid-template-columns:1fr}.health{grid-template-columns:1fr}}
.easy-hero{background:linear-gradient(145deg,#20394f,#182719);border:1px solid #4b7798;border-radius:16px;padding:18px;margin-bottom:14px}.easy-hero h3{font-size:22px;line-height:1.1;letter-spacing:-.02em;margin:0 0 7px}.easy-hero p{color:#b8c8b4;font-size:13px;line-height:1.5;margin:0}.easy-actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px}.easy-actions .action{min-height:48px;font-size:14px}.easy-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.easy-step{background:#171e16;border:1px solid #344230;border-radius:11px;padding:11px}.easy-step b{display:block;color:#75bfff;margin-bottom:3px}.easy-step span{font-size:11px;color:#9ba897;line-height:1.35}.easy-status{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.easy-status span{padding:6px 9px;border-radius:999px;background:#253025;color:#b9c7b4;font-size:11px}button.action,.launcher,.close{transition:transform 100ms ease-out,filter 120ms ease-out}button.action:active,.launcher:active,.close:active{transform:scale(.97)}details{margin:12px 0}summary{cursor:pointer;color:#b8c8b4;font-size:12px}@media(max-width:680px){.easy-steps{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){button.action,.launcher,.close{transition:none!important;transform:none!important}}@media(prefers-reduced-transparency:reduce){.panel{background:#10140f;backdrop-filter:none}}
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
    return `<div class="workflow-step"><div class="controls"><select data-wf-field="type" ${attrs}>${["SOLVE_SBC", "SUBMIT_SBC", "CLAIM_REWARD", "OPEN_REWARD_PACK", "RESOLVE_ITEMS", "ORGANIZE_ITEMS", "HANDLE_PLAYER_PICK", "DELAY", "CONDITIONAL", "LOOP", "PAUSE"].map((value) => `<option${selected2(step2.type, value)}>${value}</option>`).join("")}</select><button class="action" data-wf-action="up" ${attrs}>↑</button><button class="action" data-wf-action="down" ${attrs}>↓</button><button class="action" data-wf-action="duplicate" ${attrs}>Duplicate</button><button class="action danger" data-wf-action="delete" ${attrs}>Delete</button></div><div class="hint">${escapeHtml(step2.id)}</div>${config}<div class="form"><div class="field"><label>Timeout ms</label><input type="number" min="100" data-wf-field="timeoutMs" ${attrs} value="${escapeHtml(step2.timeoutMs || 12e4)}"></div><div class="field"><label>Retry attempts</label><input type="number" min="1" max="10" data-wf-field="retryAttempts" ${attrs} value="${escapeHtml(step2.retryPolicy?.maxAttempts || 1)}"></div><div class="field"><label>On failure</label><select data-wf-field="onFailure" ${attrs}>${["PAUSE", "STOP", "SKIP"].map((value) => `<option${selected2(step2.onFailure, value)}>${value}</option>`).join("")}</select></div></div></div>`;
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
  var ratingRequirementRows = (requirements = []) => requirements.map((entry) => `<div class="controls requirement-row" data-rating-row><input aria-label="Rating" type="number" min="1" max="99" data-rating="rating" value="${escapeHtml(entry.rating)}"><input aria-label="Count" type="number" min="1" data-rating="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-rating="completed" value="${escapeHtml(entry.completed)}"><button class="action danger" data-remove-row>×</button></div>`).join("");
  var specialRequirementRows = (requirements = []) => requirements.map((entry) => `<div class="controls requirement-row" data-special-row><input aria-label="Card type" data-special="cardType" value="${escapeHtml(entry.cardType)}"><input aria-label="Count" type="number" min="1" data-special="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-special="completed" value="${escapeHtml(entry.completed)}"><label><input type="checkbox" data-special="perRemainingSquad"${checked(entry.perRemainingSquad)}> per squad</label><button class="action danger" data-remove-row>×</button></div>`).join("");
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
    constructor(runtime) {
      this.runtime = runtime;
      this.host = document.createElement("grindpilot-panel");
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.state = runtime.getState();
      this.activeSection = "Easy Loop";
      this.renderShell();
      document.documentElement.appendChild(this.host);
      this.unsubscribe = runtime.subscribe((state) => {
        this.state = state;
        this.renderViews();
      });
      this.renderViews();
    }
    renderShell() {
      this.shadow.innerHTML = `<style>${css}</style><button class="launcher" title="GrindPilot FC26">GP</button><section class="panel hidden"><aside><div class="brand">GrindPilot FC26<small>ONE SBC GRIND MANAGER</small></div>${sections.map((name) => `<button class="nav${name === this.activeSection ? " active" : ""}" data-section="${name}">${name}</button>`).join("")}</aside><main class="main"><div class="top"><h2></h2><button class="close" title="Close">×</button></div><div class="content"></div></main></section>`;
      this.shadow.querySelector(".launcher").addEventListener("click", () => this.toggle(true));
      this.shadow.querySelector(".close").addEventListener("click", () => this.toggle(false));
      this.shadow.querySelectorAll(".nav").forEach((node) => node.addEventListener("click", () => {
        this.activeSection = node.dataset.section;
        this.shadow.querySelectorAll(".nav").forEach((entry) => entry.classList.toggle("active", entry === node));
        this.renderViews();
      }));
    }
    toggle(open) {
      this.shadow.querySelector(".panel").classList.toggle("hidden", !open);
      this.shadow.querySelector(".launcher").classList.toggle("hidden", open);
      if (open) this.runtime.refreshStatus?.();
    }
    banner() {
      const reason = this.state.pauseReason || this.state.error;
      if (reason) return `<div class="banner ${this.state.error ? "error" : "warn"}">${escapeHtml(reason)}</div>`;
      return `<div class="banner">GrindPilot is ${escapeHtml(this.state.bridgeHealth === "healthy" ? "ready" : this.state.bridgeHealth || "checking")}</div>`;
    }
    renderViews() {
      const content = this.shadow.querySelector(".content");
      this.shadow.querySelector(".top h2").textContent = this.activeSection;
      const render = this[`render${this.activeSection.replaceAll(" ", "")}`]?.bind(this) ?? (() => "");
      content.innerHTML = this.banner() + render();
      this.bindViewActions(content);
    }
    renderEasyLoop() {
      const s = this.state;
      const count = Number(s.unassignedCount || 0);
      const runActive = !["idle", "completed", "stopped", "failed"].includes(String(s.runStatus || "idle"));
      const storageFull = Number(s.storageCount || 0) >= Number(s.storageCapacity || 100);
      const nextTitle = count > 0 ? `Organize ${count} item${count === 1 ? "" : "s"}` : "Quick Open the next pack";
      const nextBody = count > 0 ? storageFull ? "SBC Storage is full. Every remaining card will be used directly in 10x85." : "Safe cards go to Club or SBC Storage. Anything left is recycled in 10x85." : "Open exactly one owned pack. Purchases are always blocked.";
      const icons = { completed: "✓", running: "→", waiting: "→", paused: "!", failed: "×", pending: "○" };
      const timeline = (s.timeline || []).map((entry) => `<span class="${entry.status === "completed" ? "done" : entry.active ? "active" : ""}">${icons[entry.status] || "○"} ${escapeHtml(entry.type.replaceAll("_", " "))}</span>`).join("");
      const analytics = s.analytics || {};
      const consumed = analytics.ratingFlow?.consumed || {};
      const received = analytics.ratingFlow?.received || {};
      return `<section class="easy-hero"><h3>${escapeHtml(nextTitle)}</h3><p>${escapeHtml(nextBody)}</p><div class="easy-status"><span>Storage ${escapeHtml(`${s.storageCount || 0}/${s.storageCapacity || 100}`)}</span><span>${escapeHtml(count)} unassigned</span><span>${escapeHtml(s.packsOpened || 0)} packs opened</span></div><div class="easy-actions"><button class="action ${count > 0 ? "primary" : ""}" data-action="recycle-cards"${count < 1 || runActive ? " disabled" : ""}>Organize now</button><button class="action ${count < 1 ? "primary" : ""}" data-action="quick-open"${count > 0 || runActive ? " disabled" : ""}>Quick Open one pack</button></div></section><div class="easy-steps"><div class="easy-step"><b>1 · Quick Open</b><span>Open one owned pack.</span></div><div class="easy-step"><b>2 · Organize</b><span>Move safe cards and recycle leftovers.</span></div><div class="easy-step"><b>3 · Repeat</b><span>Continue until your target SBC is finished.</span></div></div>${timeline ? `<details><summary>Current run</summary><div class="timeline">${timeline}</div></details>` : ""}<details><summary>Run details</summary><div class="grid">${[
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
      return `<div class="card"><p>Der bewährte AutoPilot-Solver bleibt der Produktionsstandard.</p><p class="hint">Solve Squad, Multi Solve und Solve Entire Set bleiben in den vorhandenen SBC-Ansichten erreichbar. GrindPilot ergänzt diese Funktionen um persistente Workflows und Schutzrichtlinien.</p><button class="action" data-action="legacy-sequence">Open legacy sequence planner</button></div>`;
    }
    renderWorkflows() {
      const cfg = this.state.draft || {};
      const templates = this.state.workflowTemplates || [];
      const legacy = this.state.legacySequences || [];
      const workflow = this.state.workflowDraft || { steps: [] };
      return `<div class="form"><div class="field"><label>Mode</label><select data-field="mode"><option${selected2(cfg.mode, "REVIEW")}>REVIEW</option><option${selected2(cfg.mode, "ASSISTED")}>ASSISTED</option><option${selected2(cfg.mode, "AUTO")}>AUTO</option></select></div><div class="field"><label>Iterations (hard limit)</label><input data-field="maxIterations" type="number" min="1" max="1000" value="${escapeHtml(cfg.maxIterations || 1)}"></div><div class="field"><label>Template</label><select data-template-select>${templates.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}</select></div><div class="field"><label>Player pick policy</label><select data-field="pickMode"><option${selected2(cfg.pickMode, "PAUSE_FOR_USER")}>PAUSE_FOR_USER</option><option${selected2(cfg.pickMode, "HIGHEST_RATING")}>HIGHEST_RATING</option><option${selected2(cfg.pickMode, "HIGHEST_VALUE")}>HIGHEST_VALUE</option><option${selected2(cfg.pickMode, "PREFER_NON_DUPLICATE")}>PREFER_NON_DUPLICATE</option><option${selected2(cfg.pickMode, "PREFER_REQUIRED_SPECIAL")}>PREFER_REQUIRED_SPECIAL</option><option${selected2(cfg.pickMode, "CUSTOM_PRIORITY")}>CUSTOM_PRIORITY</option></select></div><div class="field"><label>Custom priority criteria</label><input data-field="pickCriteria" value="${escapeHtml((cfg.pickPolicy?.criteria || []).join(", "))}" placeholder="NON_DUPLICATE, REQUIRED_SPECIAL, RATING, VALUE"></div><div class="field"><label>Reward packs</label><select data-field="packMode"><option${selected2(cfg.packMode, "OPEN_CURRENT_REWARD")}>OPEN_CURRENT_REWARD</option><option${selected2(cfg.packMode, "OPEN_MATCHING_PACKS")}>OPEN_MATCHING_PACKS</option><option${selected2(cfg.packMode, "OPEN_ALL_ALLOWED_PACKS")}>OPEN_ALL_ALLOWED_PACKS</option></select></div><div class="field"><label>Max packs per pack step</label><input data-field="maxPacks" type="number" min="1" max="100" value="${escapeHtml(cfg.maxPacks || 1)}"></div></div><div class="controls"><button class="action" data-action="apply-template">Use template</button><button class="action" data-wf-add="${encodePath([])}">Add Step</button><button class="action" data-action="save-workflow">Save workflow</button><button class="action primary" data-action="start">Start workflow</button></div><div class="section-title">${escapeHtml(workflow.name || "Workflow")} · ordered typed steps</div>${renderWorkflowSteps(workflow.steps, [])}<div class="section-title">Legacy Sequence migration</div><div class="controls"><button class="action" data-action="refresh-legacy">Find legacy plans</button><select data-legacy-select>${legacy.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select><button class="action" data-action="import-legacy">Import Legacy Sequence</button></div><p class="hint">Specific set/challenge targets are verified by stable EA IDs. GrindPilot pauses and asks you to open the target when safe controller navigation is unavailable.</p>`;
    }
    renderProfiles() {
      return `<div class="controls"><button class="action" data-action="save-profile">Save current profile</button><button class="action" data-action="export-profile">Export</button><label class="action">Import<input data-action="import-profile" type="file" accept="application/json" hidden></label></div>${(this.state.profiles || []).length ? (this.state.profiles || []).map((p) => `<div class="card"><b>${escapeHtml(p.name)}</b><div class="hint">${escapeHtml(p.id)}</div><button class="action" data-load-profile="${escapeHtml(p.id)}">Load</button></div>`).join("") : '<div class="empty">No saved grind profiles yet.</div>'}`;
    }
    renderInventory() {
      const i = this.state.inventory || {};
      const buckets = this.state.inventoryBuckets || {};
      const cfg = this.state.draft || {};
      const targets = (this.state.projects || []).filter((project) => project.active !== false && project.sourceSetId && project.completionProgress < 1);
      return `<div class="grid"><div class="card"><div class="label">Club</div><div class="metric">${i.clubCount || 0}</div></div><div class="card"><div class="label">SBC Storage</div><div class="metric">${i.storageCount || 0}</div></div><div class="card"><div class="label">Free slots</div><div class="metric">${i.storageFreeSlots ?? "?"}</div></div><div class="card"><div class="label">Unassigned</div><div class="metric">${i.unassignedCount || 0}</div></div></div><div class="card"><div class="field"><label>Organizer fallback SBC</label><select data-organizer-target><option value="">Auto: 85x10, otherwise highest priority</option>${targets.map((project) => `<option value="${escapeHtml(project.id)}"${selected2(String(cfg.organizerTargetProjectId || ""), String(project.id))}>${escapeHtml(project.name)}</option>`).join("")}</select></div><div class="controls"><button class="action" data-action="save-organizer">Save target</button><button class="action" data-action="quick-open"${Number(i.unassignedCount || 0) > 0 ? " disabled" : ""}>Quick Open</button><button class="action primary" data-action="recycle-cards"${Number(i.unassignedCount || 0) < 1 ? " disabled" : ""}>Organize</button><button class="action" data-action="inventory">Synchronize</button></div><p class="hint">Normal cards go to Club. Duplicates use only verified free SBC Storage slots. If Storage is full, every remaining card becomes mandatory in the selected SBC; if that exact squad is impossible, no submit occurs.</p></div><table class="bucket-table"><thead><tr><th>Rating</th><th>Club</th><th>Storage</th><th>Unassigned</th></tr></thead><tbody>${Object.entries(buckets).map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${value.club}</td><td>${value.storage}</td><td>${value.unassigned}</td></tr>`).join("")}</tbody></table>`;
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
      const health = (this.state.capabilityHealth || []).filter((entry) => entry && typeof entry === "object");
      return `<div class="form"><div class="field"><label><input data-field="developerMode" type="checkbox" ${d.enabled ? "checked" : ""}> Developer Mode</label></div></div><div class="section-title">Capability Health</div>${health.map((entry) => `<div class="health"><b>${escapeHtml(entry.id)}</b><span>${escapeHtml(entry.status)}</span><span class="hint">${escapeHtml(JSON.stringify(entry.evidence || {}))}</span></div>`).join("") || '<div class="empty">Refresh to inspect safe capabilities.</div>'}<div class="controls"><button class="action" data-action="refresh">Refresh health</button><button class="action" data-action="diagnostic-snapshot">Take snapshot</button><button class="action" data-action="diagnostic-export">Export diagnostics</button></div><textarea readonly>${escapeHtml(JSON.stringify(d.latest || d, null, 2))}</textarea><p class="hint">Instrumentation remains dormant while Developer Mode is disabled. Export is redacted and excludes request bodies, headers and credentials. UNVERIFIED means capability presence was observed without dispatching a destructive operation.</p>`;
    }
    readDraft(root) {
      const get = (name) => root.querySelector(`[data-field="${name}"]`);
      const pickMode = get("pickMode")?.value || "PAUSE_FOR_USER";
      return { ...this.state.draft || {}, mode: get("mode")?.value || "REVIEW", maxIterations: Number(get("maxIterations")?.value || 1), storageCapacity: Number(get("storageCapacity")?.value || this.state.storageCapacity || 100), packMode: get("packMode")?.value || "OPEN_CURRENT_REWARD", maxPacks: Number(get("maxPacks")?.value || 1), pickMode, pickPolicy: { ...this.state.draft?.pickPolicy || {}, type: pickMode, criteria: splitList(get("pickCriteria")?.value) }, workflow: this.state.workflowDraft || this.state.draft?.workflow };
    }
    bindViewActions(root) {
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
.grindpilot-pack-action-row{display:flex!important;align-items:stretch!important;gap:8px!important}
.grindpilot-pack-action-row>.grindpilot-native-open-peer,
.grindpilot-pack-action-row>.grindpilot-quick-open-native{flex:1 1 0!important;width:auto!important;min-width:0!important;margin-left:0!important;margin-right:0!important}
.grindpilot-quick-open-native,.grindpilot-organize-native{cursor:pointer}
.grindpilot-quick-open-native:disabled,.grindpilot-organize-native:disabled{cursor:not-allowed!important;opacity:.45!important}
.grindpilot-organize-native{width:auto!important;min-width:92px!important;padding-left:14px!important;padding-right:14px!important;margin-left:auto!important;margin-right:8px!important;white-space:nowrap!important}
`;
  var createNativePeer = (peer, { className, label, title }) => {
    const button = (peer?.ownerDocument || document).createElement("button");
    button.type = "button";
    button.className = `${peer?.className || ""} ${className}`.trim();
    button.textContent = label;
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
      this.unsubscribe = runtime.subscribe((state) => {
        this.state = state;
        this.scheduleSync();
      });
      this.installStyles();
      this.observer = MutationObserver ? new MutationObserver(() => this.scheduleSync()) : null;
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
      queueMicrotask(() => {
        this.syncQueued = false;
        this.sync();
      });
    }
    sync() {
      this.mountQuickOpenButtons();
      this.mountOrganizeButton();
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
          label: "Quick Open",
          title: `Quick Open ${packName}`
        });
        quickOpen.dataset.packName = packName;
        quickOpen.disabled = true;
        quickOpen.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const packId2 = quickOpen.dataset.packId;
          if (!packId2 || quickOpen.disabled) return;
          quickOpen.disabled = true;
          try {
            await this.runtime.quickOpenPack({ packId: packId2 });
          } catch (error) {
            this.runtime.reportUiError(error);
          } finally {
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
      for (const button of buttons) button.disabled = true;
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
          continue;
        }
        button.dataset.packId = ids[0];
        button.disabled = false;
        button.title = `Quick Open ${button.dataset.packName}`;
      }
    }
    mountOrganizeButton() {
      if (this.root.querySelector(".grindpilot-organize-native")) {
        this.updateOrganizeButton();
        return;
      }
      const menu = findItemsMenu(this.root);
      if (!menu?.parentElement) return;
      const organize = createNativePeer(menu, {
        className: "grindpilot-organize-native",
        label: "Organize",
        title: "Move safe cards, then recycle every remaining card in 10x85"
      });
      organize.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (organize.disabled) return;
        organize.disabled = true;
        try {
          await this.runtime.recycleCards();
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          this.scheduleSync();
        }
      });
      menu.parentElement.insertBefore(organize, menu);
      this.updateOrganizeButton();
    }
    updateOrganizeButton() {
      const organize = this.root.querySelector(".grindpilot-organize-native");
      if (!organize) return;
      const count = Number(this.state.unassignedCount || 0);
      const label = count > 0 ? `Organize (${count})` : "Organize";
      if (organize.textContent !== label) organize.textContent = label;
      if (organize.getAttribute("aria-label") !== label) organize.setAttribute("aria-label", label);
      organize.disabled = count < 1 || !isIdleStatus(this.state.runStatus);
      organize.title = count > 0 ? `Organize ${count} item${count === 1 ? "" : "s"}: Club/Storage first, then 10x85` : "No unassigned items";
    }
    dispose() {
      this.packRefreshToken += 1;
      this.observer?.disconnect();
      this.unsubscribe?.();
      this.root.querySelectorAll(".grindpilot-quick-open-native,.grindpilot-organize-native").forEach((node) => node.remove());
      this.root.getElementById("grindpilot-ea-surface-styles")?.remove();
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
    const raw = isPlainObject(value) ? value : {};
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
      (step2, index) => normalizeStep(step2, context, `${path}[${index}]`, context.depth + 1)
    );
  };
  var normalizeStepConfig = (type, value, context, path) => {
    const raw = isPlainObject(value) ? cloneSerializable(value) : {};
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
    if (!isPlainObject(value)) {
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
    const raw = isPlainObject(value) ? value : {};
    if (!isPlainObject(value)) {
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
      metadata: isPlainObject(raw.metadata) ? cloneSerializable(raw.metadata) : {}
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
    return `wf-${fnv1aHash(stableStringify(normalized))}`;
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
    safeToRetry: error?.safeToRetry === true || error?.notApplied === true,
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
      if (node.status === StepStatus.RUNNING) {
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
            this._completeNode(node, outcome2?.result ?? null);
            this.run.status = RunStatus.PAUSED;
            this.run.pauseReason = {
              code: "RECOVERED_STEP_COMPLETED",
              message: "The interrupted step was verified as completed. Resume to continue."
            };
          } else if (status === "not_applied" || status === "retry") {
            node.status = StepStatus.PENDING;
            node.error = null;
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
            ...isPlainObject(prepared) ? cloneSerializable(prepared) : {}
          };
          assertSerializable(node.intent, "Workflow step intent");
          this._record("STEP_INTENT_PREPARED", {
            executionId: node.executionId,
            operationId: node.intent.operationId
          });
          await this._persist();
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
          node.status = StepStatus.WAITING;
          node.result = cloneSerializable(outcome2?.result ?? null);
          node.waitUntil = Number.isFinite(Number(outcome2?.resumeAt)) ? Number(outcome2.resumeAt) : null;
          this.run.status = RunStatus.WAITING;
          this._record("STEP_WAITING", { executionId: node.executionId, wakeAt: node.waitUntil });
        } else if (outcomeStatus === "paused") {
          node.status = StepStatus.PAUSED;
          node.result = cloneSerializable(outcome2?.result ?? null);
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: String(outcome2?.code ?? "HANDLER_PAUSED"),
            message: String(outcome2?.message ?? "Step paused by its handler.")
          };
        } else if (outcomeStatus === "skipped") {
          this._skipNode(node, outcome2?.result ?? null);
        } else if (outcomeStatus === "failed") {
          const error = new WorkflowError(outcome2?.message ?? "Step handler reported failure", {
            code: outcome2?.code ?? "STEP_FAILED",
            details: outcome2?.details ?? null
          });
          error.safeToRetry = outcome2?.safeToRetry === true;
          error.ambiguous = outcome2?.ambiguous === true;
          throw error;
        } else {
          this._completeNode(node, outcome2?.result ?? outcome2 ?? null);
        }
        await this._persist();
      } catch (error) {
        await this._handleStepError(node, error);
      }
    }
    async _handleStepError(node, error) {
      if (node.status !== StepStatus.RUNNING) node.attempt += 1;
      const normalized = normalizeError(error);
      const destructive = isDestructive(node.step);
      const ambiguous = normalized.ambiguous || destructive && normalized.safeToRetry !== true;
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
      if (node.attempt < policy.maxAttempts && codeAllowed) {
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
      return isPlainObject(context) ? context : {};
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
      this.logger = options.logger ?? new ActivityLogger({ maxEntries: 500 });
      this.targets = options.targets ?? new TargetProjectService();
      this.enableUi = options.enableUi !== false;
      this.enableActivityPersistence = options.enableActivityPersistence !== false;
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
      this.inventoryAvailable = false;
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
        pauseReason: null,
        error: null
      };
      this.inventoryFacade = {
        getState: async () => ({ unassigned: this.inventory.getSnapshot().unassigned.items }),
        refresh: async () => this.refreshInventory()
      };
      this.rewardService = new RewardService({ adapter: this.adapter, logger: this.domainLogger() });
      this.packService = new PackService({ adapter: this.adapter, inventoryService: this.inventoryFacade, logger: this.domainLogger() });
      this.playerPickService = new PlayerPickService({
        adapter: this.adapter,
        logger: this.domainLogger()
      });
      this.engine = new WorkflowEngine({
        repository: options.workflowRepository ?? new PageWorkflowRepository(this.storage),
        handlers: this.createHandlers(),
        contextProvider: () => this.conditionContext(),
        modeGate: (input) => this.evaluateRunGate(input)
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
    domainLogger() {
      return { info: (action, data) => this.logger.info(action, action, data), warn: (action, data) => this.logger.warn(action, action, data) };
    }
    async initialize() {
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
            if (target.kind === "SPECIFIC_CHALLENGE" && String(context?.challengeId ?? "") !== String(target.challengeId ?? "")) {
              return {
                status: "paused",
                code: "SBC_TARGET_NOT_OPEN",
                message: "Open the workflow's stable challenge ID before continuing.",
                result: { target, observed: context }
              };
            }
            if (target.kind === "SPECIFIC_SET" && String(context?.setId ?? "") !== String(target.setId ?? "")) {
              return {
                status: "paused",
                code: "SBC_TARGET_NOT_OPEN",
                message: "Open the workflow's stable SBC set ID before continuing.",
                result: { target, observed: context }
              };
            }
            await this.refreshInventory();
            const policy = new FodderPolicy({
              protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
              protectedCardTypes: this.config.protectedCardTypes,
              protectedItemIds: this.config.protectedItemIds || [],
              protectedPlayerIds: this.config.protectedPlayerIds || [],
              protectedResourceIds: this.config.protectedResourceIds || [],
              protectStartingSquad: this.config.protectStartingSquad === true,
              protectFavorites: this.config.protectFavorites === true,
              protectTradables: this.config.protectTradables === true,
              preferUntradeables: this.config.preferUntradeables !== false,
              preferDuplicates: this.config.preferDuplicates !== false,
              preferSbcStorage: this.config.preferSbcStorage !== false,
              minimumReserveByRating: this.config.minimumReserveByRating || {}
            }, { targetProjects: this.targets });
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
            const explanation = policy.explainSelection(
              solved.solutionIds,
              inventoryItems
            );
            const selectedIds = new Set((solved.solutionIds ?? []).map(String));
            const selectedItems = inventoryItems.filter((item) => selectedIds.has(String(item.itemId))).map((item) => ({ itemId: item.itemId, rating: item.rating }));
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
          execute: async ({ intent }) => {
            const reward = await this.rewardService.claimAndIdentify(
              { source: "current-sbc" },
              intent.packsBefore
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
              packId: String(plan.packs[0]?.packId ?? plan.packs[0]?.id ?? ""),
              packsBefore: await this.adapter.listOwnedPacks(),
              inventoryItemIdsBefore: [...inventoryItemIds(inventoryBefore)]
            };
          },
          execute: async ({ intent }) => {
            const opened = await this.packService.openPlan(intent.plan);
            if (!opened.opened?.length) return { status: "paused", code: opened.reason || "PACK_NOT_OPENED", message: "Reward pack was not opened and verified", result: opened };
            const beforeIds = new Set((intent.inventoryItemIdsBefore ?? []).map(String));
            const receivedItems = this.inventory.getSnapshot().items.filter((item) => !beforeIds.has(String(item.itemId))).map((item) => ({ itemId: item.itemId, rating: item.rating }));
            this.logger.info("Pack", "Reward pack opened", { packId: opened.opened[0].packId });
            return outcome({ ...opened, receivedItems });
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
            await this.refreshInventory();
            const plan = this.inventory.planUnassignedResolution({
              preferSbcStorage: this.config.preferSbcStorage !== false,
              tradableWhenStorageUnavailable: "SAFE_HOLD",
              untradeableWhenStorageUnavailable: "PAUSE"
            });
            const allowPartial = step2?.config?.allowPartial === true;
            const expectedActions = allowPartial ? plan.actions.filter(
              (action) => ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(action.type)
            ) : plan.actions;
            return {
              plan,
              expectedActions,
              allowPartial,
              allowUnresolved: step2?.config?.allowUnresolved === true
            };
          },
          execute: async ({ intent }) => {
            if (intent?.plan?.requiresUserAction && !intent?.allowPartial) {
              return {
                status: "paused",
                code: "UNASSIGNED_USER_ACTION_REQUIRED",
                message: "The persisted duplicate plan requires a user decision; no item was moved.",
                result: intent.plan
              };
            }
            const result = await this.adapter.resolveUnassigned({
              storageCapacity: this.state.storageCapacity,
              expectedActions: intent.expectedActions,
              allowPartial: intent.allowPartial === true
            });
            await this.refreshInventory();
            if (result.unresolvedUnassigned > 0 && !intent?.allowUnresolved) {
              this.logger.warn("Duplicate", "Unresolved items require user action", { count: result.unresolvedUnassigned });
              return { status: "paused", code: "UNRESOLVED_UNASSIGNED", message: `${result.unresolvedUnassigned} unassigned item(s) require a safe policy decision`, result };
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
                return recovery("completed", {
                  movedToClub: actions.filter((action) => action.to === "club").map((action) => action.itemId),
                  movedToStorage: actions.filter((action) => action.to === "sbc_storage").map((action) => action.itemId)
                });
              }
              if (stillUnassigned === actions.length) return recovery("not_applied");
              return recovery("ambiguous", null, "Unassigned resolution is partial or items are missing");
            } catch (error) {
              return recovery("ambiguous", null, error?.message || "Unassigned post-state is unavailable");
            }
          }
        },
        [WorkflowStepType.ORGANIZE_ITEMS]: {
          prepare: async () => {
            await this.refreshInventory();
            const unassigned = this.inventory.getSnapshot().unassigned.items;
            const requiredItemIds = unassigned.map((item) => String(item.itemId));
            if (!requiredItemIds.length) return { requiredItemIds: [], target: null };
            if (requiredItemIds.length > 11) {
              const error = new Error(
                "More than 11 cards remain unassigned; Organizer will not consume only a partial batch"
              );
              error.code = "ORGANIZER_TOO_MANY_ITEMS";
              throw error;
            }
            const target = await this.getOrganizerTarget();
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
            const analysis = policy.analyze(this.inventory.getSnapshot().items);
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
              target,
              requiredItemIds,
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
              if (!expected.length || present.length === 0) {
                if (challengeState?.completed === true) {
                  await this.recordVerifiedTargetCompletion({
                    expectedSetId: intent.target?.setId,
                    expectedChallengeId: intent.target?.challengeId
                  });
                }
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
          prepare: async ({ run, step: step2 }) => {
            const pickPolicy = step2?.config?.policy && typeof step2.config.policy === "object" ? step2.config.policy : this.currentPickPolicy();
            const decision = await this.playerPickService.handle({
              policy: pickPolicy,
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
              pickPolicy,
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
                code: intent?.decisionReason || "PLAYER_PICK_UNVERIFIED",
                message: "Player-pick offers are unavailable, incomplete, or ambiguous. No selection was made.",
                result: { policy: intent?.pickPolicy ?? this.currentPickPolicy() }
              };
            }
            const decision = await this.playerPickService.handle({
              pickId: intent.pickIntent.pickIdentity,
              policy: intent.pickPolicy ?? this.currentPickPolicy(),
              context: this.playerPickContext(),
              execute: run.mode !== WorkflowMode.REVIEW,
              approved: run.mode !== WorkflowMode.REVIEW,
              expectedIntent: intent.pickIntent
            });
            if (decision.status === "completed" || run.mode === WorkflowMode.REVIEW && decision.status === "selected") {
              if (decision.status === "completed") {
                this.state.picksCompleted = Number(this.state.picksCompleted || 0) + 1;
                await this.refreshInventory();
              }
              return outcome({ ...decision, reviewOnly: run.mode === WorkflowMode.REVIEW });
            }
            return {
              status: "paused",
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
      await this.storage.saveProjects(this.state.projects);
      return updated;
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
    evaluateRunGate({ run, node }) {
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
      const reached = checks.find(([blocked]) => blocked);
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
      const snapshot = this.getState();
      for (const listener of this.listeners) listener(snapshot);
    }
    onRun(run) {
      if (!run) return;
      const node = run.nodes?.[run.cursor];
      const completed2 = (type) => run.nodes.filter((entry) => entry.step?.type === type && entry.status === "completed");
      this.state.runStatus = run.status;
      this.state.currentStep = node?.step?.type || null;
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
      await this.refreshInventory();
      const plan = this.inventory.planUnassignedResolution({
        preferSbcStorage: this.config.preferSbcStorage !== false,
        tradableWhenStorageUnavailable: "SAFE_HOLD",
        untradeableWhenStorageUnavailable: "PAUSE"
      });
      const pendingUnassignedCount = this.inventory.getSnapshot().unassigned.items.length;
      if (!plan.actions.length && pendingUnassignedCount === 0) {
        this.logger.info("Recycle Cards", "No unassigned cards need recycling", null);
        return { status: "completed", result: plan };
      }
      const toClub = plan.actions.filter((action) => action.type === "SEND_TO_CLUB").length;
      const toStorage = plan.actions.filter(
        (action) => action.type === "MOVE_TO_SBC_STORAGE"
      ).length;
      const organizerTarget = null;
      const configuredPickPolicy = this.currentPickPolicy();
      const organizerPickPolicy = configuredPickPolicy.type === "PAUSE_FOR_USER" ? { type: "HIGHEST_VALUE" } : configuredPickPolicy;
      const playerPickSteps = Array.from({ length: 11 }, (_, index) => ({
        id: `organize-player-pick-${index + 1}`,
        type: WorkflowStepType.HANDLE_PLAYER_PICK,
        config: { policy: organizerPickPolicy },
        timeoutMs: 3e4,
        retryPolicy: { maxAttempts: 1 },
        onFailure: "PAUSE"
      }));
      const definition = {
        id: "recycle-cards",
        name: "Recycle Cards",
        version: 1,
        metadata: { source: "grindpilot-recycle-button", safetyModel: "fail-closed" },
        steps: [
          ...playerPickSteps,
          {
            id: "recycle-unassigned-items",
            type: WorkflowStepType.RESOLVE_ITEMS,
            config: {
              allowPartial: true,
              allowUnresolved: true
            },
            timeoutMs: 45e3,
            retryPolicy: { maxAttempts: 1 },
            onFailure: "PAUSE"
          },
          {
            id: "organize-remaining-items",
            type: WorkflowStepType.ORGANIZE_ITEMS,
            timeoutMs: 18e4,
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
        organizerTarget: organizerTarget?.name ?? null
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
      await this.refreshInventory();
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
        const error = new Error("No uniquely selected owned pack is ready for Quick Open");
        error.code = "QUICK_OPEN_PACK_UNAVAILABLE";
        throw error;
      }
      const pack = plan.packs[0];
      const packId2 = String(pack?.packId ?? pack?.id ?? "");
      const label = String(pack?.name ?? pack?.packName ?? pack?.type ?? packId2);
      if (!requestedPackId && !this.confirm(`Quick Open ${label}?

Only this already-owned pack will be opened. No purchase is allowed.`)) {
        return { status: "cancelled", result: { packId: packId2 } };
      }
      const definition = {
        id: "quick-open-pack",
        name: "Quick Open",
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
      this.logger.info("Quick Open", "Approved one verified owned pack", { packId: packId2 });
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
      try {
        this.state.capabilityHealth = await this.adapter.getCapabilityHealth();
      } catch {
      }
      this.emit();
      return this.getState();
    }
    async refreshInventory() {
      if (this.inventoryRefreshPromise) return this.inventoryRefreshPromise;
      this.inventoryRefreshPromise = (async () => {
        this.inventoryAvailable = false;
        const raw = await this.adapter.readInventory();
        const snapshot = this.inventory.synchronize({ club: raw.club, storage: raw.storage, unassigned: raw.unassigned, storageCapacity: this.state.storageCapacity });
        this.inventoryAvailable = true;
        const status = this.inventory.getStatus();
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
      const snapshot = await this.adapter.readCurrentSbcProject();
      const project = this.targets.importCurrentSbc(snapshot);
      this.state.projects = this.targets.list();
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
      const snapshot = await this.adapter.readCurrentSbcProject();
      const project = this.targets.synchronizeFromCurrentSbc(id, snapshot);
      this.state.projects = this.targets.list();
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
