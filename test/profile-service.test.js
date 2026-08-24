import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { ProfileService, normalizeProfile } from "../src/profiles/profile-service.js";

function completeProfile(overrides = {}) {
  return {
    id: "daily-upgrades",
    name: "Daily Upgrades",
    workflow: { steps: [{ id: "solve", type: "SOLVE_SBC", config: { challengeId: "123" } }] },
    solverSettings: { maxRating: 90 },
    fodderPolicy: { protectRatingAtOrAbove: 94 },
    duplicatePolicy: { untradeableOverflow: "PAUSE" },
    packPolicy: { mode: "OPEN_CURRENT_REWARD" },
    pickPolicy: { type: "PAUSE_FOR_USER" },
    runLimits: { maxIterations: 10 },
    stopConditions: [{ type: "UNRESOLVED_UNASSIGNED" }],
    ...overrides,
  };
}

test("profiles require every grind configuration section", () => {
  const profile = completeProfile();
  delete profile.fodderPolicy;
  assert.throws(() => normalizeProfile(profile), { code: "INCOMPLETE_PROFILE" });
});

test("profile service saves detached data through injected repository", async () => {
  const repository = new InMemoryProfileRepository();
  const service = new ProfileService({ repository, clock: () => "2026-08-24T12:00:00.000Z" });
  const input = completeProfile();
  await service.save(input);
  input.workflow.steps[0].config.challengeId = "mutated";
  const saved = await service.get("daily-upgrades");
  assert.equal(saved.workflow.steps[0].config.challengeId, "123");
  assert.equal(saved.updatedAt, "2026-08-24T12:00:00.000Z");
});

test("profile JSON export/import validates envelope and collisions", async () => {
  const source = new ProfileService({ repository: new InMemoryProfileRepository(), clock: () => "2026-08-24T12:00:00.000Z" });
  await source.save(completeProfile());
  const json = await source.export("daily-upgrades");

  const destination = new ProfileService({ repository: new InMemoryProfileRepository(), clock: () => "2026-08-24T12:01:00.000Z" });
  const imported = await destination.import(json);
  assert.equal(imported.name, "Daily Upgrades");
  await assert.rejects(() => destination.import(json), { code: "PROFILE_EXISTS" });
});

test("profiles forbid executable condition expressions", () => {
  assert.throws(() => normalizeProfile(completeProfile({
    stopConditions: [{ type: "CUSTOM", expression: "inventory.clear()" }],
  })), { code: "ARBITRARY_CODE_FORBIDDEN" });
});

test("profile pack configuration cannot authorize purchases", () => {
  assert.throws(() => normalizeProfile(completeProfile({
    packPolicy: { mode: "OPEN_ALL_ALLOWED_PACKS", spendPoints: true },
  })), { code: "PURCHASE_FORBIDDEN" });
});
