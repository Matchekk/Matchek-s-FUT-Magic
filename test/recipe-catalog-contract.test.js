import assert from "node:assert/strict";
import test from "node:test";

import {
  RECIPE_CATALOG_STATUS,
  normalizeRecipeCatalogSnapshot,
} from "../src/application/pro-contracts/recipe-catalog.js";

const NOW = 1_800_000_000_000;

const catalog = (overrides = {}) => ({
  schemaVersion: 1,
  status: "ready",
  catalogVersion: "catalog-2026-08",
  issuedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
  recipes: [
    {
      id: "daily-upgrade-chain",
      localDefinitionId: "daily_upgrade_v1",
      localDefinitionVersion: 1,
      enabled: true,
      gameVersions: ["fc26"],
      requiredFeatureId: "cloud_recipes",
      requiredCapabilityIds: ["ea.inventory.read", "ea.sbc.solve.preview"],
    },
  ],
  ...overrides,
});

test("recipe catalog accepts only metadata for locally shipped definitions", () => {
  const result = normalizeRecipeCatalogSnapshot({
    input: catalog(),
    knownLocalDefinitionIds: new Set(["daily_upgrade_v1"]),
    now: NOW,
  });

  assert.equal(result.status, RECIPE_CATALOG_STATUS.READY);
  assert.equal(result.recipes[0].localDefinitionId, "daily_upgrade_v1");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.recipes[0]), true);
});

test("recipe catalog rejects unknown local definitions and executable or remote content", () => {
  assert.throws(
    () => normalizeRecipeCatalogSnapshot({
      input: catalog(),
      knownLocalDefinitionIds: ["another_definition"],
      now: NOW,
    }),
    /local definition|allowlist/i,
  );

  for (const injected of [
    { steps: [{ type: "OPEN_PACK" }] },
    { parameters: { iterations: 100 } },
    { script: "alert(1)" },
    { selector: ".submit" },
    { url: "https://example.invalid/recipe" },
    { content: "Remote recipe body" },
  ]) {
    const input = catalog();
    Object.assign(input.recipes[0], injected);
    assert.throws(
      () => normalizeRecipeCatalogSnapshot({
        input,
        knownLocalDefinitionIds: ["daily_upgrade_v1"],
        now: NOW,
      }),
      /forbidden|unknown|unexpected|key/i,
    );
  }
});

test("recipe catalog rejects feature identifiers the local client does not implement", () => {
  const input = catalog();
  input.recipes[0].requiredFeatureId = "remote_recipe_catalog";
  assert.throws(
    () => normalizeRecipeCatalogSnapshot({
      input,
      knownLocalDefinitionIds: ["daily_upgrade_v1"],
      now: NOW,
    }),
    /unsupported|feature/i,
  );
});

test("recipe catalog enforces exact v1 schema and bounded validity", () => {
  assert.throws(
    () => normalizeRecipeCatalogSnapshot({
      input: catalog({ schemaVersion: 2 }),
      knownLocalDefinitionIds: ["daily_upgrade_v1"],
      now: NOW,
    }),
    /schema/i,
  );
  assert.throws(
    () => normalizeRecipeCatalogSnapshot({
      input: catalog({ expiresAt: NOW - 2_000, issuedAt: NOW - 1_000 }),
      knownLocalDefinitionIds: ["daily_upgrade_v1"],
      now: NOW,
    }),
    /expiresAt|expiry/i,
  );
  assert.throws(
    () => normalizeRecipeCatalogSnapshot({
      input: catalog({ expiresAt: NOW + 1000 * 60 * 60 * 24 * 31 }),
      knownLocalDefinitionIds: ["daily_upgrade_v1"],
      now: NOW,
    }),
    /expiry|validity|expiresAt/i,
  );
});

test("cached recipe metadata remains explicitly cached", () => {
  const result = normalizeRecipeCatalogSnapshot({
    input: catalog({ status: "cached" }),
    knownLocalDefinitionIds: ["daily_upgrade_v1"],
    now: NOW,
  });
  assert.equal(result.status, RECIPE_CATALOG_STATUS.CACHED);
});
