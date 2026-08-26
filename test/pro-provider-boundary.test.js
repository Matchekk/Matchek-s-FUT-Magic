import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_PLANNER_DEADLINES,
  CloudPlannerOperation,
  CloudPlannerProvider,
  NotConfiguredCloudPlannerProvider,
} from "../src/application/pro-contracts/cloud-planner-provider.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  isProContractError,
} from "../src/application/pro-contracts/errors.js";
import {
  PROJECT_OPTIMIZATION_CONTRACT,
} from "../src/application/pro-contracts/project-optimization.js";
import {
  RequestHandleKind,
  RequestHandleScope,
} from "../src/application/pro-contracts/request-handles.js";
import {
  SMART_ROUTE_CONTRACT,
} from "../src/application/pro-contracts/smart-route.js";

const NOW = 1_000;

const projectRequest = () => ({
  schemaVersion: 1,
  contract: PROJECT_OPTIMIZATION_CONTRACT,
  requestId: "request-project-1",
  fingerprint: "request-fingerprint-project",
  createdAt: NOW,
  expiresAt: NOW + 60_000,
  gameVersion: "fc26",
  candidates: [],
  projects: [{
    projectHandle: "prj_project-1",
    priority: 80,
    unknownRequirementCount: 0,
    requirements: [{
      requirementHandle: "req_requirement-1",
      squadRating: 84,
      squadSize: 11,
      specialRequirements: [],
    }],
  }],
});

const smartRouteRequest = (itemHandle = "itm_item-1") => ({
  schemaVersion: 1,
  contract: SMART_ROUTE_CONTRACT,
  requestId: "request-route-1",
  fingerprint: "request-fingerprint-route",
  createdAt: NOW,
  expiresAt: NOW + 60_000,
  gameVersion: "fc26",
  storage: { state: "verified", remainingCapacity: 1 },
  supportedActionKinds: ["hold_for_review", "move_to_club"],
  candidates: [{
    itemHandle,
    eligibility: "verified_eligible",
    rating: 86,
    location: "unassigned",
    tradability: "untradeable",
    duplicate: true,
    specialClasses: [],
    localCost: 0,
    clubMove: "verified_available",
    storageMove: "unverified",
    knownRecipeHandles: [],
  }],
  projectDemand: [],
});

const smartRouteResponse = (request) => ({
  schemaVersion: 1,
  contract: SMART_ROUTE_CONTRACT,
  requestId: request.requestId,
  requestFingerprint: request.fingerprint,
  expiresAt: NOW + 30_000,
  status: "proposal",
  modelVersion: "router-1",
  recommendations: [{
    itemHandle: request.candidates[0].itemHandle,
    kind: "move_to_club",
    recipeHandle: null,
    rank: 1,
    reasonCodes: ["verified_club_destination"],
  }],
  reasonCodes: ["verified_club_destination"],
  warningCodes: [],
});

test("request-local handles are deterministic under injection, unlinkable across scopes, and never serialize local IDs", () => {
  const localItemId = "ea-owned-item-canary-884211";
  const first = new RequestHandleScope({ idFactory: () => "scope-a-random" });
  const second = new RequestHandleScope({ idFactory: () => "scope-b-random" });

  const firstHandle = first.issueItem(localItemId);
  const secondHandle = second.issue(RequestHandleKind.ITEM, localItemId);
  assert.equal(firstHandle, "itm_scope-a-random");
  assert.equal(first.issueItem(localItemId), firstHandle);
  assert.notEqual(firstHandle, secondHandle);
  assert.equal(first.resolve(firstHandle, RequestHandleKind.ITEM), localItemId);

  const cloudDto = smartRouteRequest(firstHandle);
  const serialized = JSON.stringify({ scope: first, request: cloudDto });
  assert.equal(serialized.includes(localItemId), false);
  assert.equal(serialized.includes(firstHandle), true);
  assert.equal(JSON.stringify(first), "{}");
  assert.throws(
    () => second.resolve(firstHandle),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );

  first.dispose();
  assert.equal(first.active, false);
  assert.equal(first.size, 0);
  assert.throws(
    () => first.resolve(firstHandle),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );
});

test("cloud planner is not configured by default and still validates its request", async () => {
  const provider = new CloudPlannerProvider({ clock: () => NOW });
  await assert.rejects(
    provider.optimizeProject(projectRequest()),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );

  let called = false;
  const configured = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async () => {
      called = true;
      return {};
    },
  });
  await assert.rejects(
    configured.optimizeProject({ ...projectRequest(), itemId: "must-not-cross" }),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
  assert.equal(called, false);
});

