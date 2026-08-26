import assert from "node:assert/strict";
import test from "node:test";

import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

class CardProtectionEaAdapter extends FakeEaAdapter {
  constructor(options = {}) {
    super(options);
    this.inventoryReads = 0;
    this.inventoryCapabilityStatus = "AVAILABLE";
  }

  async readInventory() {
    this.inventoryReads += 1;
    return super.readInventory();
  }

  async getCapabilityHealth() {
    const capabilities = await super.getCapabilityHealth();
    return capabilities.map((capability) => capability.id === "inventory"
      ? { ...capability, status: this.inventoryCapabilityStatus }
      : capability);
  }
}

const evidencedCard = (id, rating, overrides = {}) => ({
  id,
  itemId: id,
  resourceId: `resource-${id}`,
  basePlayerId: `player-${id}`,
  name: `Card ${id}`,
  rating,
  cardType: "base",
  isSpecial: false,
  isTradeable: false,
  isUntradeable: true,
  isDuplicate: false,
  isLocked: false,
  isProtected: false,
  isFavorite: false,
  isInStartingSquad: false,
  isMovable: true,
  isStorable: true,
  ...overrides,
});

const createRuntime = async ({
  adapter = new CardProtectionEaAdapter({ iterations: 1 }),
  settings = {},
  projects = [],
} = {}) => {
  const storage = new FakeGrindStorage();
  storage.settings = structuredClone(settings);
  storage.projects = structuredClone(projects);
  const runtime = new GrindPilotRuntime({
    storage,
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();
  return { adapter, runtime };
};

const assertNoExecutionCalls = (adapter) => {
  assert.deepEqual(
    Object.fromEntries(
      ["solve", "submit", "resolve", "organize", "open"].map((name) => [name, adapter.calls[name]]),
    ),
    { solve: 0, submit: 0, resolve: 0, organize: 0, open: 0 },
  );
};

test("PREVIEW_FODDER_REVIEW refreshes inventory and compiles a Free read-only zero-step plan", async () => {
  const adapter = new CardProtectionEaAdapter({ iterations: 1 });
  const { runtime } = await createRuntime({
    adapter,
    settings: { protectRatingAtOrAbove: 94, protectedCardTypes: [] },
  });
  const readsAfterInitialization = adapter.inventoryReads;

  adapter.club = [evidencedCard("fresh-card", 96)];
  const viewModel = await runtime.executeProductShellCommand({ type: "PREVIEW_FODDER_REVIEW" });
  const plan = runtime.getState().fodderReviewPlan;

  assert.ok(adapter.inventoryReads > readsAfterInitialization);
  assert.equal(plan.preview.analyzedItemCount, 1);
  assert.equal(plan.preview.uniqueHardProtectedCount, 1);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.preview.readOnly, true);
  assert.equal(plan.preview.canApprove, false);
  assert.equal(viewModel.brand.plan, "free");
  assert.equal(viewModel.protection.analyzedItemCount, 1);
  assertNoExecutionCalls(adapter);
});

test("missing provenance stays unverified while known hard exclusions remain visible", async () => {
  const adapter = new CardProtectionEaAdapter({ iterations: 1 });
  adapter.club = [{
    id: "known-protected",
    itemId: "known-protected",
    resourceId: "known-resource",
    basePlayerId: "known-player",
    name: "Known protected card",
    rating: 82,
    cardType: "base",
  }];
  const { runtime } = await createRuntime({
    adapter,
    settings: {
      protectRatingAtOrAbove: null,
      protectedCardTypes: [],
      protectedItemIds: ["known-protected"],
    },
  });

  const viewModel = await runtime.executeProductShellCommand({ type: "PREVIEW_FODDER_REVIEW" });
  const preview = runtime.getState().fodderReviewPlan.preview;

  assert.equal(preview.verificationState, "unverified");
  assert.equal(preview.uniqueHardProtectedCount, 1);
  assert.equal(preview.notHardProtectedCount, null);
  assert.ok(preview.reasonGroups.some((group) => group.code === "protected-item" && group.itemCount === 1));
  assert.ok(preview.warnings.length > 0);
  assert.equal(viewModel.protection.status, "unverified");
  assert.equal(viewModel.protection.uniqueHardProtectedCount, 1);
  assertNoExecutionCalls(adapter);
});

test("unavailable inventory capability blocks the protection review without executing anything", async () => {
  const adapter = new CardProtectionEaAdapter({ iterations: 1 });
  adapter.inventoryCapabilityStatus = "UNAVAILABLE";
  adapter.club = [evidencedCard("blocked-card", 96)];
  const { runtime } = await createRuntime({ adapter });

  const viewModel = await runtime.executeProductShellCommand({ type: "PREVIEW_FODDER_REVIEW" });
  const plan = runtime.getState().fodderReviewPlan;

  assert.equal(plan.state, "blocked");
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "CAPABILITY_UNAVAILABLE"));
  assert.equal(viewModel.protection.status, "blocked");
  assert.ok(viewModel.protection.evidenceWarnings.some((message) => /capability/i.test(message)));
  assertNoExecutionCalls(adapter);
});

