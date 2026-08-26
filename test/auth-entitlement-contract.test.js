import assert from "node:assert/strict";
import test from "node:test";

import { EntitlementService, Feature, ProductPlan } from "../src/application/entitlement-service.js";
import {
  AuthErrorCode,
  AuthProvider,
  AuthState,
  NotConfiguredAuthProvider,
  normalizeAuthSnapshot,
  resolveAuthSnapshot,
} from "../src/application/pro-contracts/auth-provider.js";
import {
  EntitlementErrorCode,
  EntitlementProvider,
  EntitlementState,
  FREE_FEATURE_IDS,
  NotConfiguredEntitlementProvider,
  PRO_FEATURE_IDS,
  createFreeEntitlementSnapshot,
  normalizeEntitlementSnapshot,
  resolveEntitlementSnapshot,
} from "../src/application/pro-contracts/entitlement-provider.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
  isProContractError,
} from "../src/application/pro-contracts/errors.js";

test("not-configured auth is deterministic, explicit, immutable and token-free", async () => {
  const provider = new NotConfiguredAuthProvider({ clock: () => 42 });
  const first = await provider.getSnapshot();
  const second = await provider.signIn({ interactive: true });
  const third = await provider.signOut();
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(first.state, AuthState.NOT_CONFIGURED);
  assert.equal(first.errorCode, AuthErrorCode.PROVIDER_NOT_CONFIGURED);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.keys(first).sort(), ["errorCode", "expiresAt", "observedAt", "schemaVersion", "state"]);
});

