import { Feature, ProductPlan } from "../entitlement-service.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";
import {
  PRO_CONTRACT_LIMITS,
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeNullableFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./schema.js";

export const EntitlementState = Object.freeze({
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
  ERROR: "error",
});

export const EntitlementErrorCode = Object.freeze({
  EXPIRED: "ENTITLEMENT_EXPIRED",
  STALE: "ENTITLEMENT_STALE",
  SIGN_IN_REQUIRED: "SIGN_IN_REQUIRED",
  LOCKED: "ENTITLEMENT_LOCKED",
  NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
});

export const FREE_FEATURE_IDS = Object.freeze([
  Feature.ADVANCED_TOOLS,
  Feature.LOCAL_RECIPES,
  Feature.PRODUCT_SHELL,
  Feature.SBC_PROJECTS,
].sort());

export const PRO_FEATURE_IDS = Object.freeze([
  ...new Set([
    ...FREE_FEATURE_IDS,
    Feature.CLUB_OPTIMIZATION,
    Feature.EVOLUTION_PLANNING,
    Feature.PROJECT_OPTIMIZATION,
    Feature.SMART_ROUTING,
    Feature.CLOUD_RECIPES,
  ]),
].sort());

export const ENTITLEMENT_MAX_CLOCK_SKEW_MS = 60_000;

const featureIdsForPlan = (plan) =>
  plan === ProductPlan.PRO ? PRO_FEATURE_IDS : FREE_FEATURE_IDS;

const fail = (message, path, code = PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID) => {
  throw new ProContractError(code, message, { path });
};

const normalizeEvidence = (value) => {
  if (value == null) return null;
  assertExactKeys(value, { required: ["providerId", "revision"], path: "$entitlement.evidence" });
  return {
    providerId: normalizeSafeId(value.providerId, { path: "$entitlement.evidence.providerId" }),
    revision: normalizeSafeId(value.revision, { path: "$entitlement.evidence.revision" }),
  };
};

export const normalizeEntitlementSnapshot = (input, { now = Date.now() } = {}) => {
  assertPlainJson(input, { path: "$entitlement" });
  assertExactKeys(input, {
    required: [
      "schemaVersion", "state", "plan", "features", "observedAt",
      "issuedAt", "expiresAt", "evidence", "errorCode",
    ],
    path: "$entitlement",
  });
  assertSchemaVersion(input.schemaVersion, { path: "$entitlement.schemaVersion" });
  const currentTime = normalizeFiniteInteger(now, { path: "$now", min: 0 });
  const state = normalizeEnum(input.state, Object.values(EntitlementState), { path: "$entitlement.state" });
  const plan = normalizeEnum(input.plan, Object.values(ProductPlan), { path: "$entitlement.plan" });
  const features = normalizeStringArray(input.features, {
    path: "$entitlement.features",
    allowed: Object.values(Feature),
    maxItems: PRO_CONTRACT_LIMITS.MAX_FEATURES,
    sort: true,
  });
  const observedAt = normalizeFiniteInteger(input.observedAt, { path: "$entitlement.observedAt", min: 0 });
  const issuedAt = normalizeNullableFiniteInteger(input.issuedAt, { path: "$entitlement.issuedAt", min: 0 });
  const expiresAt = normalizeNullableFiniteInteger(input.expiresAt, { path: "$entitlement.expiresAt", min: 0 });
  const evidence = normalizeEvidence(input.evidence);
  const errorCode = input.errorCode == null
    ? null
    : normalizeEnum(input.errorCode, Object.values(EntitlementErrorCode), { path: "$entitlement.errorCode" });
  if (observedAt > currentTime + ENTITLEMENT_MAX_CLOCK_SKEW_MS) {
    fail("Entitlement observation is future-dated", "$entitlement.observedAt");
  }
  if (issuedAt != null && issuedAt > currentTime + ENTITLEMENT_MAX_CLOCK_SKEW_MS) {
    fail("Entitlement issue time is future-dated", "$entitlement.issuedAt");
  }
  const expectedFeatures = featureIdsForPlan(plan);
  if (features.length !== expectedFeatures.length || features.some((feature, index) => feature !== expectedFeatures[index])) {
    fail("Entitlement features do not match the declared plan", "$entitlement.features");
  }

  if (state === EntitlementState.READY) {
    if (issuedAt == null || expiresAt == null || issuedAt > observedAt || expiresAt <= observedAt) {
      fail("Verified entitlement requires a valid issued and expiry window", "$entitlement.expiresAt");
    }
    if (expiresAt <= currentTime) {
      fail("Verified entitlement has expired", "$entitlement.expiresAt", PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED);
    }
    if (evidence == null) fail("Verified entitlement requires provider evidence", "$entitlement.evidence");
    if (errorCode != null) fail("Verified entitlement cannot carry an error", "$entitlement.errorCode");
  } else {
    if (plan !== ProductPlan.FREE) fail("Unverified entitlement must fail to Free", "$entitlement.plan");
    if (state === EntitlementState.STALE) {
      if (expiresAt == null || expiresAt > Math.max(observedAt, currentTime)) {
        fail("Stale entitlement requires an elapsed expiry", "$entitlement.expiresAt");
      }
      if (![EntitlementErrorCode.EXPIRED, EntitlementErrorCode.STALE].includes(errorCode)) fail("Stale entitlement requires a stale or expired error", "$entitlement.errorCode");
    } else if (state === EntitlementState.OFFLINE) {
      if (errorCode !== EntitlementErrorCode.NETWORK_UNAVAILABLE) fail("Offline entitlement requires NETWORK_UNAVAILABLE", "$entitlement.errorCode");
    } else if (state === EntitlementState.NOT_CONFIGURED) {
      if (errorCode !== EntitlementErrorCode.PROVIDER_NOT_CONFIGURED) fail("Not-configured entitlement requires PROVIDER_NOT_CONFIGURED", "$entitlement.errorCode");
    } else if (state === EntitlementState.SIGN_IN_REQUIRED) {
      if (errorCode !== EntitlementErrorCode.SIGN_IN_REQUIRED) fail("Sign-in-required entitlement requires SIGN_IN_REQUIRED", "$entitlement.errorCode");
    } else if (state === EntitlementState.LOCKED) {
      if (errorCode !== EntitlementErrorCode.LOCKED) fail("Locked entitlement requires ENTITLEMENT_LOCKED", "$entitlement.errorCode");
    } else if (state === EntitlementState.SERVICE_UNAVAILABLE) {
      if (errorCode !== EntitlementErrorCode.SERVICE_UNAVAILABLE) fail("Unavailable entitlement service requires SERVICE_UNAVAILABLE", "$entitlement.errorCode");
    } else if (state === EntitlementState.CHECKING) {
      if (errorCode != null) fail("Checking entitlement cannot carry an error", "$entitlement.errorCode");
    } else if (![EntitlementErrorCode.PROVIDER_ERROR, EntitlementErrorCode.INVALID_RESPONSE].includes(errorCode)) {
      fail("Entitlement error state requires a provider error code", "$entitlement.errorCode");
    }
  }

  return cloneAndFreezeContract({
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    state,
    plan,
    features,
    observedAt,
    issuedAt,
    expiresAt,
    evidence,
    errorCode,
  });
};

export const createFreeEntitlementSnapshot = ({
  state = EntitlementState.NOT_CONFIGURED,
  observedAt = 0,
  issuedAt = null,
  expiresAt = null,
  evidence = null,
  errorCode = EntitlementErrorCode.PROVIDER_NOT_CONFIGURED,
  now = observedAt,
} = {}) => normalizeEntitlementSnapshot({
  schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
  state,
  plan: ProductPlan.FREE,
  features: FREE_FEATURE_IDS,
  observedAt,
  issuedAt,
  expiresAt,
  evidence,
  errorCode,
}, { now });

export const resolveEntitlementSnapshot = (input, { now = Date.now() } = {}) => {
  try {
    return normalizeEntitlementSnapshot(input, { now });
  } catch {
    return createFreeEntitlementSnapshot({
      state: EntitlementState.ERROR,
      observedAt: normalizeFiniteInteger(now, { path: "$now", min: 0 }),
      errorCode: EntitlementErrorCode.INVALID_RESPONSE,
      now,
    });
  }
};

export class EntitlementProvider {
  async getSnapshot() {
    throw new ProContractError(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Entitlement provider is not configured",
    );
  }
}

export class NotConfiguredEntitlementProvider extends EntitlementProvider {
  constructor({ clock = () => 0 } = {}) {
    super();
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.clock = clock;
  }

  async getSnapshot() {
    const observedAt = this.clock();
    return createFreeEntitlementSnapshot({
      state: EntitlementState.NOT_CONFIGURED,
      observedAt,
      errorCode: EntitlementErrorCode.PROVIDER_NOT_CONFIGURED,
      now: observedAt,
    });
  }
}
