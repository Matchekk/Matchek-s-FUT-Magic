import assert from "node:assert/strict";
import test from "node:test";

import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "../src/application/pro-contracts/errors.js";
import {
  PROJECT_OPTIMIZATION_CONTRACT,
  PROJECT_OPTIMIZATION_LIMITS,
  validateProjectOptimizationRequest,
  validateProjectOptimizationResponse,
} from "../src/application/pro-contracts/project-optimization.js";

const candidate = (index, eligibleRequirementHandles = ["req_one"]) => ({
  itemHandle: `itm_${index}`,
  playerGroupHandle: `ply_${index}`,
  versionGroupHandle: `ver_${index}`,
  eligibility: "verified_eligible",
  rating: 80 + (index % 10),
  location: index % 2 ? "club" : "sbc_storage",
  tradability: index % 2 ? "tradable" : "untradeable",
  duplicate: index % 3 === 0,
  specialClasses: [],
  localCost: index * 100,
  eligibleRequirementHandles,
});

const requestFixture = () => ({
  schemaVersion: 1,
  contract: PROJECT_OPTIMIZATION_CONTRACT,
  requestId: "request_project_1",
  fingerprint: "fingerprint_project_1",
  createdAt: 1_000,
  expiresAt: 2_000,
  gameVersion: "fc26",
  candidates: Array.from({ length: 11 }, (_, index) => candidate(index + 1)),
  projects: [{
    projectHandle: "prj_one",
    priority: 50,
    unknownRequirementCount: 0,
    requirements: [{
      requirementHandle: "req_one",
      squadRating: 84,
      squadSize: 11,
      specialRequirements: [],
    }],
  }],
});

const responseFixture = () => ({
  schemaVersion: 1,
  contract: PROJECT_OPTIMIZATION_CONTRACT,
  requestId: "request_project_1",
  requestFingerprint: "fingerprint_project_1",
  expiresAt: 1_900,
  status: "complete",
  modelVersion: "optimizer-1",
  optimality: {
    state: "globally_optimal",
    evaluatedAllocationCount: 42,
    objectiveTuple: [0, 0, 1, 900],
  },
  allocations: [{
    projectHandle: "prj_one",
    requirementHandle: "req_one",
    candidateHandles: Array.from({ length: 11 }, (_, index) => `itm_${index + 1}`),
    reasonCodes: ["coverage_complete", "lower_local_cost"],
  }],
  coverageGaps: [],
  reasonCodes: ["coverage_complete"],
  warningCodes: [],
});

const expectCode = (code) => (error) =>
  error instanceof ProContractError && error.code === code;

test("project optimization v1 accepts and freezes a fully known proposal-only contract", () => {
  const request = validateProjectOptimizationRequest(requestFixture());
  const response = validateProjectOptimizationResponse(responseFixture(), {
    request,
    now: 1_500,
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.candidates), true);
  assert.equal(Object.isFrozen(response.allocations[0].candidateHandles), true);
  assert.equal(response.status, "complete");
  assert.equal("steps" in response, false);
  assert.equal("actions" in response, false);
});

test("project request rejects protected candidates, unknown requirements, FC27, and unknown fields", () => {
  const protectedCandidate = requestFixture();
  protectedCandidate.candidates[0].protected = true;
  assert.throws(
    () => validateProjectOptimizationRequest(protectedCandidate),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const unknownRequirement = requestFixture();
  unknownRequirement.projects[0].unknownRequirementCount = 1;
  assert.throws(
    () => validateProjectOptimizationRequest(unknownRequirement),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const fc27 = requestFixture();
  fc27.gameVersion = "fc27";
  assert.throws(
    () => validateProjectOptimizationRequest(fc27),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const extra = requestFixture();
  extra.serverHint = "anything";
  assert.throws(
    () => validateProjectOptimizationRequest(extra),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});

test("project request enforces full bounds and never truncates candidates", () => {
  const request = requestFixture();
  request.candidates = Array.from(
    { length: PROJECT_OPTIMIZATION_LIMITS.maxCandidates + 1 },
    (_, index) => candidate(index + 1),
  );
  assert.throws(() => validateProjectOptimizationRequest(request), ProContractError);

  const duplicate = requestFixture();
  duplicate.candidates[1].itemHandle = duplicate.candidates[0].itemHandle;
  assert.throws(
    () => validateProjectOptimizationRequest(duplicate),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});

test("project response must match request identity, fingerprint, contract, and expiry", () => {
  const request = requestFixture();
  for (const mutate of [
    (response) => { response.requestId = "request_foreign"; },
    (response) => { response.requestFingerprint = "fingerprint_foreign"; },
    (response) => { response.contract = "other.v1"; },
  ]) {
    const response = responseFixture();
    mutate(response);
    assert.throws(
      () => validateProjectOptimizationResponse(response, { request, now: 1_500 }),
      ProContractError,
    );
  }

  const outlives = responseFixture();
  outlives.expiresAt = 2_001;
  assert.throws(
    () => validateProjectOptimizationResponse(outlives, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED),
  );
  assert.throws(
    () => validateProjectOptimizationResponse(responseFixture(), { request, now: 1_900 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED),
  );
});

test("project response rejects foreign, duplicate, and previously used handles", () => {
  const request = requestFixture();
  const foreign = responseFixture();
  foreign.allocations[0].candidateHandles[10] = "itm_foreign";
  assert.throws(
    () => validateProjectOptimizationResponse(foreign, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );

  const duplicate = responseFixture();
  duplicate.allocations[0].candidateHandles[10] = "itm_1";
  assert.throws(
    () => validateProjectOptimizationResponse(duplicate, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  assert.throws(
    () => validateProjectOptimizationResponse(responseFixture(), {
      request,
      now: 1_500,
      usedHandles: new Set(["itm_1"]),
    }),
    expectCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );
});

test("project response enforces complete, partial, and infeasible consistency", () => {
  const request = requestFixture();
  const partial = responseFixture();
  partial.status = "partial";
  partial.optimality.state = "best_found";
  partial.coverageGaps = [{
    projectHandle: "prj_one",
    requirementHandle: "req_one",
    missingCandidateCount: 1,
    reasonCodes: ["coverage_gap"],
  }];
  assert.throws(
    () => validateProjectOptimizationResponse(partial, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const infeasible = responseFixture();
  infeasible.status = "infeasible";
  infeasible.optimality = {
    state: "infeasible", evaluatedAllocationCount: 42, objectiveTuple: [],
  };
  infeasible.allocations = [];
  infeasible.coverageGaps = [{
    projectHandle: "prj_one",
    requirementHandle: "req_one",
    missingCandidateCount: 11,
    reasonCodes: ["no_feasible_allocation"],
  }];
  const normalized = validateProjectOptimizationResponse(infeasible, { request, now: 1_500 });
  assert.equal(normalized.status, "infeasible");
});

test("project response rejects executable fields and open-ended warning/reason text", () => {
  const request = requestFixture();
  const executable = responseFixture();
  executable.steps = [{ type: "SUBMIT_SBC" }];
  assert.throws(
    () => validateProjectOptimizationResponse(executable, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const warning = responseFixture();
  warning.warningCodes = ["do_whatever_the_server_says"];
  assert.throws(
    () => validateProjectOptimizationResponse(warning, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );

  const reason = responseFixture();
  reason.reasonCodes = ["submit_now"];
  assert.throws(
    () => validateProjectOptimizationResponse(reason, { request, now: 1_500 }),
    expectCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});
