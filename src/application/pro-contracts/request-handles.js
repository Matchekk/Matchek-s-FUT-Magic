import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";

const HANDLE_KINDS = Object.freeze({
  ITEM: "item",
  PLAYER_GROUP: "player_group",
  VERSION_GROUP: "version_group",
  PROJECT: "project",
  REQUIREMENT: "requirement",
  RECIPE: "recipe",
});

const HANDLE_PREFIX = Object.freeze({
  [HANDLE_KINDS.ITEM]: "itm",
  [HANDLE_KINDS.PLAYER_GROUP]: "ply",
  [HANDLE_KINDS.VERSION_GROUP]: "ver",
  [HANDLE_KINDS.PROJECT]: "prj",
  [HANDLE_KINDS.REQUIREMENT]: "req",
  [HANDLE_KINDS.RECIPE]: "rcp",
});

const FACTORY_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,71}$/;
const MAX_GENERATION_ATTEMPTS = 8;
const MAX_LOCAL_ID_LENGTH = 256;

export const RequestHandleKind = HANDLE_KINDS;

const fail = (code, message, path = "$requestHandle") => {
  throw new ProContractError(code, message, { path });
};

const productionIdFactory = () => {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Secure request-handle generation is unavailable");
  }
  return globalThis.crypto.randomUUID();
};

const normalizeKind = (kind) => {
  if (!Object.hasOwn(HANDLE_PREFIX, kind)) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Unsupported request-handle kind", "$requestHandle.kind");
  }
  return kind;
};

const normalizeLocalId = (localId) => {
  if (typeof localId !== "string" || localId.length === 0 || localId.length > MAX_LOCAL_ID_LENGTH) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Invalid local identifier", "$requestHandle.localId");
  }
  return localId;
};

const localLookupKey = (kind, localId) => `${kind}\u0000${localId}`;

/**
 * Owns the unlinkable handle mapping for exactly one cloud request.
 *
 * Local identifiers live only in private maps. The scope has no enumerable
 * state, so serializing it cannot disclose the mapping accidentally.
 */
export class RequestHandleScope {
  #disposed = false;
  #handleToLocal = new Map();
  #idFactory;
  #localToHandle = new Map();

  constructor({ idFactory = productionIdFactory } = {}) {
    if (typeof idFactory !== "function") {
      fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Request-handle ID factory must be a function");
    }
    this.#idFactory = idFactory;
    Object.freeze(this);
  }

  get active() {
    return !this.#disposed;
  }

  get size() {
    return this.#handleToLocal.size;
  }

  issue(kind, localId) {
    this.#assertActive();
    const normalizedKind = normalizeKind(kind);
    const normalizedLocalId = normalizeLocalId(localId);
    const lookupKey = localLookupKey(normalizedKind, normalizedLocalId);
    const existing = this.#localToHandle.get(lookupKey);
    if (existing) return existing;

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      let token;
      try {
        token = this.#idFactory();
      } catch {
        fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Request-handle ID generation failed");
      }
      if (typeof token !== "string" || !FACTORY_TOKEN_PATTERN.test(token)) {
        fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Request-handle ID factory returned an invalid identifier");
      }
      const handle = `${HANDLE_PREFIX[normalizedKind]}_${token}`;
      if (this.#handleToLocal.has(handle)) continue;
      this.#handleToLocal.set(handle, Object.freeze({ kind: normalizedKind, localId: normalizedLocalId }));
      this.#localToHandle.set(lookupKey, handle);
      return handle;
    }

    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Request-handle generation exhausted its collision limit");
  }

  issueItem(localId) {
    return this.issue(HANDLE_KINDS.ITEM, localId);
  }

  issuePlayerGroup(localId) {
    return this.issue(HANDLE_KINDS.PLAYER_GROUP, localId);
  }

  issueVersionGroup(localId) {
    return this.issue(HANDLE_KINDS.VERSION_GROUP, localId);
  }

  issueProject(localId) {
    return this.issue(HANDLE_KINDS.PROJECT, localId);
  }

  issueRequirement(localId) {
    return this.issue(HANDLE_KINDS.REQUIREMENT, localId);
  }

  issueRecipe(localId) {
    return this.issue(HANDLE_KINDS.RECIPE, localId);
  }

  has(handle, kind = null) {
    this.#assertActive();
    const record = this.#handleToLocal.get(handle);
    if (!record) return false;
    return kind == null || record.kind === normalizeKind(kind);
  }

  resolve(handle, kind = null) {
    this.#assertActive();
    const record = this.#handleToLocal.get(handle);
    if (!record || (kind != null && record.kind !== normalizeKind(kind))) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Unknown request-local handle", "$requestHandle.handle");
    }
    return record.localId;
  }

  dispose() {
    if (this.#disposed) return;
    this.#handleToLocal.clear();
    this.#localToHandle.clear();
    this.#disposed = true;
  }

  #assertActive() {
    if (this.#disposed) {
      fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Request-handle scope is no longer active");
    }
  }
}

export const createRequestHandleScope = (options) => new RequestHandleScope(options);
