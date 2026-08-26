import assert from "node:assert/strict";
import test from "node:test";

import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
  isProContractError,
} from "../src/application/pro-contracts/errors.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeSafeId,
  normalizeStringArray,
} from "../src/application/pro-contracts/schema.js";

test("Pro schema accepts bounded plain JSON and produces detached frozen contracts", () => {
  const source = { schemaVersion: 1, payload: [{ handle: "card-1", rating: 88 }] };
  assert.equal(assertPlainJson(source), source);
  assert.equal(assertSchemaVersion(source.schemaVersion), PRO_CONTRACT_SCHEMA_VERSION);
  assertExactKeys(source, { required: ["schemaVersion", "payload"] });
  const contract = cloneAndFreezeContract(source);
  source.payload[0].rating = 1;
  assert.equal(contract.payload[0].rating, 88);
  assert.equal(Object.isFrozen(contract.payload[0]), true);
});

test("Pro schema rejects unknown keys and unsupported versions with stable errors", () => {
  assert.throws(
    () => assertExactKeys({ known: true, surprise: true }, { required: ["known"] }),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID) && error.path === "$.surprise",
  );
  assert.throws(
    () => assertSchemaVersion(2),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED),
  );
});

test("Pro schema recursively rejects credentials, persistent EA IDs, executable fields and URLs", () => {
  for (const input of [
    { nested: { access_token: "opaque" } },
    { cards: [{ itemId: "123" }] },
    { proposal: { workflow: {} } },
    { presentation: { href: "relative" } },
    { text: "https://cloud.example.test/plan" },
    { text: "javascript:alert(1)" },
  ]) {
    assert.throws(
      () => assertPlainJson(input),
      (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
    );
  }
});

test("Pro schema rejects non-JSON values, excessive depth and byte size", () => {
  assert.throws(() => assertPlainJson({ number: Number.NaN }), ProContractError);
  assert.throws(() => assertPlainJson({ value: 1n }), ProContractError);
  assert.throws(() => assertPlainJson({ value: () => true }), ProContractError);
  assert.throws(() => assertPlainJson({ date: new Date() }), ProContractError);
  assert.throws(() => assertPlainJson({ values: [, "x"] }), ProContractError);
  const circular = {};
  circular.self = circular;
  assert.throws(() => assertPlainJson(circular), ProContractError);
  assert.throws(
    () => assertPlainJson({ a: { b: { c: true } } }, { maxDepth: 2 }),
    ProContractError,
  );
  assert.throws(
    () => assertPlainJson({ values: Array(20).fill("abcd") }, { maxBytes: 40 }),
    (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_TOO_LARGE),
  );
});

test("Pro schema inspects descriptors without invoking accessors", () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "secret";
    },
  });
  assert.throws(() => assertPlainJson(accessor), /accessor/i);
  assert.equal(getterCalls, 0);

  const hidden = {};
  Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
  assert.throws(() => assertPlainJson(hidden), /non-enumerable/i);
  assert.throws(() => assertPlainJson({ [Symbol("hidden")]: 1 }), /symbol/i);
});

test("Pro strings use UTF-8 limits and reject control characters", () => {
  assert.throws(
    () => assertPlainJson({ value: "😀😀" }, { maxStringBytes: 7 }),
    /UTF-8/i,
  );
  for (const value of ["line\nbreak", "tab\tvalue", "nul\u0000value", "delete\u007fvalue"]) {
    assert.throws(() => assertPlainJson({ value }), /control/i);
  }
});

test("Pro scalar helpers enforce safe IDs and closed unique arrays", () => {
  assert.equal(normalizeSafeId("request-1"), "request-1");
  assert.throws(() => normalizeSafeId("../request"), ProContractError);
  assert.deepEqual(
    normalizeStringArray(["b", "a"], { allowed: ["a", "b"], sort: true }),
    ["a", "b"],
  );
  assert.throws(
    () => normalizeStringArray(["a", "a"], { allowed: ["a"] }),
    ProContractError,
  );
});

test("ProContractError serializes bounded stable metadata", () => {
  const error = new ProContractError(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH, "Response mismatch", {
    path: "$.requestId",
    details: { expected: "one" },
  });
  assert.deepEqual(error.toJSON(), {
    name: "ProContractError",
    code: "RESPONSE_MISMATCH",
    message: "Response mismatch",
    path: "$.requestId",
    details: { expected: "one" },
  });
});
