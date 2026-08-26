import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityRegistry,
  CapabilityState,
} from "../src/application/capability-registry.js";
import {
  COMPATIBILITY_CONFIG_STATUS,
  applyCompatibilityConfig,
  normalizeCompatibilityConfig,
} from "../src/application/pro-contracts/compatibility-config.js";

const NOW = 1_800_000_000_000;

const config = (overrides = {}) => ({
  schemaVersion: 1,
  status: "ready",
  configVersion: "compat-2026-08",
  issuedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
  gameVersions: ["fc26"],
  minimumClientVersion: "2.3.0",
  capabilityDowngrades: [
    {
      capabilityId: "ea.sbc.submit",
      state: "unavailable",
      reasonCode: "ea_update",
    },
  ],
  limitCaps: [
    { limitId: "router.max_steps", maximum: 4 },
  ],
  ...overrides,
});

const registry = () => {
  const value = new CapabilityRegistry();
  value.declare("ea.sbc.submit", { state: CapabilityState.AVAILABLE });
  value.declare("ea.inventory.read", { state: CapabilityState.UNVERIFIED });
  value.declare("ea.items.move", { state: CapabilityState.DEGRADED });
  return value;
};

test("compatibility config can only downgrade observed capability states", () => {
  const normalized = normalizeCompatibilityConfig(config(), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: registry(),
    config: normalized,
    gameVersion: "fc26",
    clientVersion: "2.3.0",
    localLimits: { "router.max_steps": 6, "workflow.max_iterations": 20 },
    now: NOW,
  });

  const byId = new Map(result.capabilities.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("ea.sbc.submit").state, CapabilityState.UNAVAILABLE);
  assert.equal(byId.get("ea.inventory.read").state, CapabilityState.UNVERIFIED);
  assert.equal(byId.get("ea.items.move").state, CapabilityState.DEGRADED);
  assert.deepEqual(result.limits, {
    "router.max_steps": 4,
    "workflow.max_iterations": 20,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("compatibility config rejects attempts to mark capabilities available", () => {
  const input = config({
    capabilityDowngrades: [{
      capabilityId: "ea.inventory.read",
      state: "available",
      reasonCode: "ea_update",
    }],
  });
  assert.throws(
    () => normalizeCompatibilityConfig(input, { now: NOW }),
    /state|available|downgrade/i,
  );
});

test("compatibility application revalidates raw input instead of trusting its shape", () => {
  const malicious = config({
    capabilityDowngrades: [{
      capabilityId: "ea.inventory.read",
      state: "available",
      reasonCode: "ea_update",
    }],
  });
  assert.throws(
    () => applyCompatibilityConfig({
      registry: registry(),
      config: malicious,
      gameVersion: "fc26",
      clientVersion: "2.3.0",
      now: NOW,
    }),
    /state|available|downgrade/i,
  );
});

test("unknown and unverified capabilities cannot become available", () => {
  const normalized = normalizeCompatibilityConfig(config({
    capabilityDowngrades: [
      {
        capabilityId: "ea.inventory.read",
        state: "degraded",
        reasonCode: "fresh_evidence_required",
      },
      {
        capabilityId: "ea.unknown.future",
        state: "degraded",
        reasonCode: "fresh_evidence_required",
      },
    ],
  }), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: registry(),
    config: normalized,
    gameVersion: "fc26",
    clientVersion: "2.3.0",
    now: NOW,
  });
  const byId = new Map(result.capabilities.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("ea.inventory.read").state, CapabilityState.UNVERIFIED);
  assert.equal(byId.has("ea.unknown.future"), false);
  assert.deepEqual(result.ignoredCapabilityIds, ["ea.unknown.future"]);
});

test("remote limit caps cannot create or increase local limits", () => {
  const normalized = normalizeCompatibilityConfig(config({
    limitCaps: [
      { limitId: "router.max_steps", maximum: 50 },
      { limitId: "remote.only", maximum: 1 },
    ],
  }), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: registry(),
    config: normalized,
    gameVersion: "fc26",
    clientVersion: "2.3.0",
    localLimits: { "router.max_steps": 6 },
    now: NOW,
  });
  assert.deepEqual(result.limits, { "router.max_steps": 6 });
  assert.deepEqual(result.ignoredLimitIds, ["remote.only"]);
});

test("FC27 remains unverified even if the local registry says available", () => {
  const value = new CapabilityRegistry();
  value.declare("ea.sbc.submit", { state: CapabilityState.AVAILABLE });
  const normalized = normalizeCompatibilityConfig(config({
    gameVersions: ["fc26", "fc27"],
    capabilityDowngrades: [],
    limitCaps: [],
  }), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: value,
    config: normalized,
    gameVersion: "fc27",
    clientVersion: "2.3.0",
    now: NOW,
  });
  assert.equal(result.capabilities[0].state, CapabilityState.UNVERIFIED);
  assert.equal(result.capabilities[0].reason, "FC27 behavior is unverified");
});

test("compatibility config requires exact v1, known status and bounded expiry", () => {
  assert.throws(
    () => normalizeCompatibilityConfig(config({ schemaVersion: 2 }), { now: NOW }),
    /schema/i,
  );
  assert.throws(
    () => normalizeCompatibilityConfig(config({ status: "enabled" }), { now: NOW }),
    /enabled|status/i,
  );
  assert.throws(
    () => normalizeCompatibilityConfig(config({ expiresAt: NOW + 1000 * 60 * 60 * 24 * 31 }), { now: NOW }),
    /expiry|validity|expiresAt/i,
  );
  assert.equal(
    normalizeCompatibilityConfig(config({ status: "cached" }), { now: NOW }).status,
    COMPATIBILITY_CONFIG_STATUS.CACHED,
  );
});

test("a minimum client version can only make capabilities unavailable", () => {
  const normalized = normalizeCompatibilityConfig(config({ capabilityDowngrades: [] }), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: registry(),
    config: normalized,
    gameVersion: "fc26",
    clientVersion: "2.2.9",
    now: NOW,
  });
  assert.equal(result.requiresClientUpdate, true);
  assert.equal(
    result.capabilities.every((entry) => entry.state === CapabilityState.UNAVAILABLE),
    true,
  );
});

test("a config for another game cannot impose its minimum client version", () => {
  const normalized = normalizeCompatibilityConfig(config({
    gameVersions: ["fc26"],
    capabilityDowngrades: [],
  }), { now: NOW });
  const result = applyCompatibilityConfig({
    registry: registry(),
    config: normalized,
    gameVersion: "fc27",
    clientVersion: "1.0.0",
    now: NOW,
  });
  assert.equal(result.applied, false);
  assert.equal(result.requiresClientUpdate, false);
  assert.equal(
    result.capabilities.find((entry) => entry.id === "ea.sbc.submit").state,
    CapabilityState.UNVERIFIED,
  );
});
