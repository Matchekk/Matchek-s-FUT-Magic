import { ERROR_CODES, GrindPilotError, toGrindPilotError } from "./errors.js";

const ENVELOPE_VERSION = 1;
const DEFAULT_MAX_BYTES = 256 * 1024;
const encoder = new TextEncoder();

/**
 * @typedef {{read(key: string): Promise<string|null|undefined>|string|null|undefined,
 * write(key: string, value: string): Promise<void>|void}} StorageAdapter
 */

const assertStorageAdapter = (storage) => {
  if (!storage || typeof storage.read !== "function" || typeof storage.write !== "function") {
    throw new TypeError("storage must provide read(key) and write(key, value)");
  }
};

const normalizeAllowlist = (allowlist, defaultMaxBytes) => {
  const result = new Map();
  const entries = Array.isArray(allowlist)
    ? allowlist.map((key) => [key, { maxBytes: defaultMaxBytes }])
    : Object.entries(allowlist ?? {});
  for (const [key, rawConfig] of entries) {
    if (typeof key !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/i.test(key)) {
      throw new TypeError(`Invalid storage allowlist key: ${String(key)}`);
    }
    const config =
      typeof rawConfig === "number" ? { maxBytes: rawConfig } : rawConfig ?? {};
    const maxBytes = config.maxBytes ?? defaultMaxBytes;
    if (!Number.isInteger(maxBytes) || maxBytes < 64) {
      throw new RangeError(`maxBytes for ${key} must be an integer of at least 64`);
    }
    result.set(key, Object.freeze({ maxBytes }));
  }
  if (result.size === 0) throw new TypeError("storage allowlist must not be empty");
  return result;
};

const cloneJsonValue = (value) => {
  if (value === undefined) {
    throw new GrindPilotError(
      ERROR_CODES.INVALID_ARGUMENT,
      "Storage values must be JSON serializable",
    );
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Value has no JSON representation");
    return JSON.parse(serialized);
  } catch (cause) {
    throw new GrindPilotError(
      ERROR_CODES.INVALID_ARGUMENT,
      "Storage values must be JSON serializable",
      { cause },
    );
  }
};

const publicRecord = (key, envelope) => ({
  key,
  exists: envelope.deleted !== true,
  revision: envelope.revision,
  updatedAt: envelope.updatedAt,
  value: envelope.deleted === true ? null : cloneJsonValue(envelope.value),
});

/**
 * Allowlisted, revisioned JSON repository over an injected string adapter.
 * Writes are serialized per key inside an instance. `expectedRevision` gives
 * callers fail-closed optimistic concurrency across page/service-worker state.
 */
export class RevisionedStorageRepository {
  #storage;
  #allowlist;
  #namespace;
  #clock;
  #queues;

  /**
   * @param {{storage: StorageAdapter, allowlist: string[]|Record<string, {maxBytes?: number}|number>,
   * namespace?: string, defaultMaxBytes?: number, clock?: () => Date|string|number}} options
   */
  constructor({
    storage,
    allowlist,
    namespace = "grindpilot",
    defaultMaxBytes = DEFAULT_MAX_BYTES,
    clock = () => new Date(),
  }) {
    assertStorageAdapter(storage);
    if (typeof namespace !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/i.test(namespace)) {
      throw new TypeError("namespace must be a safe non-empty identifier");
    }
    if (!Number.isInteger(defaultMaxBytes) || defaultMaxBytes < 64) {
      throw new RangeError("defaultMaxBytes must be an integer of at least 64");
    }
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#storage = storage;
    this.#allowlist = normalizeAllowlist(allowlist, defaultMaxBytes);
    this.#namespace = namespace;
    this.#clock = clock;
    this.#queues = new Map();
  }

