import test from "node:test";
import assert from "node:assert/strict";

import { GrindPilotRuntime, buildWorkflow } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { TargetProjectService } from "../src/policies/target-project-service.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

const waitFor = async (predicate, message, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
};

test("active-squad protection cannot be disabled by stored or UI settings", async () => {
  const storage = new FakeGrindStorage();
  storage.settings = { protectStartingSquad: false };
  const runtime = new GrindPilotRuntime({
    storage,
    adapter: new FakeEaAdapter({ iterations: 1 }),
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  });

  await runtime.initialize();
  assert.equal(runtime.getState().draft.protectStartingSquad, true);

  await runtime.saveProtectionSettings({ protectStartingSquad: false });
  assert.equal(runtime.getState().draft.protectStartingSquad, true);
  assert.equal(storage.settings.protectStartingSquad, true);
});

test("fake EA completes 20 grind iterations and reconciles every destructive reload", async () => {
  const storage = new FakeGrindStorage();
  const adapter = new FakeEaAdapter({ iterations: 20 });
  const workflowRepository = new MemoryWorkflowRepository();
  const profileRepository = new InMemoryProfileRepository();
  const snapshot = await adapter.readCurrentSbcProject();
  const targets = new TargetProjectService();
  targets.importCurrentSbc(snapshot, {
    protectedRatings: { atOrAbove: 94, reserveByRating: { 89: 2 } },
  });
  storage.projects = targets.list();
  for (const operation of ["submit", "claim", "open", "pick", "resolve"]) {
    adapter.interruptNext(operation);
  }

  const createRuntime = () => new GrindPilotRuntime({
    storage,
    adapter,
    workflowRepository,
    profileRepository,
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
    origin: "https://fake.invalid",
  });

  let runtime = createRuntime();
  await runtime.initialize();
  const workflow = buildWorkflow({ maxIterations: 20 });
  for (const step of workflow.steps[0].config.body) step.timeoutMs = 1_000;
  const startPromise = runtime.start({
    ...runtime.defaultConfig(),
    mode: "AUTO",
    maxIterations: 20,
    runLimits: { maxIterations: 20, maxSbcSubmissions: 20, maxPacksOpened: 20 },
    protectRatingAtOrAbove: 94,
    minimumReserveByRating: { 89: 2 },
    pickMode: "HIGHEST_RATING",
    pickPolicy: { type: "HIGHEST_RATING" },
    workflow,
  });
  startPromise.catch(() => {});

  const interruptedTypes = [
    "SUBMIT_SBC",
    "CLAIM_REWARD",
    "OPEN_REWARD_PACK",
    "HANDLE_PLAYER_PICK",
    "RESOLVE_ITEMS",
  ];
  for (const expectedType of interruptedTypes) {
    await waitFor(async () => {
      const run = await workflowRepository.loadActiveRun();
      return run?.status === "running" &&
        run?.nodes?.[run.cursor]?.status === "running" &&
        run?.nodes?.[run.cursor]?.step?.type === expectedType;
    }, `Fake run did not interrupt during ${expectedType}`);

    runtime = createRuntime();
    await runtime.initialize();
    const recovered = runtime.engine.getSnapshot();
    assert.equal(recovered.status, "paused");
    assert.equal(recovered.pauseReason.code, "RECOVERED_STEP_COMPLETED");
    if (expectedType !== interruptedTypes.at(-1)) {
      runtime.resume().catch(() => {});
    }
  }

  await runtime.resume();
  const run = await waitFor(
    () => Promise.resolve(runtime.engine.getSnapshot()?.status === "completed" && runtime.engine.getSnapshot()),
    "Fake 20-iteration run did not complete",
    8_000,
  );
  const state = runtime.getState();
  assert.equal(run.counters.loopIterations, 20);
  assert.equal(state.sbcCompleted, 20);
  assert.equal(state.packsOpened, 20);
  assert.equal(state.picksCompleted, 20);
  assert.equal(adapter.calls.pick, 20);
  assert.equal(adapter.unassigned.length, 0);
  assert.ok(adapter.storage.length > 0, "duplicate cards should be recycled into SBC Storage");
  assert.ok(adapter.club.some((item) => Number(item.rating) >= 94), "hard-protected premium cards must survive");
  assert.ok(adapter.lastSolveOptions.conservationPolicy.minimumReserveByRating[89] >= 2);
  assert.equal(storage.projects[0].sourceSetId, adapter.setId);
  assert.equal(storage.projects[0].sourceChallenges.filter((entry) => entry.completed).length, 20);
  assert.equal(storage.projects[0].completionProgress, 1);
  assert.equal(state.analytics.iterations, 20);
  assert.equal(state.analytics.packsOpened, 20);
  assert.ok(state.analytics.ratingFlow.consumed.cards > 0);
  assert.equal(state.analytics.ratingFlow.received.cards, 20 * 12);
});

test("Recycle Cards quick action moves only safe unassigned cards without a second modal", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  const duplicateSource = adapter.club[0];
  adapter.unassigned = [
    {
      itemId: "unassigned-normal",
      resourceId: "resource-new",
      basePlayerId: "player-new",
      rating: 82,
      isTradeable: false,
      isUntradeable: true,
      isDuplicate: false,
    },
    {
      itemId: "unassigned-duplicate",
      resourceId: duplicateSource.resourceId,
      basePlayerId: duplicateSource.basePlayerId,
      rating: duplicateSource.rating,
      isTradeable: false,
      isUntradeable: true,
      isDuplicate: true,
    },
  ];
  const confirmations = [];
  const runtime = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: (message) => { confirmations.push(message); return true; },
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();

  const run = await runtime.recycleCards();

  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.resolve, 1);
  assert.equal(adapter.unassigned.length, 0);
  assert.ok(adapter.club.some((item) => item.itemId === "unassigned-normal"));
  assert.ok(adapter.storage.some((item) => item.itemId === "unassigned-duplicate"));
  assert.deepEqual(confirmations, []);
});

