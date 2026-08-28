import assert from "node:assert/strict";
import test from "node:test";

import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
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

const item = (id, resourceId, overrides = {}) => ({
  id,
  itemId: id,
  resourceId,
  basePlayerId: `player-${id}`,
  name: "Observed player",
  rating: 82,
  isTradeable: false,
  isDuplicate: false,
  isMovable: true,
  isStorable: false,
  cardType: "base",
  ...overrides,
});

const createRuntime = (adapter = new FakeEaAdapter({ iterations: 1 })) => ({
  adapter,
  runtime: new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  }),
});

const seedRoute = (adapter) => {
  adapter.club.push(item("owned-copy", "duplicate-version"));
  adapter.unassigned = [
    item("unique", "unique-version"),
    item("storage-copy", "duplicate-version", {
      isDuplicate: true,
      isMovable: false,
      isStorable: true,
    }),
    item("held-copy", "held-version", {
      isDuplicate: true,
      isTradeable: true,
      isMovable: false,
      isStorable: false,
    }),
  ];
};

test("Clear duplicates preview is read-only, exact, and hides execution identifiers", async () => {
  const { adapter, runtime } = createRuntime();
  seedRoute(adapter);
  await runtime.initialize();
  const before = structuredClone(adapter.unassigned);

  const plan = await runtime.previewDuplicateRoute();

  assert.equal(plan.state, "ready");
  assert.equal(plan.preview.safeCount, 2);
  assert.equal(plan.preview.toClubCount, 1);
  assert.equal(plan.preview.toStorageCount, 1);
  assert.equal(plan.preview.attentionCount, 1);
  assert.deepEqual(adapter.unassigned, before);
  assert.equal(adapter.calls.resolve, 0);
  assert.equal(adapter.calls.organize, 0);
  const view = runtime.getProductShellViewModel().duplicateRoute;
  assert.equal(view.canApprove, true);
  assert.equal(view.cards.length, 3);
  assert.equal(JSON.stringify(view).includes("storage-copy"), false);
  assert.equal(JSON.stringify(view).includes("actionSetFingerprint"), false);
});

test("approved Clear duplicates executes one exact resolve step and never Organizer", async () => {
  const { adapter, runtime } = createRuntime();
  seedRoute(adapter);
  await runtime.initialize();
  const plan = await runtime.previewDuplicateRoute();

  const result = await runtime.approveDuplicateRoute(plan.id);
  assert.equal(result.started, true);
  const run = await waitFor(
    () => runtime.engine.getSnapshot()?.status === "completed" && runtime.engine.getSnapshot(),
    "Approved safe route did not complete",
  );

  assert.equal(run.nodes.length, 1);
  assert.equal(run.nodes[0].step.type, "RESOLVE_ITEMS");
  assert.equal(adapter.calls.resolve, 1);
  assert.equal(adapter.calls.organize, 0);
  assert.equal(adapter.calls.submit, 0);
  assert.deepEqual(adapter.unassigned.map((entry) => entry.itemId), ["held-copy"]);
  assert.equal(adapter.club.some((entry) => entry.itemId === "unique"), true);
  assert.equal(adapter.storage.some((entry) => entry.itemId === "storage-copy"), true);
});

test("approval rejects a stale Unassigned set before starting a workflow", async () => {
  const { adapter, runtime } = createRuntime();
  seedRoute(adapter);
  await runtime.initialize();
  const plan = await runtime.previewDuplicateRoute();
  adapter.unassigned.push(item("late-item", "late-version"));

  const result = await runtime.approveDuplicateRoute(plan.id);

  assert.equal(result.started, false);
  assert.equal(result.stale, true);
  assert.equal(adapter.calls.resolve, 0);
  assert.equal(runtime.getProductShellViewModel().duplicateRoute.status, "expired");
});

