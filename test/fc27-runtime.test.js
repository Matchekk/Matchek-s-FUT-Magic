import assert from "node:assert/strict";
import test from "node:test";

import { GameVersion } from "../src/application/index.js";
import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import {
  createAutoApproval,
  RunStatus,
  WorkflowMode,
  WorkflowStepType,
} from "../src/workflow/index.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

const createRuntime = async (adapter) => {
  const runtime = new GrindPilotRuntime({
    storage: new FakeGrindStorage(),
    adapter,
    workflowRepository: new MemoryWorkflowRepository(),
    profileRepository: new InMemoryProfileRepository(),
    enableUi: false,
    enableActivityPersistence: false,
    root: {},
    origin: "https://fake.invalid",
  });
  await runtime.initialize();
  return runtime;
};

const assertNoDestructiveAdapterCalls = (adapter) => {
  assert.equal(adapter.calls.submit, 0);
  assert.equal(adapter.calls.claim, 0);
  assert.equal(adapter.calls.open, 0);
  assert.equal(adapter.calls.pick, 0);
  assert.equal(adapter.calls.resolve, 0);
  assert.equal(adapter.calls.organize, 0);
};

const destructiveWorkflow = () => ({
  id: "fc27-mutation-probe",
  name: "Version and mode mutation probe",
  version: 1,
  steps: [{
    id: "must-not-resolve",
    type: WorkflowStepType.RESOLVE_ITEMS,
    config: { allowPartial: true, allowUnresolved: true },
    timeoutMs: 1_000,
    retryPolicy: { maxAttempts: 1 },
    onFailure: "PAUSE",
  }],
});

test("runtime propagates explicitly observed FC27 without relabeling it as verified FC26", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1, gameVersion: "fc27" });
  const runtime = await createRuntime(adapter);

  const observed = runtime.getState().currentContext;
  const planningContext = runtime.currentGameContext();

  assert.equal(observed.gameVersion, GameVersion.FC27);
  assert.equal(observed.gameVersionObservation, "observed");
  assert.equal(planningContext.gameVersion, GameVersion.FC27);
  assert.equal(planningContext.state, "unverified");
  assertNoDestructiveAdapterCalls(adapter);
});

test("switching from FC26 to FC27 invalidates cached version-specific plans", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1, gameVersion: "fc26" });
  const runtime = await createRuntime(adapter);
  const project = await runtime.importCurrentSbcProject();
  const plan = await runtime.previewSbcProject(project.id);

  assert.equal(plan.state, "ready");
  assert.equal(runtime.sbcPlanCache.has(String(project.id)), true);

  adapter.gameVersion = "fc27";
  await runtime.refreshStatus();

  assert.equal(runtime.currentGameContext().gameVersion, GameVersion.FC27);
  assert.equal(runtime.currentGameContext().state, "unverified");
  assert.equal(runtime.sbcPlanCache.has(String(project.id)), false);
  assert.equal(runtime.getState().sbcPlanPreviews[String(project.id)], undefined);
  assertNoDestructiveAdapterCalls(adapter);
});

test("REVIEW mode gates a destructive workflow step before any adapter mutation", async () => {
  // Use the supported version so this test isolates the workflow-mode gate;
  // FC27 has an earlier independent runtime gate covered above.
  const adapter = new FakeEaAdapter({ iterations: 1, gameVersion: "fc26" });
  const runtime = await createRuntime(adapter);
  const workflow = destructiveWorkflow();

  await runtime.start({
    mode: WorkflowMode.REVIEW,
    maxIterations: 1,
    workflow,
  });

  const run = runtime.engine.getSnapshot();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "REVIEW_MODE_DESTRUCTIVE_STEP");
  assertNoDestructiveAdapterCalls(adapter);
});

test("FC27 gates an otherwise approved AUTO mutation before its handler runs", async () => {
  const adapter = new FakeEaAdapter({ iterations: 1, gameVersion: "fc27" });
  const runtime = await createRuntime(adapter);
  const workflow = destructiveWorkflow();

  await runtime.engine.start(workflow, {
    mode: WorkflowMode.AUTO,
    approval: createAutoApproval(workflow),
  });
  await runtime.drive();

  const run = runtime.engine.getSnapshot();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "GAME_VERSION_UNSUPPORTED");
  assertNoDestructiveAdapterCalls(adapter);
});