test("the explicitly not-configured cloud planner cannot accept an injected transport", async () => {
  let called = false;
  assert.throws(
    () => new NotConfiguredCloudPlannerProvider({ transport: async () => { called = true; } }),
    /accepts no configuration/i,
  );

  const now = Date.now();
  const provider = new NotConfiguredCloudPlannerProvider();
  const project = { ...projectRequest(), createdAt: now, expiresAt: now + 60_000 };
  const route = { ...smartRouteRequest(), createdAt: now, expiresAt: now + 60_000 };
  await assert.rejects(
    provider.optimizeProject(project),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
  await assert.rejects(
    provider.smartRoute(route),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
  assert.equal(called, false);
  assert.equal(Object.isFrozen(provider), true);
});

test("cloud planner sends only an immutable validated call and returns an immutable validated proposal", async () => {
  const localItemId = "persistent-ea-item-998877";
  const scope = new RequestHandleScope({ idFactory: () => "request-random-item" });
  const request = smartRouteRequest(scope.issueItem(localItemId));
  let observedCall = null;
  let rawResponse = null;
  const provider = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async (call) => {
      observedCall = call;
      assert.equal(Object.isFrozen(call), true);
      assert.equal(Object.isFrozen(call.request), true);
      assert.equal(Object.isFrozen(call.request.candidates), true);
      assert.equal(JSON.stringify(call).includes(localItemId), false);
      rawResponse = smartRouteResponse(call.request);
      return rawResponse;
    },
  });

  const result = await provider.recommendSmartRoute(request, { deadlineMs: Number.MAX_SAFE_INTEGER });
  assert.equal(observedCall.operation, CloudPlannerOperation.SMART_ROUTE);
  assert.equal(observedCall.deadlineMs, CLOUD_PLANNER_DEADLINES.MAX_MS);
  assert.equal(observedCall.signal instanceof AbortSignal, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.recommendations), true);
  assert.notEqual(result, rawResponse);
  rawResponse.modelVersion = "mutated-after-return";
  assert.equal(result.modelVersion, "router-1");
});

test("cloud planner rejects concurrent and successfully consumed request replays", async () => {
  const request = smartRouteRequest();
  let resolveTransport;
  let transportCalls = 0;
  const provider = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async ({ request: normalizedRequest }) => {
      transportCalls += 1;
      return new Promise((resolve) => {
        resolveTransport = () => resolve(smartRouteResponse(normalizedRequest));
      });
    },
  });

  const first = provider.recommendSmartRoute(request);
  await assert.rejects(
    provider.recommendSmartRoute(request),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH),
  );
  assert.equal(transportCalls, 1);
  resolveTransport();
  await first;

  await assert.rejects(
    provider.smartRoute(request),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH),
  );
  assert.equal(transportCalls, 1);
});

test("failed requests release their replay slot and successful replay history is FIFO bounded", async () => {
  const base = smartRouteRequest();
  let failOnce = true;
  let transportCalls = 0;
  const provider = new CloudPlannerProvider({
    clock: () => NOW,
    maxReplayEntries: 2,
    transport: async ({ request }) => {
      transportCalls += 1;
      if (failOnce) {
        failOnce = false;
        throw new Error("private transient detail");
      }
      return smartRouteResponse(request);
    },
  });

  await assert.rejects(
    provider.recommendSmartRoute(base),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_OFFLINE),
  );
  await provider.recommendSmartRoute(base);

  const second = { ...smartRouteRequest(), requestId: "request-route-2", fingerprint: "request-fingerprint-route-2" };
  const third = { ...smartRouteRequest(), requestId: "request-route-3", fingerprint: "request-fingerprint-route-3" };
  await provider.recommendSmartRoute(second);
  await provider.recommendSmartRoute(third);

  await provider.recommendSmartRoute(base);
  assert.equal(transportCalls, 5);
});

test("cloud planner clamps deadlines, aborts timed-out transport, and exposes no transport error", async () => {
  let transportSignal = null;
  let cleared = false;
  const provider = new CloudPlannerProvider({
    clock: () => NOW,
    setTimer: (callback) => {
      queueMicrotask(callback);
      return "fake-timer";
    },
    clearTimer: (timer) => {
      assert.equal(timer, "fake-timer");
      cleared = true;
    },
    transport: ({ signal, deadlineMs }) => {
      transportSignal = signal;
      assert.equal(deadlineMs, CLOUD_PLANNER_DEADLINES.MIN_MS);
      return new Promise(() => {});
    },
  });

  await assert.rejects(
    provider.smartRoute(smartRouteRequest(), { deadlineMs: 1 }),
    (error) => {
      assert.equal(error.message.includes("fake"), false);
      assert.equal(error.cause, undefined);
      return isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_TIMEOUT);
    },
  );
  assert.equal(transportSignal.aborted, true);
  assert.equal(cleared, true);
});

test("an already-aborted caller signal prevents cloud transport", async () => {
  let called = false;
  const controller = new AbortController();
  controller.abort(new Error("private-caller-reason"));
  const provider = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async () => {
      called = true;
      return {};
    },
  });

  await assert.rejects(
    provider.smartRoute(smartRouteRequest(), { signal: controller.signal }),
    (error) => {
      assert.equal(error.message.includes("private-caller-reason"), false);
      assert.equal(error.cause, undefined);
      return isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_OFFLINE);
    },
  );
  assert.equal(called, false);
});

test("cloud planner sanitizes raw failures and invalid cloud responses", async () => {
  const secret = "raw-cookie-and-stack-canary";
  const offline = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async () => {
      throw new Error(secret);
    },
  });
  await assert.rejects(
    offline.smartRoute(smartRouteRequest()),
    (error) => {
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_OFFLINE);
    },
  );

  const malicious = new CloudPlannerProvider({
    clock: () => NOW,
    transport: async ({ request }) => ({
      ...smartRouteResponse(request),
      script: "do-not-reflect-this-payload",
    }),
  });
  await assert.rejects(
    malicious.smartRoute(smartRouteRequest()),
    (error) => {
      assert.equal(error.message.includes("script"), false);
      assert.equal(error.details, null);
      return isProContractError(error, PRO_CONTRACT_ERROR_CODES.PROVIDER_INVALID_RESPONSE);
    },
  );
});