test("missing per-item move evidence blocks approval without mutation", async () => {
  const { adapter, runtime } = createRuntime();
  adapter.unassigned = [{
    id: "legacy-item",
    itemId: "legacy-item",
    resourceId: "legacy-version",
    rating: 81,
    isTradeable: false,
    isDuplicate: false,
    isMovable: null,
    isStorable: null,
  }];
  await runtime.initialize();

  const plan = await runtime.previewDuplicateRoute();

  assert.equal(plan.state, "blocked");
  assert.equal(plan.blockers.some((blocker) =>
    blocker.code === "ROUTING_CAPABILITY_EVIDENCE_MISSING"), true);
  assert.equal(adapter.calls.resolve, 0);
  assert.equal(runtime.getProductShellViewModel().duplicateRoute.canApprove, false);
});

test("move capability degradation blocks the route preview", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  seedRoute(adapter);
  const health = adapter.getCapabilityHealth.bind(adapter);
  adapter.getCapabilityHealth = async () => (await health()).map((entry) =>
    entry.id === "resolve" ? { ...entry, status: "UNAVAILABLE" } : entry);
  const { runtime } = createRuntime(adapter);
  await runtime.initialize();

  const plan = await runtime.previewDuplicateRoute();

  assert.equal(plan.state, "blocked");
  assert.equal(plan.blockers.some((blocker) =>
    blocker.code === "CAPABILITY_UNAVAILABLE"), true);
  assert.equal(adapter.calls.resolve, 0);
});

test("an execution-boundary race pauses before the adapter moves an item", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1 });
  seedRoute(adapter);
  const read = adapter.readInventory.bind(adapter);
  let reads = 0;
  adapter.readInventory = async () => {
    reads += 1;
    if (reads === 4) adapter.unassigned.push(item("raced-item", "raced-version"));
    return read();
  };
  const { runtime } = createRuntime(adapter);
  await runtime.initialize();
  const plan = await runtime.previewDuplicateRoute();
  await runtime.approveDuplicateRoute(plan.id);

  const run = await waitFor(
    () => runtime.engine.getSnapshot()?.status === "paused" && runtime.engine.getSnapshot(),
    "Execution-boundary change did not pause the workflow",
  );

  assert.equal(run.lastError.code, "DUPLICATE_PLAN_STALE");
  assert.equal(adapter.calls.resolve, 0);
  assert.equal(adapter.calls.organize, 0);
});

test("concurrent approval messages can start at most one route workflow", async () => {
  const { adapter, runtime } = createRuntime();
  seedRoute(adapter);
  await runtime.initialize();
  const plan = await runtime.previewDuplicateRoute();

  const results = await Promise.allSettled([
    runtime.approveDuplicateRoute(plan.id),
    runtime.approveDuplicateRoute(plan.id),
  ]);
  const started = results.filter((result) =>
    result.status === "fulfilled" && result.value.started === true);
  const blocked = results.filter((result) =>
    result.status === "rejected" &&
    result.reason?.code === "DUPLICATE_APPROVAL_IN_FLIGHT");

  assert.equal(started.length, 1);
  assert.equal(blocked.length, 1);
  await waitFor(
    () => runtime.engine.getSnapshot()?.status === "completed",
    "The single approved route did not complete",
  );
  assert.equal(adapter.calls.resolve, 1);
});

test("route recovery verifies the exact residual set before declaring completion", async () => {
  const { adapter, runtime } = createRuntime();
  adapter.club.push(item("moved", "moved-version"));
  adapter.unassigned = [item("held", "held-version")];
  const recover = runtime.createHandlers().RESOLVE_ITEMS.recover;
  const intent = {
    expectedActions: [{
      itemId: "moved",
      type: "SEND_TO_CLUB",
      from: "unassigned",
      to: "club",
      reason: "not_duplicate",
    }],
    expectedUnassignedItemIdsBefore: ["held", "moved"],
    expectedRemainingItemIdsAfter: ["held"],
  };

  const completed = await recover({ node: { intent } });
  assert.equal(completed.status, "completed");

  adapter.unassigned.push(item("unexpected", "unexpected-version"));
  const ambiguous = await recover({ node: { intent } });
  assert.equal(ambiguous.status, "ambiguous");
});
