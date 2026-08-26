import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeBoolean,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeNullableFiniteInteger,
} from "./schema.js";

export const AuthState = Object.freeze({
  CHECKING: "checking",
  AUTHORIZING: "authorizing",
  SIGNED_OUT: "signed_out",
  SIGNED_IN: "signed_in",
  EXPIRED: "expired",
  OFFLINE: "offline",
  ERROR: "error",
  NOT_CONFIGURED: "not_configured",
});

export const AuthErrorCode = Object.freeze({
  REQUIRED: "AUTH_REQUIRED",
  EXPIRED: "AUTH_EXPIRED",
  NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
});

export const AUTH_MAX_CLOCK_SKEW_MS = 60_000;

const fail = (message, path) => {
  throw new ProContractError(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, message, { path });
};

const normalizeNullableAuthError = (value, path) =>
  value == null ? null : normalizeEnum(value, Object.values(AuthErrorCode), { path });

export const normalizeAuthSnapshot = (input, { now = null } = {}) => {
  assertPlainJson(input, { path: "$auth" });
  assertExactKeys(input, {
    required: ["schemaVersion", "state", "observedAt", "expiresAt", "errorCode"],
    path: "$auth",
  });
  assertSchemaVersion(input.schemaVersion, { path: "$auth.schemaVersion" });
  const state = normalizeEnum(input.state, Object.values(AuthState), { path: "$auth.state" });
  const observedAt = normalizeFiniteInteger(input.observedAt, { path: "$auth.observedAt", min: 0 });
  const expiresAt = normalizeNullableFiniteInteger(input.expiresAt, { path: "$auth.expiresAt", min: 0 });
  const errorCode = normalizeNullableAuthError(input.errorCode, "$auth.errorCode");
  const currentTime = now == null
    ? null
    : normalizeFiniteInteger(now, { path: "$auth.now", min: 0 });
  if (currentTime != null && observedAt > currentTime + AUTH_MAX_CLOCK_SKEW_MS) {
    fail("Auth observation is future-dated", "$auth.observedAt");
  }

  if (state === AuthState.SIGNED_IN) {
    if (expiresAt == null || expiresAt <= observedAt) fail("Signed-in auth must have a future expiry", "$auth.expiresAt");
    if (currentTime != null && expiresAt <= currentTime) fail("Signed-in auth has expired", "$auth.expiresAt");
    if (errorCode != null) fail("Signed-in auth cannot carry an error", "$auth.errorCode");
  } else if (state === AuthState.EXPIRED) {
    if (expiresAt == null || expiresAt > observedAt) fail("Expired auth must have an elapsed expiry", "$auth.expiresAt");
    if (errorCode !== AuthErrorCode.EXPIRED) fail("Expired auth requires AUTH_EXPIRED", "$auth.errorCode");
  } else if (state === AuthState.OFFLINE) {
    if (errorCode !== AuthErrorCode.NETWORK_UNAVAILABLE) fail("Offline auth requires NETWORK_UNAVAILABLE", "$auth.errorCode");
  } else if (state === AuthState.ERROR) {
    if (errorCode !== AuthErrorCode.PROVIDER_ERROR) {
      fail("Auth error state requires a provider error code", "$auth.errorCode");
    }
  } else if (state === AuthState.NOT_CONFIGURED) {
    if (errorCode !== AuthErrorCode.PROVIDER_NOT_CONFIGURED) {
      fail("Not-configured auth requires PROVIDER_NOT_CONFIGURED", "$auth.errorCode");
    }
  } else if ([AuthState.CHECKING, AuthState.AUTHORIZING].includes(state)) {
    if (expiresAt != null || errorCode != null) fail("Pending auth cannot carry expiry or error state", "$auth.errorCode");
  } else if (![null, AuthErrorCode.REQUIRED, AuthErrorCode.PROVIDER_NOT_CONFIGURED].includes(errorCode)) {
    fail("Signed-out auth contains an incompatible error code", "$auth.errorCode");
  }

  return cloneAndFreezeContract({
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    state,
    observedAt,
    expiresAt,
    errorCode,
  });
};

export const resolveAuthSnapshot = (input, { now = Date.now() } = {}) => {
  const currentTime = normalizeFiniteInteger(now, { path: "$auth.now", min: 0 });
  try {
    return normalizeAuthSnapshot(input, { now: currentTime });
  } catch {
    return normalizeAuthSnapshot({
      schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
      state: AuthState.ERROR,
      observedAt: currentTime,
      expiresAt: null,
      errorCode: AuthErrorCode.PROVIDER_ERROR,
    }, { now: currentTime });
  }
};

export const normalizeAuthSignInRequest = (input = {}) => {
  assertPlainJson(input, { path: "$authSignIn" });
  assertExactKeys(input, { optional: ["interactive"], path: "$authSignIn" });
  return cloneAndFreezeContract({
    interactive: Object.hasOwn(input, "interactive")
      ? normalizeBoolean(input.interactive, { path: "$authSignIn.interactive" })
      : true,
  });
};

export class AuthProvider {
  async getSnapshot() {
    throw new ProContractError(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Auth provider is not configured",
    );
  }

  async signIn() {
    throw new ProContractError(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Auth provider is not configured",
    );
  }

  async signOut() {
    throw new ProContractError(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Auth provider is not configured",
    );
  }
}

export class NotConfiguredAuthProvider extends AuthProvider {
  constructor({ clock = () => 0 } = {}) {
    super();
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.clock = clock;
  }

  #snapshot() {
    const observedAt = this.clock();
    return normalizeAuthSnapshot({
      schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
      state: AuthState.NOT_CONFIGURED,
      observedAt,
      expiresAt: null,
      errorCode: AuthErrorCode.PROVIDER_NOT_CONFIGURED,
    }, { now: observedAt });
  }

  async getSnapshot() {
    return this.#snapshot();
  }

  async signIn(input = {}) {
    normalizeAuthSignInRequest(input);
    return this.#snapshot();
  }

  async signOut() {
    return this.#snapshot();
  }
}
