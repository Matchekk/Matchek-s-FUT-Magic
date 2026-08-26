import assert from "node:assert/strict";
import test from "node:test";

import { recommendRouterNextAction } from "../src/application/index.js";
import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

class RouterEaAdapter extends FakeEaAdapter {
  constructor(options = {}) {
    super(options);
    this.inventoryReads = 0;
  }

  async readInventory() {
    this.inventoryReads += 1;
    return super.readInventory();
  }
}

const card = (itemId, resourceId, overrides = {}) => ({
  id: itemId,
  itemId,
  resourceId,
  basePlayerId: `player-${itemId}`,
  name: "Observed card",
  rating: 84,
  cardType: "base",
  isSpecial: false,
  isTradeable: false,
  isUntradeable: true,
  isDuplicate: false,
  isMovable: true,
  isStorable: false,
  isLocked: false,
  isProtected: false,
  isFavorite: false,
  isInStartingSquad: false,
  ...overrides,
});

const createRuntime = async ({
  adapter = new RouterEaAdapter({ iterations: 1 }),
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

const assertNoAdapterWrites = (adapter) => {
  assert.deepEqual(adapter.calls, {
    solve: 0,
    submit: 0,
    claim: 0,
    open: 0,
    pick: 0,
    resolve: 0,
    organize: 0,
  });
};

const calculateFromCurrentEvidence = (runtime) => {
  const evidence = runtime.buildDuplicateRouteEvidence();
  const protectionPolicy = runtime.createFodderPolicy();
  const protectionAnalysis = protectionPolicy.analyze(evidence.inventorySnapshot.items);
  return recommendRouterNextAction({
    inventorySnapshot: evidence.inventorySnapshot,
    routeSummary: evidence.summary,
    capabilitySnapshot: evidence.capabilitySnapshot,
    gameContext: evidence.gameContext,
    activityGuard: runtime.currentRouterActivityGuard(),
    protectionAnalysis: {
      protectedItemIds: [...protectionAnalysis.protectedItemIds].map(String).sort(),
      reasonsByItemId: protectionAnalysis.reasonsByItemId,
      activeTargetProjectIds: [...protectionAnalysis.activeTargetProjectIds].map(String).sort(),
    },
    conservationPolicy: protectionPolicy.toSolverConservationPolicy(),
    duplicatePolicy: evidence.policy,
    observedAt: Number(evidence.inventorySnapshot.updatedAt),
  });
};

const collectKeys = (value, keys = new Set()) => {
  if (!value || typeof value !== "object") return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    collectKeys(entry, keys);
  }
  return keys;
};

test("duplicate preview computes one Router recommendation from a fresh full snapshot without writes", async () => {
  const adapter = new RouterEaAdapter({ iterations: 1 });
  const { runtime } = await createRuntime({ adapter });
  const readsAfterInitialization = adapter.inventoryReads;
  adapter.club = [card("club-owned", "owned-version")];
  adapter.storage = [card("stored-card", "stored-version")];
  adapter.unassigned = [card("fresh-unassigned", "fresh-version")];

  await runtime.previewDuplicateRoute();
  const recommendation = runtime.getState().routerRecommendation;

  assert.ok(adapter.inventoryReads > readsAfterInitialization);
  assert.equal(recommendation.counts.totalItems, 3);
  assert.equal(recommendation.counts.unassignedItems, 1);
  assert.equal(recommendation.state, "READY");
  assert.equal(recommendation.outcome.kind, "MOVE_TO_CLUB");
  assert.equal(recommendation.outcome.binding.itemId, "fresh-unassigned");
  assert.equal(Array.isArray(recommendation.outcome), false);
  assert.equal(recommendation.readOnly, true);
  assert.equal(recommendation.canExecute, false);
  assert.equal(Object.hasOwn(recommendation, "steps"), false);
  assertNoAdapterWrites(adapter);
});

test("public Router output is redacted and recalculation leaves the exact batch plan unchanged", async () => {
  const privateValues = {
    item: "private-owned-item",
    resource: "private-resource-version",
    player: "private-player-id",
    project: "private-project-id",
  };
  const adapter = new RouterEaAdapter({ iterations: 1 });
  adapter.club = [card("owned-copy", privateValues.resource)];
  adapter.storage = [];
  adapter.unassigned = [card(privateValues.item, privateValues.resource, {
    basePlayerId: privateValues.player,
    name: "Duplicate card",
    isDuplicate: true,
    isMovable: false,
    isStorable: true,
  })];
  const { runtime } = await createRuntime({
    adapter,
    settings: {
      protectedItemIds: [privateValues.item],
      protectedPlayerIds: [privateValues.player],
      protectedResourceIds: [privateValues.resource],
    },
    projects: [{
      id: privateValues.project,
      name: "Private project",
      active: true,
      priority: 1,
      requiredSquadsRemaining: 1,
      ratingRequirements: [{ rating: 84, count: 1 }],
    }],
  });

  await runtime.previewDuplicateRoute();
  const batchBefore = runtime.getState().duplicateRoutePlan;
  const canApproveBefore = runtime.getProductShellViewModel().duplicateRoute.canApprove;
  const independentRecommendation = calculateFromCurrentEvidence(runtime);
  const batchAfter = runtime.getState().duplicateRoutePlan;
  const viewModel = runtime.getProductShellViewModel();
  const publicRecommendation = viewModel.routerRecommendation;

  assert.equal(independentRecommendation.outcome.kind, "MOVE_TO_SBC_STORAGE");
  assert.deepEqual(batchAfter.preview.routeActions, batchBefore.preview.routeActions);
  assert.deepEqual(batchAfter.preview.approvedActions, batchBefore.preview.approvedActions);
  assert.equal(batchAfter.preview.actionSetFingerprint, batchBefore.preview.actionSetFingerprint);
  assert.equal(viewModel.duplicateRoute.canApprove, canApproveBefore);
  assert.equal(canApproveBefore, true);

  const serialized = JSON.stringify(publicRecommendation);
  for (const value of Object.values(privateValues)) {
    assert.equal(serialized.includes(value), false, `public Router output leaked ${value}`);
  }
  for (const rawCode of [
    independentRecommendation.outcome.reasonCode,
    "protected-item",
    "protected-player",
    "protected-resource",
  ]) {
    assert.equal(serialized.includes(rawCode), false, `public Router output leaked ${rawCode}`);
  }
  const publicKeys = collectKeys(publicRecommendation);
  for (const forbiddenKey of [
    "itemId", "resourceId", "playerId", "projectId",
    "fingerprint", "fingerprints", "objectiveTuple", "reasonCode",
    "routeActions", "approvedActions", "binding", "command", "commands",
    "steps", "canExecute", "canApprove", "execution",
  ]) {
    assert.equal(publicKeys.has(forbiddenKey), false, `public Router output exposed ${forbiddenKey}`);
  }
  assert.deepEqual([...publicKeys].sort(), [
    "card", "destination", "evidence", "isSpecial", "isTradable", "kind",
    "name", "observedAt", "rating", "readOnly", "reason", "status", "title",
  ]);
  assertNoAdapterWrites(adapter);
});

test("a general inventory refresh expires the Router recommendation with an explicit nothing-moved state", async () => {
  const adapter = new RouterEaAdapter({ iterations: 1 });
  adapter.club = [];
  adapter.storage = [];
  adapter.unassigned = [card("refresh-card", "refresh-version")];
  const { runtime } = await createRuntime({ adapter });
  await runtime.previewDuplicateRoute();
  assert.equal(runtime.getProductShellViewModel().routerRecommendation.status, "ready");

  await runtime.refreshStatus();
  const state = runtime.getState();
  const publicRecommendation = runtime.getProductShellViewModel().routerRecommendation;

  assert.equal(state.routerRecommendation, null);
  assert.match(state.routerRecommendationNotice, /refreshed/i);
  assert.equal(publicRecommendation.status, "expired");
  assert.equal(publicRecommendation.kind, "pause");
  assert.equal(publicRecommendation.readOnly, true);
  assert.match(publicRecommendation.reason, /refreshed/i);
  assert.match(publicRecommendation.evidence, /Nothing moved/i);
  assert.equal(publicRecommendation.card, null);
  assertNoAdapterWrites(adapter);
});

test("a non-idle Activity Guard blocks an otherwise feasible recommendation without mutation", async () => {
  const adapter = new RouterEaAdapter({ iterations: 1 });
  adapter.club = [];
  adapter.storage = [];
  adapter.unassigned = [card("guard-card", "guard-version")];
  const { runtime } = await createRuntime({ adapter });
  runtime.engine.getSnapshot = () => ({
    status: "paused",
    cursor: 0,
    nodes: [{ step: { type: "RESOLVE_ITEMS" } }],
  });

  await runtime.previewDuplicateRoute();
  const state = runtime.getState();
  const publicRecommendation = runtime.getProductShellViewModel().routerRecommendation;

  assert.equal(state.duplicateRoutePlan.state, "ready");
  assert.equal(state.duplicateRoutePlan.preview.safeCount, 1);
  assert.equal(state.routerRecommendation.state, "BLOCKED");
  assert.equal(state.routerRecommendation.outcome.kind, "PAUSE");
  assert.equal(state.routerRecommendation.outcome.reasonCode, "ACTIVITY_GUARD_NOT_IDLE");
  assert.equal(publicRecommendation.status, "blocked");
  assert.equal(publicRecommendation.kind, "pause");
  assert.match(publicRecommendation.reason, /active run/i);
  assertNoAdapterWrites(adapter);
});