test("Organizer never targets full SBC Storage and consumes the exact leftover cards in the chosen SBC", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  const duplicateSource = adapter.club[20];
  adapter.storage = [{
    itemId: "storage-full",
    resourceId: "storage-resource",
    basePlayerId: "storage-player",
    rating: 80,
    isTradeable: false,
    isUntradeable: true,
  }];
  adapter.unassigned = [
    {
      itemId: "organizer-normal",
      resourceId: "organizer-normal-resource",
      basePlayerId: "organizer-normal-player",
      rating: 81,
      isTradeable: false,
      isUntradeable: true,
      isDuplicate: false,
    },
    {
      itemId: "organizer-leftover",
      resourceId: duplicateSource.resourceId,
      basePlayerId: duplicateSource.basePlayerId,
      rating: duplicateSource.rating,
      isTradeable: false,
      isUntradeable: true,
      isDuplicate: true,
    },
  ];
  const targetService = new TargetProjectService();
  const target = targetService.importCurrentSbc(await adapter.readCurrentSbcProject(), {
    name: "85x10",
  });
  const storage = new FakeGrindStorage();
  storage.settings = {
    storageCapacity: 1,
    organizerTargetProjectId: target.id,
  };
  storage.projects = targetService.list();
  const runtime = new GrindPilotRuntime({
    storage,
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();

  const run = await runtime.recycleCards();

  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.resolve, 1);
  assert.equal(adapter.calls.organize, 1);
  assert.ok(adapter.club.some((item) => item.itemId === "organizer-normal"));
  assert.equal(adapter.storage.length, 1, "full storage must not receive another card");
  assert.ok(!adapter.storage.some((item) => item.itemId === "organizer-leftover"));
  assert.ok(!adapter.unassigned.some((item) => item.itemId === "organizer-leftover"));
  const organizerNode = run.nodes.find((node) => node.step.type === "ORGANIZE_ITEMS");
  assert.deepEqual(organizerNode.intent.requiredItemIds, ["organizer-leftover"]);
  assert.deepEqual(organizerNode.result.organizedItemIds, ["organizer-leftover"]);
});

test("Organizer discovers 10x85 automatically when no Target Project exists", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  const duplicateSource = adapter.club[20];
  adapter.storageCapacity = 1;
  adapter.storage = [{
    itemId: "storage-full",
    resourceId: "storage-resource",
    basePlayerId: "storage-player",
    rating: 80,
    isTradeable: false,
    isUntradeable: true,
  }];
  adapter.unassigned = [{
    itemId: "auto-target-leftover",
    resourceId: duplicateSource.resourceId,
    basePlayerId: duplicateSource.basePlayerId,
    rating: duplicateSource.rating,
    isTradeable: false,
    isUntradeable: true,
    isDuplicate: true,
  }];
  const storage = new FakeGrindStorage();
  storage.settings = { storageCapacity: 1 };
  const runtime = new GrindPilotRuntime({
    storage,
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();

  const run = await runtime.recycleCards();

  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.organize, 1);
  assert.equal(adapter.unassigned.length, 0);
  const organizerNode = run.nodes.find((node) => node.step.type === "ORGANIZE_ITEMS");
  assert.equal(organizerNode.intent.target.setId, adapter.setId);
  assert.equal(organizerNode.intent.target.challengeId, "challenge-1");
  assert.deepEqual(organizerNode.intent.requiredItemIds, ["auto-target-leftover"]);
});

test("Quick Open opens exactly one verified owned pack and never buys one", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  adapter.packs = [{
    packId: "owned-pack",
    id: "owned-pack",
    name: "Owned Reward Pack",
    count: 1,
    owned: true,
    isReward: true,
    costsCoins: false,
    costsPoints: false,
  }];
  const runtime = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();

  const run = await runtime.quickOpenPack();

  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.open, 1);
  assert.equal(adapter.packs.length, 0);
  assert.equal(adapter.unassigned.length, 12);
});

test("Quick Open can target the exact owned pack selected by its native pack-card button", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  adapter.packs = [
    { packId: "first-pack", id: "first-pack", name: "First Pack", count: 1, owned: true, isReward: true },
    { packId: "selected-pack", id: "selected-pack", name: "Selected Pack", count: 1, owned: true, isReward: true },
  ];
  const runtime = new GrindPilotRuntime({
    storage: new FakeGrindStorage(), adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false, enableActivityPersistence: false,
    confirm: () => true, root: {}, origin: "https://fake.invalid",
  });
  await runtime.initialize();

  const run = await runtime.quickOpenPack({ packId: "selected-pack" });

  assert.equal(run.status, "completed");
  assert.equal(adapter.calls.open, 1);
  assert.deepEqual(adapter.packs.map((pack) => pack.packId), ["first-pack"]);
});

test("a second runtime cannot start another workflow against an active repository", async () => {
  const repository = new MemoryWorkflowRepository();
  const definition = buildWorkflow({ maxIterations: 1 });
  const first = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter: new FakeEaAdapter({ iterations: 1 }),
    workflowRepository: repository,
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
  });
  await first.engine.start(definition, { mode: "REVIEW" });
  const second = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter: new FakeEaAdapter({ iterations: 1 }),
    workflowRepository: repository,
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    confirm: () => true,
    root: {},
  });
  await assert.rejects(
    () => second.engine.start(definition, { mode: "REVIEW" }),
    { code: "WORKFLOW_ALREADY_ACTIVE" },
  );
});
