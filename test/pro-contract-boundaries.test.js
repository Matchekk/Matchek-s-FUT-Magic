import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  EntitlementService,
  Feature,
  ProductPlan,
} from "../src/application/entitlement-service.js";
import {
  FREE_FEATURE_IDS,
  PRO_FEATURE_IDS,
} from "../src/application/pro-contracts/entitlement-provider.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  isProContractError,
} from "../src/application/pro-contracts/errors.js";
import {
  RequestHandleKind,
  createRequestHandleScope,
} from "../src/application/pro-contracts/request-handles.js";
import { assertPlainJson } from "../src/application/pro-contracts/schema.js";

const proContractDirectory = new URL("../src/application/pro-contracts/", import.meta.url);

const assertInvalidContract = (value) => assert.throws(
  () => assertPlainJson(value),
  (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
);

test("request handles are request-local, non-serializing, and unusable after disposal", () => {
  const privateOwnedItemId = "ea-owned-item-123456";
  const first = createRequestHandleScope({ idFactory: () => "request-a-random" });
  const second = createRequestHandleScope({ idFactory: () => "request-b-random" });

  const firstHandle = first.issueItem(privateOwnedItemId);
  const secondHandle = second.issueItem(privateOwnedItemId);

  assert.equal(firstHandle, "itm_request-a-random");
  assert.equal(secondHandle, "itm_request-b-random");
  assert.notEqual(firstHandle, secondHandle);
  assert.equal(first.issueItem(privateOwnedItemId), firstHandle);
  assert.equal(first.resolve(firstHandle, RequestHandleKind.ITEM), privateOwnedItemId);
  assert.equal(second.has(firstHandle), false);
  assert.equal(firstHandle.includes(privateOwnedItemId), false);
  assert.deepEqual(Object.keys(first), []);
  assert.equal(JSON.stringify(first), "{}");
  assert.equal(JSON.stringify(first).includes(privateOwnedItemId), false);

  first.dispose();
  first.dispose();
  assert.equal(first.active, false);
  assert.equal(first.size, 0);
  for (const operation of [
    () => first.has(firstHandle),
    () => first.resolve(firstHandle),
    () => first.issueItem(privateOwnedItemId),
  ]) {
    assert.throws(
      operation,
      (error) => isProContractError(error, PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
    );
  }

  assert.equal(second.active, true);
  assert.equal(second.resolve(secondHandle), privateOwnedItemId);
});

test("Pro contract modules contain no transport calls or endpoint literals", () => {
  const moduleNames = readdirSync(proContractDirectory)
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.ok(moduleNames.length > 0);

  for (const moduleName of moduleNames) {
    const source = readFileSync(new URL(moduleName, proContractDirectory), "utf8");
    assert.doesNotMatch(source, /\b(?:globalThis\.)?fetch\s*\(/, `${moduleName} calls fetch directly`);
    assert.doesNotMatch(source, /\b(?:XMLHttpRequest|WebSocket|EventSource)\b/, `${moduleName} embeds a transport`);
    assert.doesNotMatch(source, /(?:https?|wss?):\/\/[^\s"'`)]+/i, `${moduleName} contains an endpoint literal`);
  }
});

test("Pro contracts do not expand extension permissions or network origins", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.deepEqual(manifest.permissions, ["storage", "scripting", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*",
    "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*",
  ]);
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
  assert.equal(Object.hasOwn(manifest, "externally_connectable"), false);
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'self'",
  );
});

test("Free keeps every local safety feature while every new Pro feature stays locked", () => {
  const freeSafetyFeatures = [
    Feature.PRODUCT_SHELL,
    Feature.SBC_PROJECTS,
    Feature.LOCAL_RECIPES,
    Feature.ADVANCED_TOOLS,
  ];
  const proOnlyFeatures = [
    Feature.EVOLUTION_PLANNING,
    Feature.CLUB_OPTIMIZATION,
    Feature.PROJECT_OPTIMIZATION,
    Feature.SMART_ROUTING,
    Feature.CLOUD_RECIPES,
  ];
  const free = new EntitlementService({ plan: ProductPlan.FREE });
  const pro = new EntitlementService({ plan: ProductPlan.PRO });

  assert.deepEqual([...FREE_FEATURE_IDS].sort(), [...freeSafetyFeatures].sort());
  assert.deepEqual(
    [...PRO_FEATURE_IDS].sort(),
    [...new Set([...freeSafetyFeatures, ...proOnlyFeatures])].sort(),
  );
  for (const feature of freeSafetyFeatures) {
    assert.equal(free.check(feature).entitled, true, `${feature} must remain Free`);
    assert.equal(pro.check(feature).entitled, true, `${feature} must remain available on Pro`);
  }
  for (const feature of proOnlyFeatures) {
    assert.equal(free.check(feature).entitled, false, `${feature} must remain Pro-only`);
    assert.equal(free.check(feature).requiredPlan, ProductPlan.PRO);
    assert.equal(pro.check(feature).entitled, true);
  }
});

test("schema rejection is descriptor-safe and covers every non-JSON primitive", () => {
  let getterCalls = 0;
  const rootGetter = {};
  Object.defineProperty(rootGetter, "payload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    },
  });
  const nestedGetter = { nested: {} };
  Object.defineProperty(nestedGetter.nested, "payload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    },
  });
  const arrayGetter = [];
  Object.defineProperty(arrayGetter, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    },
  });

  assertInvalidContract(rootGetter);
  assertInvalidContract(nestedGetter);
  assertInvalidContract({ values: arrayGetter });
  assert.equal(getterCalls, 0);

  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, "hidden", { enumerable: false, value: "secret" });
  assertInvalidContract(nonEnumerable);
  assertInvalidContract({ [Symbol("hidden")]: "secret" });

  const circular = {};
  circular.self = circular;
  for (const value of [
    circular,
    { value: () => true },
    { value: 1n },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: Number.NEGATIVE_INFINITY },
  ]) {
    assertInvalidContract(value);
  }

  for (const control of ["nul\u0000", "tab\t", "line\n", "delete\u007f", "c1\u0085"]) {
    assertInvalidContract({ value: control });
  }
});