test("the public protection view model exposes neither card identifiers nor internal reason codes", async () => {
  const adapter = new CardProtectionEaAdapter({ iterations: 1 });
  adapter.club = [evidencedCard("private-item-id", 82, {
    name: "Private card",
    resourceId: "private-resource-id",
    basePlayerId: "private-player-id",
  })];
  const { runtime } = await createRuntime({
    adapter,
    settings: {
      protectRatingAtOrAbove: null,
      protectedCardTypes: [],
      protectedItemIds: ["private-item-id"],
      protectedPlayerIds: ["private-player-id"],
      protectedResourceIds: ["private-resource-id"],
    },
  });

  const viewModel = await runtime.executeProductShellCommand({ type: "PREVIEW_FODDER_REVIEW" });
  const serialized = JSON.stringify(viewModel.protection);

  for (const privateValue of [
    "private-item-id",
    "private-player-id",
    "private-resource-id",
    "protected-item",
    "protected-player",
    "protected-resource",
  ]) {
    assert.equal(serialized.includes(privateValue), false, `public model leaked ${privateValue}`);
  }
  assert.equal(/\"(?:itemId|playerId|resourceId)\"/.test(serialized), false);
  assert.ok(viewModel.protection.reasonGroups.length > 0);
  assert.ok(viewModel.protection.reasonGroups.every((group) => /^reason-\d+$/.test(group.code)));
  assertNoExecutionCalls(adapter);
});

test("active Target Project hard rules remain distinct from soft conservation reserves", async () => {
  const adapter = new CardProtectionEaAdapter({ iterations: 1 });
  adapter.club = [
    evidencedCard("threshold-hard", 94),
    evidencedCard("exact-hard", 91),
    evidencedCard("player-hard", 82, { basePlayerId: "project-player-hard" }),
    evidencedCard("resource-hard", 83, { resourceId: "project-resource-hard" }),
    evidencedCard("rating-reserve", 88),
    evidencedCard("squad-demand-a", 89),
    evidencedCard("squad-demand-b", 89),
    evidencedCard("special-reserve", 84, { cardType: "totw", isSpecial: true }),
  ];
  const { runtime } = await createRuntime({
    adapter,
    settings: {
      protectRatingAtOrAbove: null,
      protectedCardTypes: [],
      protectFavorites: false,
    },
    projects: [{
      id: "private-project-id",
      name: "Runtime Project",
      active: true,
      priority: 4,
      requiredSquadsRemaining: 2,
      protectedRatings: { atOrAbove: 93, exact: [91], reserveByRating: { 88: 1 } },
      protectedPlayerIds: ["project-player-hard"],
      protectedResourceIds: ["project-resource-hard"],
      ratingRequirements: [{ rating: 89, count: 2 }],
      specialCardRequirements: [{ cardType: "totw", count: 1 }],
    }],
  });

  const viewModel = await runtime.executeProductShellCommand({ type: "PREVIEW_FODDER_REVIEW" });
  const protection = viewModel.protection;
  const project = protection.projectSignals.find((entry) => entry.name === "Runtime Project");

  assert.equal(protection.uniqueHardProtectedCount, 4);
  assert.deepEqual(
    protection.ratingReserves.map((entry) => [entry.rating, entry.minimum, entry.observedCount]),
    [[88, 1, 1]],
  );
  assert.deepEqual(
    protection.specialReserves.map((entry) => [entry.cardType, entry.minimum, entry.observedCount]),
    [["totw", 1, 1]],
  );
  assert.deepEqual(project.hardExclusions, [
    "93+ rating threshold",
    "Exact 91 rating",
    "1 protected footballer",
    "1 protected card version",
  ]);
  assert.deepEqual(project.conservationPreferences, [
    "Keep 1 at 88 rating",
    "2 remaining 89-rated squad signals",
    "Keep 1 TOTW special signal",
  ]);
  assert.equal(JSON.stringify(protection).includes("private-project-id"), false);
  assertNoExecutionCalls(adapter);
});
