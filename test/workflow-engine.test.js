import test from "node:test";
import assert from "node:assert/strict";

import {
  MemoryWorkflowRepository,
  RunStatus,
  WorkflowEngine,
  WorkflowError,
  WorkflowMode,
  WorkflowStepType,
  createAutoApproval,
} from "../src/workflow/index.js";

const definition = (steps, overrides = {}) => ({
  id: overrides.id ?? "workflow-test",
  name: overrides.name ?? "Workflow Test",
  version: overrides.version ?? 1,
  steps,
});

const step = (id, type, config = {}, overrides = {}) => ({
  id,
  type,
  config,
  ...overrides,
});

const makeIds = () => {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
};

test("persists intents and every explicit handler transition", async () => {
  const repository = new MemoryWorkflowRepository();
  const calls = [];
  const engine = new WorkflowEngine({
    repository,
    idFactory: makeIds(),
    handlers: {
      SOLVE_SBC: {
        prepare: ({ step: current }) => ({ challengeId: current.config.challengeId }),
        execute: ({ intent, attempt }) => {
          calls.push({ intent, attempt });
          return { status: "completed", result: { solutionItemIds: [11, 22] } };
        },
      },
    },
  });

  await engine.start(
    definition([step("solve", "SOLVE_SBC", { challengeId: 42 })]),
  );
  const completed = await engine.runUntilBlocked();
  assert.equal(completed.status, RunStatus.COMPLETED);
  assert.equal(completed.nodes[0].status, "completed");
  assert.deepEqual(completed.nodes[0].result, { solutionItemIds: [11, 22] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].intent.challengeId, 42);
  assert.ok(completed.revision >= 4);
  assert.deepEqual(await repository.loadRun(completed.runId), completed);
  assert.ok(completed.history.some((entry) => entry.type === "STEP_INTENT_PREPARED"));
});

test("materializes conditional branches and bounded loop iterations", async () => {
  const calls = [];
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    contextProvider: () => ({ metrics: { enabled: true } }),
    handlers: {
      SOLVE_SBC: ({ step: current }) => {
        calls.push(current.id);
        return { result: { id: current.id } };
      },
    },
  });
  const enabledCondition = {
    type: "COMPARE",
    left: { type: "PATH", path: "metrics.enabled" },
    operator: "EQ",
    right: { type: "LITERAL", value: true },
  };
  await engine.start(
    definition([
      step("branch", "CONDITIONAL", {
        condition: enabledCondition,
        thenSteps: [step("branch-solve", "SOLVE_SBC")],
        elseSteps: [step("branch-skip", "DELAY", { durationMs: 0 })],
      }),
      step("repeat", "LOOP", {
        maxIterations: 3,
        body: [step("loop-solve", "SOLVE_SBC")],
      }),
    ]),
  );
  const completed = await engine.runUntilBlocked();
  assert.equal(completed.status, RunStatus.COMPLETED);
  assert.deepEqual(calls, ["branch-solve", "loop-solve", "loop-solve", "loop-solve"]);
  assert.equal(completed.counters.loopIterations, 3);
});

test("schedules bounded retries and stops after a successful later attempt", async () => {
  let now = 1_000;
  let calls = 0;
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    now: () => now,
    handlers: {
      SOLVE_SBC: () => {
        calls += 1;
        if (calls < 3) {
          const error = new WorkflowError("Temporary", { code: "TEMP" });
          error.safeToRetry = true;
          throw error;
        }
        return { result: { solved: true } };
      },
    },
  });
  await engine.start(
    definition([
      step("solve", "SOLVE_SBC", {}, {
        retryPolicy: {
          maxAttempts: 3,
          delayMs: 10,
          backoffFactor: 2,
          maxDelayMs: 100,
          retryableCodes: ["TEMP"],
        },
        onFailure: "STOP",
      }),
    ]),
  );

  let run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.WAITING);
  assert.equal(run.nodes[0].attempt, 1);
  now = run.nodes[0].waitUntil;
  await engine.tick();
  run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.WAITING);
  assert.equal(run.nodes[0].attempt, 2);
  now = run.nodes[0].waitUntil;
  await engine.tick();
  run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.COMPLETED);
  assert.equal(calls, 3);
});

