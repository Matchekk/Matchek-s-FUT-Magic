import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkflowEngine,
  MemoryWorkflowRepository,
  WorkflowMode,
  WorkflowStepType,
  createAutoApproval,
} from "../src/workflow/index.js";

const definition = {
  id: "scheduler-test",
  name: "Scheduler test",
  version: 1,
  steps: [{ id: "submit", type: WorkflowStepType.SUBMIT_SBC }],
};

const repository = () => new MemoryWorkflowRepository();

test("scheduler preflight occurs after persisted intent and before adapter dispatch", async () => {
  const order = [];
  const repo = repository();
  const originalSave = repo.saveRun.bind(repo);
  repo.saveRun = async (run, options) => {
    if (run.nodes[0]?.intent && !order.includes("intent-persisted")) order.push("intent-persisted");
    return originalSave(run, options);
  };
  const engine = new WorkflowEngine({
    repository: repo,
    operationScheduler: {
      async preflight() { order.push("preflight"); return { decision: "ALLOW" }; },
      async recordSuccess() { order.push("record-success"); },
    },
    handlers: {
      [WorkflowStepType.SUBMIT_SBC]: {
        prepare: async () => ({ exact: true }),
        execute: async () => { order.push("dispatch"); return { status: "completed", result: { verified: true } }; },
      },
    },
  });
  await engine.start(definition, { mode: WorkflowMode.AUTO, approval: { ...createAutoApproval(definition), confirmed: true } });
  await engine.runUntilBlocked();
  assert.deepEqual(order, ["intent-persisted", "preflight", "dispatch", "record-success"]);
});

test("scheduler pause produces zero adapter calls and keeps the intent", async () => {
  let calls = 0;
  const engine = new WorkflowEngine({
    repository: repository(),
    operationScheduler: {
      async preflight() { return { decision: "PAUSE", code: "FAILURE_STREAK" }; },
    },
    handlers: {
      [WorkflowStepType.SUBMIT_SBC]: {
        prepare: async () => ({ exact: true }),
        execute: async () => { calls += 1; return { status: "completed" }; },
      },
    },
  });
  await engine.start(definition, { mode: WorkflowMode.AUTO, approval: { ...createAutoApproval(definition), confirmed: true } });
  await engine.runUntilBlocked();
  const run = engine.getSnapshot();
  assert.equal(calls, 0);
  assert.equal(run.status, "paused");
  assert.equal(run.pauseReason.code, "FAILURE_STREAK");
  assert.equal(run.nodes[0].intent.exact, true);
});

test("activity recording failure after verified action never retries it", async () => {
  let calls = 0;
  const twoSteps = {
    ...definition,
    steps: [
      definition.steps[0],
      { id: "second", type: WorkflowStepType.SUBMIT_SBC },
    ],
  };
  const engine = new WorkflowEngine({
    repository: repository(),
    operationScheduler: {
      async preflight() { return { decision: "ALLOW" }; },
      async recordSuccess() { throw new Error("ledger unavailable"); },
    },
    handlers: {
      [WorkflowStepType.SUBMIT_SBC]: async () => { calls += 1; return { status: "completed", result: { verified: true } }; },
    },
  });
  await engine.start(twoSteps, { mode: WorkflowMode.AUTO, approval: { ...createAutoApproval(twoSteps), confirmed: true } });
  await engine.runUntilBlocked();
  const run = engine.getSnapshot();
  assert.equal(calls, 1);
  assert.equal(run.status, "paused");
  assert.equal(run.pauseReason.code, "ACTIVITY_LEDGER_UNAVAILABLE");
  assert.equal(run.nodes[0].status, "completed");
});

test("a dispatched paused outcome records exactly once and ambiguous writes require recovery", async () => {
  const recorded = [];
  const engine = new WorkflowEngine({
    repository: repository(),
    operationScheduler: {
      async preflight() { return { decision: "ALLOW" }; },
      async recordOutcome(event) { recorded.push(event); },
    },
    handlers: {
      [WorkflowStepType.SUBMIT_SBC]: async () => ({
        status: "paused",
        code: "POST_STATE_UNKNOWN",
        message: "Submit response could not be verified",
        activityOutcome: "ambiguous",
      }),
    },
  });
  await engine.start(definition, { mode: WorkflowMode.AUTO, approval: { ...createAutoApproval(definition), confirmed: true } });
  await engine.runUntilBlocked();
  const run = engine.getSnapshot();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, "ambiguous");
  assert.equal(run.status, "recovery_required");
  assert.equal(run.nodes[0].status, "failed");
});

test("a dispatched waiting outcome records a proven not-applied result once", async () => {
  const recorded = [];
  const engine = new WorkflowEngine({
    repository: repository(),
    operationScheduler: {
      async preflight() { return { decision: "ALLOW" }; },
      async recordOutcome(event) { recorded.push(event); },
    },
    handlers: {
      [WorkflowStepType.SUBMIT_SBC]: async () => ({
        status: "waiting",
        resumeAt: Date.now() + 1_000,
        activityOutcome: "not_applied",
      }),
    },
  });
  await engine.start(definition, { mode: WorkflowMode.AUTO, approval: { ...createAutoApproval(definition), confirmed: true } });
  await engine.runUntilBlocked();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, "not_applied");
  assert.equal(engine.getSnapshot().status, "waiting");
});
