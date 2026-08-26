import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityRegistry,
  EntitlementService,
  GameStrategyReadiness,
  GameStrategyRegistry,
  GameVersion,
  GoalKind,
  PlanCompiler,
  PlanState,
  ProductPlan,
  createGameContext,
  createGoal,
} from "../src/application/index.js";

const compilerFor = ({ strategies = {}, strategyRegistry = null } = {}) =>
  new PlanCompiler({
    capabilityRegistry: new CapabilityRegistry(),
    entitlementService: new EntitlementService({ plan: ProductPlan.PRO }),
    strategies,
    strategyRegistry,
    compilerVersion: 3,
  });

test("legacy strategies are explicitly FC26-only and carry immutable plan metadata", async () => {
  let calls = 0;
  const compiler = compilerFor({
    strategies: {
      [GoalKind.COMPLETE_SBC]: async () => {
        calls += 1;
        return { steps: [{ type: "LOCAL_EXISTING_INTENT" }] };
      },
    },
  });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.COMPLETE_SBC, createdAt: 0 }),
    createGameContext({ gameVersion: GameVersion.FC26, state: "verified", observedAt: 1 }),
  );

  assert.equal(plan.state, PlanState.READY);
  assert.equal(calls, 1);
  assert.equal(plan.strategy.id, "legacy.fc26.complete_sbc.v1");
  assert.equal(plan.strategy.gameVersion, GameVersion.FC26);
  assert.equal(plan.strategy.readiness, GameStrategyReadiness.VERIFIED);
  assert.equal(Object.isFrozen(plan.strategy), true);
});

test("verified FC27 context cannot invoke an FC26 legacy strategy", async () => {
  let calls = 0;
  const compiler = compilerFor({
    strategies: {
      [GoalKind.COMPLETE_SBC]: async () => {
        calls += 1;
        return { steps: [{ type: "MUST_NOT_EXIST" }] };
      },
    },
  });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.COMPLETE_SBC, createdAt: 0 }),
    createGameContext({ gameVersion: GameVersion.FC27, state: "verified", observedAt: 1 }),
  );

  assert.equal(calls, 0);
  assert.equal(plan.state, PlanState.BLOCKED);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.blockers.some((entry) => entry.code === "GAME_STRATEGY_OBSERVE_ONLY"), true);
  assert.equal(plan.strategy.gameVersion, GameVersion.FC27);
  assert.equal(plan.strategy.readiness, GameStrategyReadiness.OBSERVE_ONLY);
});

test("raw verified FC27 context also fails closed before strategy invocation", async () => {
  let calls = 0;
  const compiler = compilerFor({
    strategies: {
      [GoalKind.CLEAR_DUPLICATES]: () => {
        calls += 1;
        return { steps: [{ type: "MUST_NOT_EXIST" }] };
      },
    },
  });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.CLEAR_DUPLICATES, createdAt: 0 }),
    { gameVersion: "fc27", state: "verified", observedAt: 1 },
  );

  assert.equal(calls, 0);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.state, PlanState.BLOCKED);
});

test("observe-only strategies are immutable metadata and never callable", async () => {
  const registry = new GameStrategyRegistry([{
    id: "fc27.streamlined.observe.v1",
    gameVersion: GameVersion.FC27,
    goalKind: GoalKind.COMPLETE_SBC,
    challengeKind: "streamlined_score",
    readiness: GameStrategyReadiness.OBSERVE_ONLY,
    canCompileSteps: false,
    evidenceRevision: "fc27-observation-v1",
  }]);
  const compiler = compilerFor({ strategyRegistry: registry });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.COMPLETE_SBC, createdAt: 0 }),
    {
      gameVersion: "fc27",
      state: "verified",
      challengeKind: "streamlined_score",
      observedAt: 1,
    },
  );

  assert.equal(plan.state, PlanState.BLOCKED);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.blockers[0].code, "GAME_STRATEGY_OBSERVE_ONLY");
  assert.equal(plan.strategy.id, "fc27.streamlined.observe.v1");
  assert.equal(Object.isFrozen(registry.snapshot()), true);
});

test("FC27 execution cannot be enabled by a registry entry or injected resolver", async () => {
  assert.throws(() => new GameStrategyRegistry([{
    id: "fc27.streamlined.execute.v1",
    gameVersion: GameVersion.FC27,
    goalKind: GoalKind.COMPLETE_SBC,
    readiness: GameStrategyReadiness.VERIFIED,
    strategy: () => ({ steps: [{ type: "MUST_NOT_EXIST" }] }),
  }]), /not enabled for fc27/i);

  let calls = 0;
  const injectedRegistry = {
    resolve: ({ gameVersion, goalKind }) => ({
      id: "injected.fc27.execute.v1",
      gameVersion,
      goalKind,
      challengeKind: null,
      readiness: GameStrategyReadiness.VERIFIED,
      canCompileSteps: true,
      requiredCapabilities: [],
      evidenceRevision: "untrusted",
      strategy: () => {
        calls += 1;
        return { steps: [{ type: "MUST_NOT_EXIST" }] };
      },
    }),
  };
  const compiler = compilerFor({ strategyRegistry: injectedRegistry });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.COMPLETE_SBC, createdAt: 0 }),
    { gameVersion: "fc27", state: "verified", observedAt: 1 },
  );

  assert.equal(calls, 0);
  assert.equal(plan.state, PlanState.BLOCKED);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.blockers[0].code, "GAME_STRATEGY_UNAVAILABLE");
});

test("registry rejects duplicate keys and fails a challenge-kind mismatch closed", () => {
  const entry = {
    id: "fc26.classic.complete.v1",
    gameVersion: GameVersion.FC26,
    goalKind: GoalKind.COMPLETE_SBC,
    challengeKind: "classic_squad",
    strategy: () => ({ steps: [] }),
  };
  assert.throws(() => new GameStrategyRegistry([entry, { ...entry, id: "duplicate" }]), /duplicate/i);

  const registry = new GameStrategyRegistry([entry]);
  const resolution = registry.resolve({
    gameVersion: GameVersion.FC26,
    goalKind: GoalKind.COMPLETE_SBC,
    challengeKind: "streamlined_score",
  });
  assert.equal(resolution.readiness, GameStrategyReadiness.UNAVAILABLE);
  assert.equal(resolution.strategy, null);
  assert.equal(Object.isFrozen(resolution), true);
});