test("abstract auth and entitlement providers fail with stable not-configured errors", async () => {
  await assert.rejects(
    () => new AuthProvider().getSnapshot(),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
  await assert.rejects(
    () => new EntitlementProvider().getSnapshot(),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
});

test("auth snapshots are closed and require a future token-free signed-in lifetime", () => {
  const snapshot = normalizeAuthSnapshot({
    schemaVersion: 1,
    state: AuthState.SIGNED_IN,
    observedAt: 100,
    expiresAt: 200,
    errorCode: null,
  });
  assert.equal(snapshot.state, AuthState.SIGNED_IN);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(
    () => normalizeAuthSnapshot({ ...snapshot, accessToken: "forbidden" }),
    ProContractError,
  );
  assert.throws(
    () => normalizeAuthSnapshot({ ...snapshot, expiresAt: 99 }),
    ProContractError,
  );
});

test("auth freshness is checked against an explicit clock and invalid evidence fails signed out", () => {
  const signedIn = {
    schemaVersion: 1,
    state: AuthState.SIGNED_IN,
    observedAt: 100,
    expiresAt: 200,
    errorCode: null,
  };
  assert.throws(() => normalizeAuthSnapshot(signedIn, { now: 201 }), ProContractError);
  assert.throws(
    () => normalizeAuthSnapshot({ ...signedIn, observedAt: 100_000, expiresAt: 100_100 }, { now: 1 }),
    ProContractError,
  );
  const fallback = resolveAuthSnapshot(signedIn, { now: 201 });
  assert.equal(fallback.state, AuthState.ERROR);
  assert.equal(fallback.errorCode, AuthErrorCode.PROVIDER_ERROR);
});

test("fresh ready Pro entitlement is compatible with the existing local feature policy", () => {
  const snapshot = normalizeEntitlementSnapshot({
    schemaVersion: 1,
    state: EntitlementState.READY,
    plan: ProductPlan.PRO,
    features: PRO_FEATURE_IDS,
    observedAt: 100,
    issuedAt: 90,
    expiresAt: 200,
    evidence: { providerId: "fake-entitlements", revision: "rev-1" },
    errorCode: null,
  }, { now: 110 });
  assert.equal(snapshot.plan, ProductPlan.PRO);
  assert.equal(Object.isFrozen(snapshot.features), true);
  const service = new EntitlementService({ plan: snapshot.plan });
  assert.equal(service.check(Feature.CLUB_OPTIMIZATION).entitled, true);
  assert.deepEqual(snapshot.features, PRO_FEATURE_IDS);
});

test("future-dated entitlement evidence cannot grant Pro", () => {
  const future = {
    schemaVersion: 1,
    state: EntitlementState.READY,
    plan: ProductPlan.PRO,
    features: PRO_FEATURE_IDS,
    observedAt: 100_000,
    issuedAt: 99_000,
    expiresAt: 200_000,
    evidence: { providerId: "fake-entitlements", revision: "rev-future" },
    errorCode: null,
  };
  assert.throws(() => normalizeEntitlementSnapshot(future, { now: 1 }), ProContractError);
  const fallback = resolveEntitlementSnapshot(future, { now: 1 });
  assert.equal(fallback.plan, ProductPlan.FREE);
  assert.equal(fallback.state, EntitlementState.ERROR);
});

test("stale, malformed and overclaiming entitlements fail to Free", () => {
  const expiredPro = {
    schemaVersion: 1,
    state: EntitlementState.READY,
    plan: ProductPlan.PRO,
    features: PRO_FEATURE_IDS,
    observedAt: 100,
    issuedAt: 90,
    expiresAt: 105,
    evidence: { providerId: "fake-entitlements", revision: "rev-1" },
    errorCode: null,
  };
  assert.throws(
    () => normalizeEntitlementSnapshot(expiredPro, { now: 110 }),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED),
  );
  for (const invalid of [
    expiredPro,
    { ...expiredPro, expiresAt: 200, features: FREE_FEATURE_IDS },
    { ...expiredPro, expiresAt: 200, accessToken: "forbidden" },
    null,
  ]) {
    const fallback = resolveEntitlementSnapshot(invalid, { now: 110 });
    assert.equal(fallback.plan, ProductPlan.FREE);
    assert.deepEqual(fallback.features, FREE_FEATURE_IDS);
    assert.equal(fallback.state, EntitlementState.ERROR);
    assert.equal(new EntitlementService({ plan: fallback.plan }).check(Feature.CLUB_OPTIMIZATION).entitled, false);
  }
});

test("not-configured entitlement behavior is deterministic and Free-safe", async () => {
  const provider = new NotConfiguredEntitlementProvider({ clock: () => 77 });
  const snapshot = await provider.getSnapshot();
  assert.equal(snapshot.state, EntitlementState.NOT_CONFIGURED);
  assert.equal(snapshot.plan, ProductPlan.FREE);
  assert.equal(snapshot.observedAt, 77);
  assert.equal(snapshot.errorCode, EntitlementErrorCode.PROVIDER_NOT_CONFIGURED);
  assert.deepEqual(snapshot.features, FREE_FEATURE_IDS);
});

test("the zero-argument Free entitlement snapshot is valid and not configured", () => {
  const snapshot = createFreeEntitlementSnapshot();
  assert.equal(snapshot.state, EntitlementState.NOT_CONFIGURED);
  assert.equal(snapshot.plan, ProductPlan.FREE);
  assert.equal(snapshot.errorCode, EntitlementErrorCode.PROVIDER_NOT_CONFIGURED);
});

test("every non-ready entitlement lifecycle state remains explicitly Free", () => {
  const cases = [
    [EntitlementState.CHECKING, null, {}],
    [EntitlementState.NOT_CONFIGURED, EntitlementErrorCode.PROVIDER_NOT_CONFIGURED, {}],
    [EntitlementState.SIGN_IN_REQUIRED, EntitlementErrorCode.SIGN_IN_REQUIRED, {}],
    [EntitlementState.LOCKED, EntitlementErrorCode.LOCKED, {}],
    [EntitlementState.OFFLINE, EntitlementErrorCode.NETWORK_UNAVAILABLE, {}],
    [EntitlementState.SERVICE_UNAVAILABLE, EntitlementErrorCode.SERVICE_UNAVAILABLE, {}],
    [EntitlementState.STALE, EntitlementErrorCode.STALE, { issuedAt: 10, expiresAt: 50 }],
    [EntitlementState.ERROR, EntitlementErrorCode.PROVIDER_ERROR, {}],
  ];
  for (const [state, errorCode, extra] of cases) {
    const snapshot = createFreeEntitlementSnapshot({
      state,
      errorCode,
      observedAt: 100,
      now: 100,
      ...extra,
    });
    assert.equal(snapshot.state, state);
    assert.equal(snapshot.plan, ProductPlan.FREE);
    assert.equal(new EntitlementService({ plan: snapshot.plan }).check(Feature.SMART_ROUTING).entitled, false);
  }
});
