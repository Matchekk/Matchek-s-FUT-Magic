import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ControllerAdapter,
  ControllerGameVersionObservation,
  normalizeControllerContext,
} from "../src/ea/controller-adapter.js";
import { FakeEaAdapter } from "./support/fake-ea-adapter.js";

test("legacy bridge context receives the sole bounded FC26 compatibility default", () => {
  const context = normalizeControllerContext({
    setId: 26,
    setName: "Observed set",
    challengeId: 42,
    challengeName: "Observed challenge",
    challengeCompleted: true,
    bridgeReady: true,
  });

  assert.deepEqual(context, {
    gameVersion: "fc26",
    gameVersionObservation: "compatibility_default",
    gameVersionSource: "legacy_bridge_v1",
    route: null,
    setId: "26",
    setName: "Observed set",
    challengeId: "42",
    challengeName: "Observed challenge",
    challengeCompleted: true,
    bridgeReady: true,
  });
  assert.equal(Object.isFrozen(context), true);
});

test("explicit recognized versions preserve observation while unknown and malformed values fail closed", () => {
  assert.deepEqual(normalizeControllerContext({
    gameVersion: "FC27",
    gameVersionObservation: "observed",
    gameVersionSource: "ea_runtime",
    route: null,
  }), {
    gameVersion: "fc27",
    gameVersionObservation: "observed",
    gameVersionSource: "ea_runtime",
    route: null,
    setId: null,
    setName: null,
    challengeId: null,
    challengeName: null,
    challengeCompleted: false,
    bridgeReady: false,
  });

  const unverifiedFc26 = normalizeControllerContext({
    gameVersion: "fc26",
    gameVersionObservation: "unverified",
    gameVersionSource: "untrusted-shape",
  });
  assert.equal(unverifiedFc26.gameVersion, "fc26");
  assert.equal(
    unverifiedFc26.gameVersionObservation,
    ControllerGameVersionObservation.UNVERIFIED,
  );
  assert.equal(unverifiedFc26.gameVersionSource, "main_world_context");

  for (const value of ["unknown", "fc28", "26", 26, null]) {
    const context = normalizeControllerContext({
      gameVersion: value,
      gameVersionObservation: "observed",
      gameVersionSource: "ea_runtime",
    });
    assert.equal(context.gameVersion, "unknown");
    assert.equal(context.gameVersionObservation, "unverified");
    assert.equal(context.gameVersionSource, "none");
  }
  assert.equal(normalizeControllerContext(null).gameVersion, "unknown");
  assert.equal(normalizeControllerContext([]).gameVersion, "unknown");
  assert.equal(normalizeControllerContext(Object.create({ gameVersion: "fc26" })).gameVersion, "unknown");
});

test("context normalization is descriptor-safe and bounds every display scalar", () => {
  let invoked = false;
  const context = {
    setName: "x".repeat(241),
    challengeId: "y".repeat(129),
  };
  Object.defineProperty(context, "gameVersion", {
    enumerable: true,
    get() {
      invoked = true;
      return "fc26";
    },
  });

  const normalized = normalizeControllerContext(context);
  assert.equal(invoked, false);
  assert.equal(normalized.gameVersion, "unknown");
  assert.equal(normalized.setName, null);
  assert.equal(normalized.challengeId, null);
});

test("ControllerAdapter normalizes bridge context before returning it", async () => {
  globalThis.window = {
    eaData: {
      grindPilot: {
        getContext: async () => ({
          gameVersion: "fc27",
          gameVersionObservation: "observed",
          gameVersionSource: "ea_runtime",
          setId: 99,
          bridgeReady: true,
          ignoredController: { unsafe: true },
        }),
      },
    },
  };
  try {
    const context = await new ControllerAdapter().getContext();
    assert.equal(context.gameVersion, "fc27");
    assert.equal(context.gameVersionObservation, "observed");
    assert.equal(context.gameVersionSource, "ea_runtime");
    assert.equal(context.setId, "99");
    assert.equal(Object.hasOwn(context, "ignoredController"), false);
  } finally {
    delete globalThis.window;
  }
});

test("legacy MAIN bridge remains versionless so the isolated adapter owns the compatibility rule", () => {
  const source = readFileSync(new URL("../page/ea-data-bridge.js", import.meta.url), "utf8");
  const start = source.indexOf("const grindPilotContext = () => ({");
  const end = source.indexOf("\n  });", start);
  const contextSource = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.doesNotMatch(contextSource, /gameVersion\s*:/);
  assert.match(contextSource, /legacy FC26 bridge contract is intentionally versionless/);
});

test("shared fake adapter declares FC26 evidence instead of relying on runtime defaults", async () => {
  const fc26 = await new FakeEaAdapter().getContext();
  const fc27 = await new FakeEaAdapter({ gameVersion: "fc27" }).getContext();
  const unknown = await new FakeEaAdapter({ gameVersion: "unknown" }).getContext();

  assert.deepEqual(
    [fc26.gameVersion, fc26.gameVersionObservation, fc26.gameVersionSource],
    ["fc26", "observed", "test_fixture"],
  );
  assert.deepEqual(
    [fc27.gameVersion, fc27.gameVersionObservation, fc27.gameVersionSource],
    ["fc27", "observed", "test_fixture"],
  );
  assert.deepEqual(
    [unknown.gameVersion, unknown.gameVersionObservation, unknown.gameVersionSource],
    ["unknown", "unverified", "none"],
  );
});
