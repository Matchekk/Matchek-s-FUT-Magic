import test from "node:test";
import assert from "node:assert/strict";

import {
  ERROR_CODES,
  GrindPilotError,
  isGrindPilotError,
  toGrindPilotError,
} from "../src/core/errors.js";
import {
  capture,
  captureAsync,
  fail,
  isFailure,
  isOk,
  ok,
  unwrap,
} from "../src/core/result.js";

test("GrindPilotError preserves stable code, safe metadata, and cause", () => {
  const cause = new Error("network down");
  const details = { stepId: "open-pack" };
  const error = new GrindPilotError(ERROR_CODES.INVALID_STATE, "Cannot open pack", {
    cause,
    details,
    retryable: true,
  });
  details.stepId = "mutated";

  assert.equal(error.code, ERROR_CODES.INVALID_STATE);
  assert.equal(error.cause, cause);
  assert.equal(error.details.stepId, "open-pack");
  assert.equal(error.retryable, true);
  assert.deepEqual(error.toJSON(), {
    name: "GrindPilotError",
    code: ERROR_CODES.INVALID_STATE,
    message: "Cannot open pack",
    details: { stepId: "open-pack" },
    retryable: true,
  });
});

test("unknown thrown values normalize at a domain boundary", () => {
  const original = new GrindPilotError("KNOWN", "known");
  assert.equal(toGrindPilotError(original), original);

  const normalized = toGrindPilotError(new Error("socket closed"), {
    code: ERROR_CODES.STORAGE_UNAVAILABLE,
    retryable: true,
  });
  assert.equal(isGrindPilotError(normalized, ERROR_CODES.STORAGE_UNAVAILABLE), true);
  assert.equal(normalized.message, "socket closed");
  assert.equal(normalized.retryable, true);
});

test("Result helpers keep expected failures out of exception control flow", async () => {
  const success = ok(42);
  const failure = fail(new GrindPilotError("NOPE", "nope"));
  assert.equal(isOk(success), true);
  assert.equal(isFailure(failure), true);
  assert.equal(unwrap(success), 42);
  assert.throws(() => unwrap(failure), /nope/);

  assert.equal(capture(() => "done").value, "done");
  assert.equal(capture(() => { throw new Error("bad"); }).error.message, "bad");
  const asyncResult = await captureAsync(async () => {
    throw new Error("async bad");
  });
  assert.equal(asyncResult.ok, false);
  assert.equal(asyncResult.error.message, "async bad");
});