test("enforces REVIEW, ASSISTED and hash-bound AUTO gates", async () => {
  const workflow = definition([step("submit", "SUBMIT_SBC")]);

  let reviewCalls = 0;
  const review = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    handlers: { SUBMIT_SBC: () => { reviewCalls += 1; } },
  });
  await review.start(workflow, { mode: WorkflowMode.REVIEW });
  let run = await review.runUntilBlocked();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "REVIEW_MODE_DESTRUCTIVE_STEP");
  assert.equal(reviewCalls, 0);

  let assistedCalls = 0;
  const assisted = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    handlers: { SUBMIT_SBC: () => { assistedCalls += 1; return { result: { ok: true } }; } },
  });
  await assisted.start(workflow, { mode: WorkflowMode.ASSISTED });
  run = await assisted.runUntilBlocked();
  assert.equal(run.pauseReason.code, "ASSISTED_APPROVAL_REQUIRED");
  await assisted.resume({ approveCurrent: true });
  run = await assisted.runUntilBlocked();
  assert.equal(run.status, RunStatus.COMPLETED);
  assert.equal(assistedCalls, 1);

  const auto = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    handlers: { SUBMIT_SBC: () => ({ result: { ok: true } }) },
  });
  await assert.rejects(
    auto.start(workflow, { mode: WorkflowMode.AUTO }),
    (error) => error?.code === "AUTO_APPROVAL_REQUIRED",
  );
  await auto.start(workflow, {
    mode: WorkflowMode.AUTO,
    approval: createAutoApproval(workflow),
  });
  run = await auto.runUntilBlocked();
  assert.equal(run.status, RunStatus.COMPLETED);
});

test("supports explicit pause steps, resume and safe stop", async () => {
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    handlers: { SOLVE_SBC: () => ({ result: { solved: true } }) },
  });
  await engine.start(
    definition([
      step("human", "PAUSE", { reason: "Check the squad." }),
      step("solve", "SOLVE_SBC"),
    ]),
  );
  let run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "PAUSE_STEP_REACHED");
  await engine.resume();
  run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.COMPLETED);

  const stoppedEngine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
  });
  await stoppedEngine.start(
    definition([step("wait", "DELAY", { durationMs: 60_000 })], { id: "stop-test" }),
  );
  run = await stoppedEngine.runUntilBlocked();
  assert.equal(run.status, RunStatus.WAITING);
  run = await stoppedEngine.stop();
  assert.equal(run.status, RunStatus.STOPPED);
});

test("recovers safe work and requires reconciliation for destructive in-flight work", async () => {
  const safeRepository = new MemoryWorkflowRepository();
  const safeEngine = new WorkflowEngine({
    repository: safeRepository,
    idFactory: makeIds(),
    handlers: { SOLVE_SBC: () => ({ result: {} }) },
  });
  let run = await safeEngine.start(definition([step("solve", "SOLVE_SBC")]));
  run.nodes[0].status = "running";
  run.nodes[0].attempt = 1;
  run.revision += 1;
  await safeRepository.saveRun(run, { expectedRevision: run.revision - 1 });
  const safeRecovery = new WorkflowEngine({
    repository: safeRepository,
    idFactory: makeIds(),
    handlers: { SOLVE_SBC: () => ({ result: {} }) },
  });
  run = await safeRecovery.recover();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "RECOVERED_SAFE_RETRY");

  const destructiveRepository = new MemoryWorkflowRepository();
  const destructiveEngine = new WorkflowEngine({
    repository: destructiveRepository,
    idFactory: makeIds(),
  });
  const destructiveWorkflow = definition(
    [step("submit", "SUBMIT_SBC")],
    { id: "recover-submit" },
  );
  run = await destructiveEngine.start(destructiveWorkflow, {
    mode: WorkflowMode.AUTO,
    approval: createAutoApproval(destructiveWorkflow),
  });
  run.nodes[0].status = "running";
  run.nodes[0].attempt = 1;
  run.revision += 1;
  await destructiveRepository.saveRun(run, { expectedRevision: run.revision - 1 });
  const destructiveRecovery = new WorkflowEngine({
    repository: destructiveRepository,
    idFactory: makeIds(),
  });
  run = await destructiveRecovery.recover();
  assert.equal(run.status, RunStatus.RECOVERY_REQUIRED);
  assert.equal(run.pauseReason.code, "RECOVERY_HANDLER_REQUIRED");
});

