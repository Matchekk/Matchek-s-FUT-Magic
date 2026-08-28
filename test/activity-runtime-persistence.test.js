import test from "node:test";
import assert from "node:assert/strict";

import { ActivityGuardState } from "../src/activity/index.js";
import { GrindPilotRuntime } from "../src/grindpilot-main.js";
import { InMemoryProfileRepository } from "../src/profiles/profile-repository.js";
import { MemoryWorkflowRepository } from "../src/workflow/repository.js";
import { FakeEaAdapter, FakeGrindStorage } from "./support/fake-ea-adapter.js";

const sessionStore = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const createRuntime = ({ storage, activitySessionStorage }) => new GrindPilotRuntime({
  storage,
  adapter: new FakeEaAdapter({ iterations: 1 }),
  workflowRepository: new MemoryWorkflowRepository(),
  profileRepository: new InMemoryProfileRepository(),
  activitySessionStorage,
  enableUi: false,
  root: {},
  origin: "https://fake.invalid",
});

test("activity density and failure circuit survive a runtime reload in one opaque partition", async () => {
  const storage = new FakeGrindStorage();
  const activitySessionStorage = sessionStore();
  const first = createRuntime({ storage, activitySessionStorage });
  await first.initialize();
  const node = { step: { type: "SUBMIT_SBC" } };
  await first.operationScheduler.recordSuccess({ node });

  const second = createRuntime({ storage, activitySessionStorage });
  await second.initialize();
  assert.equal(second.activitySessionId, first.activitySessionId);
  assert.equal(second.operationScheduler.currentGuard({ stepType: "SUBMIT_SBC" }).state, ActivityGuardState.ELEVATED);
  for (let index = 0; index < 3; index += 1) {
    await second.operationScheduler.recordFailure({ node, error: { code: "EA_DOWN", safeToRetry: true } });
  }

  const third = createRuntime({ storage, activitySessionStorage });
  await third.initialize();
  assert.equal(third.operationScheduler.currentGuard({ stepType: "SUBMIT_SBC" }).state, ActivityGuardState.PAUSED);
});

test("a different opaque partition never inherits another session's activity", async () => {
  const storage = new FakeGrindStorage();
  const first = createRuntime({ storage, activitySessionStorage: sessionStore() });
  await first.initialize();
  await first.operationScheduler.recordSuccess({ node: { step: { type: "SUBMIT_SBC" } } });

  const separate = createRuntime({ storage, activitySessionStorage: sessionStore() });
  await separate.initialize();
  assert.notEqual(separate.activitySessionId, first.activitySessionId);
  assert.equal(separate.operationScheduler.currentGuard({ stepType: "SUBMIT_SBC" }).state, ActivityGuardState.NORMAL);
});

test("corrupt persisted activity evidence fails closed", async () => {
  const storage = new FakeGrindStorage();
  const activitySessionStorage = sessionStore();
  const seed = createRuntime({ storage, activitySessionStorage });
  storage.activityLedgers[seed.activitySessionId] = { schemaVersion: 1, events: [{ invalid: true }] };

  const runtime = createRuntime({ storage, activitySessionStorage });
  await runtime.initialize();
  const preflight = await runtime.operationScheduler.preflight({
    node: { step: { type: "SUBMIT_SBC" } },
    run: { status: "running" },
  });
  assert.equal(preflight.decision, "PAUSE");
  assert.equal(preflight.code, "ACTIVITY_EVIDENCE_UNAVAILABLE");
});
