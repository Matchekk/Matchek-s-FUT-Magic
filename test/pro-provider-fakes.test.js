import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthState,
  CloudPlannerProvider,
  EntitlementState,
  FREE_FEATURE_IDS,
  SMART_ROUTE_CONTRACT,
} from "../src/application/index.js";
import {
  DeterministicAuthProvider,
  DeterministicEntitlementProvider,
  createDeterministicCloudTransport,
} from "./support/fake-pro-providers.js";

const NOW = 1_000;

test("test-only Pro providers replay explicit auth and entitlement states deterministically", async () => {
  const auth = new DeterministicAuthProvider([
    { schemaVersion: 1, state: "signed_out", observedAt: NOW, expiresAt: null, errorCode: null },
    { schemaVersion: 1, state: "signed_in", observedAt: NOW, expiresAt: NOW + 500, errorCode: null },
  ]);
  assert.equal((await auth.getSnapshot()).state, AuthState.SIGNED_OUT);
  assert.equal((await auth.signIn()).state, AuthState.SIGNED_IN);

  const entitlement = new DeterministicEntitlementProvider([
    {
      schemaVersion: 1,
      state: "not_configured",
      plan: "free",
      features: FREE_FEATURE_IDS,
      observedAt: NOW,
      issuedAt: null,
      expiresAt: null,
      evidence: null,
      errorCode: "PROVIDER_NOT_CONFIGURED",
    },
  ], { now: NOW });
  assert.equal((await entitlement.getSnapshot()).state, EntitlementState.NOT_CONFIGURED);
});

test("test-only cloud transport returns data through the real provider validator", async () => {
  const request = {
    schemaVersion: 1,
    contract: SMART_ROUTE_CONTRACT,
    requestId: "request-fake-1",
    fingerprint: "randomized-payload-digest",
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    gameVersion: "fc26",
    storage: { state: "verified", remainingCapacity: 0 },
    supportedActionKinds: ["hold_for_review"],
    candidates: [{
      itemHandle: "itm_random-request-card",
      eligibility: "verified_eligible",
      rating: 88,
      location: "unassigned",
      tradability: "unknown",
      duplicate: true,
      specialClasses: [],
      localCost: 0,
      clubMove: "unverified",
      storageMove: "unverified",
      knownRecipeHandles: [],
    }],
    projectDemand: [],
  };
  const fake = createDeterministicCloudTransport({
    smartRouteResponses: [({ request: normalized }) => ({
      schemaVersion: 1,
      contract: SMART_ROUTE_CONTRACT,
      requestId: normalized.requestId,
      requestFingerprint: normalized.fingerprint,
      expiresAt: NOW + 30_000,
      status: "proposal",
      modelVersion: "deterministic-fake-1",
      recommendations: [{
        itemHandle: normalized.candidates[0].itemHandle,
        kind: "hold_for_review",
        recipeHandle: null,
        rank: 1,
        reasonCodes: ["manual_review_required"],
      }],
      reasonCodes: ["manual_review_required"],
      warningCodes: [],
    })],
  });
  const provider = new CloudPlannerProvider({ transport: fake.transport, clock: () => NOW });
  const result = await provider.smartRoute(request);
  assert.equal(result.modelVersion, "deterministic-fake-1");
  assert.equal(fake.calls.length, 1);
  assert.equal(Object.isFrozen(fake.calls[0].request), true);
});
