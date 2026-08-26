import assert from "node:assert/strict";
import test from "node:test";

import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "../src/application/pro-contracts/errors.js";
import {
  SMART_ROUTE_ACTION_KINDS,
  SMART_ROUTE_CONTRACT,
  SMART_ROUTE_LIMITS,
  validateSmartRouteRequest,
  validateSmartRouteResponse,
} from "../src/application/pro-contracts/smart-route.js";

const candidate = (index, overrides = {}) => ({
  itemHandle: `itm_${index}`,
  eligibility: "verified_eligible",
  rating: 84 + index,
  location: "unassigned",
  tradability: "untradeable",
  duplicate: true,
  specialClasses: [],
  localCost: index * 100,
  clubMove: "verified_available",
  storageMove: "verified_available",
  knownRecipeHandles: ["rcp_upgrade"],
  ...overrides,
});

const requestFixture = () => ({
  schemaVersion: 1,
  contract: SMART_ROUTE_CONTRACT,
  requestId: "request_route_1",
  fingerprint: "fingerprint_route_1",
  createdAt: 1_000,
  expiresAt: 2_000,
  gameVersion: "fc26",
  storage: { state: "verified", remainingCapacity: 2 },
  supportedActionKinds: [...SMART_ROUTE_ACTION_KINDS],
  candidates: [candidate(1), candidate(2)],
  projectDemand: [{ rating: 89, count: 2, priority: 50, specialClass: null }],
});

const responseFixture = () => ({
  schemaVersion: 1,
  contract: SMART_ROUTE_CONTRACT,
  requestId: "request_route_1",
  requestFingerprint: "fingerprint_route_1",
  expiresAt: 1_900,
  status: "proposal",
  modelVersion: "router-1",
  recommendations: [
    {
      itemHandle: "itm_1",
      kind: "move_to_club",
      recipeHandle: null,
      rank: 1,
      reasonCodes: ["verified_club_destination"],
    },
    {
      itemHandle: "itm_2",
      kind: "candidate_for_known_recipe",
      recipeHandle: "rcp_upgrade",
      rank: 2,
      reasonCodes: ["known_recipe_candidate"],
    },
  ],
  reasonCodes: ["duplicate_pressure"],
  warningCodes: [],
});

const expectCode = (code) => (error) =>
  error instanceof ProContractError && error.code === code;

test("Smart Route v1 accepts immutable proposal-only request and response DTOs", () => {
  const request = validateSmartRouteRequest(requestFixture());
  const response = validateSmartRouteResponse(responseFixture(), { request, now: 1_500 });
  assert.equal(Object.isFrozen(request.candidates), true);
  assert.equal(Object.isFrozen(response.recommendations), true);
  assert.deepEqual(
    response.recommendations.map((entry) => entry.kind),
    ["move_to_club", "candidate_for_known_recipe"],
  );
  assert.equal("steps" in response, false);
  assert.equal("workflow" in response, false);
});

test("Smart Route rejects protected/non-duplicate inputs, unknown evidence, FC27, and oversized arrays", () => {
  const protectedCandidate = requestFixture();
  protectedCandidate.candidates[0].protected = true;
  assert.throws(() => validateSmartRouteRequest(protectedCandidate), ProContractError);

  const unique = requestFixture();
  unique.candidates[0].duplicate = false;
  assert.throws(() => validateSmartRouteRequest(unique), ProContractError);

  const unverifiedStorage = requestFixture();
  unverifiedStorage.storage.state = "unverified";
  assert.throws(() => validateSmartRouteRequest(unverifiedStorage), ProContractError);

  const fc27 = requestFixture();
  fc27.gameVersion = "fc27";
  assert.throws(() => validateSmartRouteRequest(fc27), ProContractError);

  const oversized = requestFixture();
  oversized.candidates = Array.from(
    { length: SMART_ROUTE_LIMITS.maxCandidates + 1 },
    (_, index) => candidate(index + 1),
  );
  assert.throws(() => validateSmartRouteRequest(oversized), ProContractError);
});

test("Smart Route response must match request and remain inside its expiry", () => {
  const request = requestFixture();
  const wrongId = responseFixture();
  wrongId.requestId = "request_other";
  assert.throws(
    () => validateSmartRouteResponse(wrongId, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH),
  );
  const wrongFingerprint = responseFixture();
  wrongFingerprint.requestFingerprint = "other_fingerprint";
  assert.throws(
    () => validateSmartRouteResponse(wrongFingerprint, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH),
  );
  const outlives = responseFixture();
  outlives.expiresAt = 2_001;
  assert.throws(
    () => validateSmartRouteResponse(outlives, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED),
  );
});

test("Smart Route rejects foreign, duplicate, and reused item or recipe handles", () => {
  const request = requestFixture();
  const foreign = responseFixture();
  foreign.recommendations[0].itemHandle = "itm_foreign";
  assert.throws(
    () => validateSmartRouteResponse(foreign, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );

  const duplicate = responseFixture();
  duplicate.recommendations[1].itemHandle = "itm_1";
  assert.throws(
    () => validateSmartRouteResponse(duplicate, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  assert.throws(
    () => validateSmartRouteResponse(responseFixture(), {
      request,
      now: 1_500,
      usedHandles: ["itm_1"],
    }),
    expectCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );

  const recipe = responseFixture();
  recipe.recommendations[1].recipeHandle = "rcp_foreign";
  assert.throws(
    () => validateSmartRouteResponse(recipe, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );
});

test("Smart Route locally revalidates destination capability, capacity, and supported kinds", () => {
  const unavailable = requestFixture();
  unavailable.candidates[0].clubMove = "unverified";
  assert.throws(
    () => validateSmartRouteResponse(responseFixture(), { request: unavailable, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED),
  );

  const unsupported = requestFixture();
  unsupported.supportedActionKinds = ["hold_for_review"];
  assert.throws(
    () => validateSmartRouteResponse(responseFixture(), { request: unsupported, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED),
  );

  const noCapacity = requestFixture();
  noCapacity.storage.remainingCapacity = 0;
  const storageResponse = responseFixture();
  storageResponse.recommendations = [{
    itemHandle: "itm_1",
    kind: "move_to_sbc_storage",
    recipeHandle: null,
    rank: 1,
    reasonCodes: ["verified_storage_destination"],
  }];
  assert.throws(
    () => validateSmartRouteResponse(storageResponse, { request: noCapacity, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED),
  );
});

test("Smart Route action and explanation vocabularies are closed and non-executable", () => {
  for (const forbidden of ["submit_sbc", "open_pack", "buy", "sell", "quicksell", "run_workflow"]) {
    const response = responseFixture();
    response.recommendations[0].kind = forbidden;
    assert.throws(
      () => validateSmartRouteResponse(response, { request: requestFixture(), now: 1_500 }),
      expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
    );
  }
  const warning = responseFixture();
  warning.warningCodes = ["execute_immediately"];
  assert.throws(
    () => validateSmartRouteResponse(warning, { request: requestFixture(), now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
  const injected = responseFixture();
  injected.steps = [{ kind: "move_to_club" }];
  assert.throws(
    () => validateSmartRouteResponse(injected, { request: requestFixture(), now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});