test("uses a destructive handler reconciler to complete an interrupted operation", async () => {
  const repository = new MemoryWorkflowRepository();
  const initial = new WorkflowEngine({
    repository,
    idFactory: makeIds(),
  });
  const workflow = definition(
    [step("submit", "SUBMIT_SBC")],
    { id: "reconciled-submit" },
  );
  let run = await initial.start(workflow, {
    mode: WorkflowMode.AUTO,
    approval: createAutoApproval(workflow),
  });
  run.nodes[0].status = "running";
  run.nodes[0].attempt = 1;
  run.nodes[0].intent = { operationId: "submit-1", challengeId: 42 };
  run.revision += 1;
  await repository.saveRun(run, { expectedRevision: run.revision - 1 });

  const recovered = new WorkflowEngine({
    repository,
    idFactory: makeIds(),
    handlers: {
      SUBMIT_SBC: {
        recover: ({ node }) => {
          assert.equal(node.intent.operationId, "submit-1");
          return { status: "completed", result: { verifiedChallengeId: 42 } };
        },
      },
    },
  });
  run = await recovered.recover();
  assert.equal(run.status, RunStatus.PAUSED);
  assert.equal(run.pauseReason.code, "RECOVERED_STEP_COMPLETED");
  assert.equal(run.cursor, 1);
  assert.deepEqual(run.nodes[0].result, { verifiedChallengeId: 42 });
  await recovered.resume();
  run = await recovered.runUntilBlocked();
  assert.equal(run.status, RunStatus.COMPLETED);
});

test("honors stop requests only after the current handler reaches a safe boundary", async () => {
  let release;
  let handlerStarted;
  const started = new Promise((resolve) => { handlerStarted = resolve; });
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    handlers: {
      SOLVE_SBC: async () => {
        handlerStarted();
        await new Promise((resolve) => { release = resolve; });
        return { result: { solved: true } };
      },
    },
  });
  await engine.start(definition([step("solve", "SOLVE_SBC")], { id: "safe-stop" }));
  const activeTick = engine.tick();
  await started;
  const stopPromise = engine.stop({ reason: "User stop" });
  assert.equal(engine.getSnapshot().nodes[0].status, "running");
  release();
  await activeTick;
  const run = await stopPromise;
  assert.equal(run.nodes[0].status, "completed");
  assert.equal(run.status, RunStatus.STOPPED);
});

test("timeout aborts the handler signal and follows bounded failure policy", async () => {
  let signal = null;
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    idFactory: makeIds(),
    setTimer: (callback) => {
      queueMicrotask(callback);
      return 1;
    },
    clearTimer: () => {},
    handlers: {
      SOLVE_SBC: ({ signal: currentSignal }) => {
        signal = currentSignal;
        return new Promise(() => {});
      },
    },
  });
  await engine.start(
    definition([
      step("timeout", "SOLVE_SBC", {}, {
        timeoutMs: 100,
        onFailure: "STOP",
      }),
    ]),
  );
  const run = await engine.runUntilBlocked();
  assert.equal(run.status, RunStatus.FAILED);
  assert.equal(run.lastError.code, "STEP_TIMEOUT");
  assert.equal(signal.aborted, true);
});