  allowedKeys() {
    return [...this.#allowlist.keys()];
  }

  /** @param {string} key */
  async get(key) {
    this.#requireKey(key);
    return publicRecord(key, await this.#readEnvelope(key));
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {{expectedRevision?: number|null}} [options]
   */
  async set(key, value, { expectedRevision = null } = {}) {
    this.#requireKey(key);
    const safeValue = cloneJsonValue(value);
    return this.#enqueue(key, async () => {
      const current = await this.#readEnvelope(key);
      this.#assertExpectedRevision(key, current.revision, expectedRevision);
      return this.#writeEnvelope(key, {
        version: ENVELOPE_VERSION,
        revision: current.revision + 1,
        updatedAt: this.#now(),
        deleted: false,
        value: safeValue,
      });
    });
  }

  /**
   * Tombstones retain the monotonically increasing revision so a stale writer
   * cannot mistake a deleted record for one that never existed.
   *
   * @param {string} key
   * @param {{expectedRevision?: number|null}} [options]
   */
  async remove(key, { expectedRevision = null } = {}) {
    this.#requireKey(key);
    return this.#enqueue(key, async () => {
      const current = await this.#readEnvelope(key);
      this.#assertExpectedRevision(key, current.revision, expectedRevision);
      return this.#writeEnvelope(key, {
        version: ENVELOPE_VERSION,
        revision: current.revision + 1,
        updatedAt: this.#now(),
        deleted: true,
        value: null,
      });
    });
  }

  /**
   * @param {string} key
   * @param {(value: unknown, record: object) => unknown|Promise<unknown>} updater
   * @param {{expectedRevision?: number|null}} [options]
   */
  async update(key, updater, { expectedRevision = null } = {}) {
    this.#requireKey(key);
    if (typeof updater !== "function") throw new TypeError("updater must be a function");
    return this.#enqueue(key, async () => {
      const current = await this.#readEnvelope(key);
      this.#assertExpectedRevision(key, current.revision, expectedRevision);
      const record = publicRecord(key, current);
      const nextValue = cloneJsonValue(await updater(record.value, record));
      return this.#writeEnvelope(key, {
        version: ENVELOPE_VERSION,
        revision: current.revision + 1,
        updatedAt: this.#now(),
        deleted: false,
        value: nextValue,
      });
    });
  }

  async list() {
    return Promise.all(this.allowedKeys().map((key) => this.get(key)));
  }

  #requireKey(key) {
    if (!this.#allowlist.has(key)) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_KEY_NOT_ALLOWED,
        `Storage key is not allowlisted: ${String(key)}`,
        { details: { key: String(key) } },
      );
    }
  }

  #physicalKey(key) {
    return `${this.#namespace}:${key}`;
  }

  #now() {
    const instant = new Date(this.#clock());
    if (Number.isNaN(instant.getTime())) throw new TypeError("clock returned an invalid date");
    return instant.toISOString();
  }

  async #readEnvelope(key) {
    let raw;
    try {
      raw = await this.#storage.read(this.#physicalKey(key));
    } catch (cause) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Unable to read storage key: ${key}`,
        { cause, details: { key }, retryable: true },
      );
    }
    if (raw == null) {
      return { version: ENVELOPE_VERSION, revision: 0, updatedAt: null, deleted: true, value: null };
    }
    if (typeof raw !== "string") {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_CORRUPT,
        `Stored value is not a serialized envelope: ${key}`,
        { details: { key } },
      );
    }
    try {
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.version !== ENVELOPE_VERSION ||
        !Number.isInteger(parsed.revision) ||
        parsed.revision < 1 ||
        typeof parsed.updatedAt !== "string" ||
        typeof parsed.deleted !== "boolean" ||
        (!parsed.deleted && !Object.hasOwn(parsed, "value"))
      ) {
        throw new TypeError("Invalid revision envelope");
      }
      return parsed;
    } catch (cause) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_CORRUPT,
        `Stored value has an invalid revision envelope: ${key}`,
        { cause, details: { key } },
      );
    }
  }

  async #writeEnvelope(key, envelope) {
    const serialized = JSON.stringify(envelope);
    const physicalKey = this.#physicalKey(key);
    const bytes = encoder.encode(physicalKey).byteLength + encoder.encode(serialized).byteLength;
    const maxBytes = this.#allowlist.get(key).maxBytes;
    if (bytes > maxBytes) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_SIZE_EXCEEDED,
        `Storage value exceeds the configured limit for ${key}`,
        { details: { key, bytes, maxBytes } },
      );
    }
    try {
      await this.#storage.write(physicalKey, serialized);
    } catch (cause) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Unable to write storage key: ${key}`,
        { cause, details: { key }, retryable: true },
      );
    }
    return publicRecord(key, envelope);
  }

  #assertExpectedRevision(key, actual, expected) {
    if (expected == null) return;
    if (!Number.isInteger(expected) || expected < 0) {
      throw new GrindPilotError(
        ERROR_CODES.INVALID_ARGUMENT,
        "expectedRevision must be a non-negative integer",
      );
    }
    if (actual !== expected) {
      throw new GrindPilotError(
        ERROR_CODES.STORAGE_REVISION_CONFLICT,
        `Storage revision conflict for ${key}`,
        { details: { key, expectedRevision: expected, actualRevision: actual }, retryable: true },
      );
    }
  }

  #enqueue(key, operation) {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const pending = previous.then(operation);
    let tail;
    tail = pending.catch(() => {}).finally(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key);
    });
    this.#queues.set(key, tail);
    return pending;
  }
}

/**
 * Tiny adapter useful for tests and non-persistent previews.
 */
export class MemoryStorageAdapter {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  async read(key) {
    return this.values.get(key) ?? null;
  }

  async write(key, value) {
    this.values.set(key, value);
  }
}

export const asStorageError = (error, fallback = {}) =>
  toGrindPilotError(error, {
    code: ERROR_CODES.STORAGE_UNAVAILABLE,
    message: "Storage operation failed",
    retryable: true,
    ...fallback,
  });
