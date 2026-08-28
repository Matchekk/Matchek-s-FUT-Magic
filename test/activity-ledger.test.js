import test from "node:test";
import assert from "node:assert/strict";

import {
  ActivityGuardState,
  ActivityLedger,
  ActivityOutcome,
  ActivityWindow,
  OperationScheduler,
  SchedulerDecision,
  evaluateActivityGuard,
} from "../src/activity/index.js";

const contextA = { personaKey: "persona:a", gameVersion: "fc26", sessionId: "session:a" };
const event = (eventId, timestamp, extra = {}) => ({
  eventId,
  timestamp,
  ...contextA,
  operationFamily: "SUBMIT_SBC",
  outcome: ActivityOutcome.VERIFIED,
  failureClass: null,
  ...extra,
});

test("activity windows separate persona, game and session at exact boundaries", () => {
  let now = ActivityWindow.ONE_DAY + 10_000;
  const ledger = new ActivityLedger({ clock: () => now });
  ledger.append(event("inside", now - ActivityWindow.ONE_MINUTE + 1));
  ledger.append(event("boundary", now - ActivityWindow.ONE_MINUTE));
  ledger.append(event("other-persona", now - 1, { personaKey: "persona:b" }));
  ledger.append(event("other-game", now - 1, { gameVersion: "fc27" }));
  ledger.append(event("other-session", now - 1, { sessionId: "session:b" }));

  const minute = ledger.query({ ...contextA, windowMs: ActivityWindow.ONE_MINUTE, now });
  assert.deepEqual(minute.events.map(({ eventId }) => eventId), ["inside"]);
  assert.equal(minute.total, 1);
  assert.equal(minute.complete, true);
});

test("snapshot restore preserves timestamps and pruning makes affected windows incomplete", () => {
  let now = 100_000;
  const ledger = new ActivityLedger({ maxEvents: 2, clock: () => now });
  ledger.append(event("one", 1));
  ledger.append(event("two", 2));
  ledger.append(event("three", 3));
  const restored = new ActivityLedger({ maxEvents: 2, clock: () => now, snapshot: ledger.snapshot() });
  assert.deepEqual(restored.snapshot().events.map(({ timestamp }) => timestamp), [2, 3]);
  assert.equal(restored.query({ ...contextA, windowMs: ActivityWindow.ONE_DAY, now }).complete, false);
});

test("consecutive failures reset only on verified same-family success", () => {
  let now = 100;
  const ledger = new ActivityLedger({ clock: () => now });
  for (const [id, outcome, family = "SUBMIT_SBC"] of [
    ["fail-1", ActivityOutcome.TRANSIENT_FAILURE],
    ["read-ok", ActivityOutcome.VERIFIED, "RECOVERY_READ"],
    ["fail-2", ActivityOutcome.TERMINAL_FAILURE],
  ]) {
    ledger.append(event(id, now++, { outcome, operationFamily: family, failureClass: outcome === ActivityOutcome.VERIFIED ? null : "EA_HEALTH" }));
  }
  assert.equal(ledger.consecutiveFailures({ ...contextA, operationFamily: "SUBMIT_SBC" }), 2);
  ledger.append(event("submit-ok", now++, { outcome: ActivityOutcome.VERIFIED }));
  assert.equal(ledger.consecutiveFailures({ ...contextA, operationFamily: "SUBMIT_SBC" }), 0);
});

test("public summary omits persona and event identifiers", () => {
  const ledger = new ActivityLedger({ clock: () => 10_000 });
  ledger.append(event("private-event", 9_000));
  const summary = ledger.publicSummary({ ...contextA, now: 10_000 });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /persona:a|private-event|session:a/);
  assert.equal(summary.windows.ONE_MINUTE, 1);
});

test("Activity Guard uses qualitative health states without safe quotas", () => {
  let now = 10_000;
  const ledger = new ActivityLedger({ clock: () => now });
  assert.equal(evaluateActivityGuard({ ledger, activityContext: contextA, now }).state, ActivityGuardState.NORMAL);
  ledger.append(event("verified", now));
  assert.equal(evaluateActivityGuard({ ledger, activityContext: contextA, now }).state, ActivityGuardState.ELEVATED);
  now += 1;
  ledger.append(event("failure", now, { outcome: ActivityOutcome.TRANSIENT_FAILURE, failureClass: "EA_HEALTH" }));
  assert.equal(evaluateActivityGuard({ ledger, activityContext: contextA, now }).state, ActivityGuardState.CAUTION);
  assert.equal(evaluateActivityGuard({ ledger, activityContext: contextA, now, circuitOpen: true }).state, ActivityGuardState.PAUSED);
  assert.equal(evaluateActivityGuard({ ledger, activityContext: contextA, now, recoveryRequired: true }).state, ActivityGuardState.RECOVERY);
});

test("operation scheduler opens a per-family failure circuit", async () => {
  let now = 1000;
  let id = 0;
  const ledger = new ActivityLedger({ clock: () => now });
  const scheduler = new OperationScheduler({
    ledger,
    activityContextProvider: () => contextA,
    clock: () => now,
    idFactory: () => `event-${++id}`,
    failureThreshold: 3,
  });
  const node = { step: { type: "SUBMIT_SBC" } };
  assert.equal((await scheduler.preflight({ node, run: { status: "running" } })).decision, SchedulerDecision.ALLOW);
  for (let index = 0; index < 3; index += 1) {
    await scheduler.recordFailure({ node, error: { code: "EA_DOWN", safeToRetry: true } });
    now += 1;
  }
  assert.equal((await scheduler.preflight({ node, run: { status: "running" } })).decision, SchedulerDecision.PAUSE);
  const other = { step: { type: "OPEN_REWARD_PACK" } };
  assert.notEqual((await scheduler.preflight({ node: other, run: { status: "running" } })).code, "FAILURE_STREAK");
  await scheduler.recordSuccess({ node });
  assert.notEqual((await scheduler.preflight({ node, run: { status: "running" } })).code, "FAILURE_STREAK");
});

test("elevated activity enforces the configured qualitative spacing", async () => {
  let now = 5_000;
  const ledger = new ActivityLedger({ clock: () => now });
  const scheduler = new OperationScheduler({
    ledger,
    activityContextProvider: () => contextA,
    clock: () => now,
    idFactory: () => "spacing-event",
    minimumSpacingMs: 1_500,
  });
  const node = { step: { type: "SUBMIT_SBC" } };
  await scheduler.recordSuccess({ node });
  const waiting = await scheduler.preflight({ node, run: { status: "running" } });
  assert.equal(waiting.decision, SchedulerDecision.WAIT_UNTIL);
  assert.equal(waiting.waitUntil, 6_500);
  now = 6_500;
  assert.equal((await scheduler.preflight({ node, run: { status: "running" } })).decision, SchedulerDecision.ALLOW);
});

test("scheduler persists the closed ledger snapshot after every outcome", async () => {
  const ledger = new ActivityLedger({ clock: () => 10_000 });
  const snapshots = [];
  const scheduler = new OperationScheduler({
    ledger,
    activityContextProvider: () => contextA,
    clock: () => 10_000,
    idFactory: () => "persisted-event",
    persistSnapshot: async (snapshot) => snapshots.push(snapshot),
  });
  await scheduler.recordSuccess({ node: { step: { type: "SUBMIT_SBC" } } });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].events[0].outcome, ActivityOutcome.VERIFIED);
});
