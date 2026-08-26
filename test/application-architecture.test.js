import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityRegistry,
  CapabilityState,
  createGameContext,
  createGoal,
  DataProvider,
  EntitlementService,
  Feature,
  GameContextPort,
  GameVersion,
  GoalKind,
  PlanCompiler,
  Planner,
  PlanState,
  ProductPlan,
  SurfaceSlot,
  SurfaceSlotRegistry,
} from "../src/application/index.js";

test("game context normalizes FC26 and keeps FC27 explicitly unverified", () => {
  const fc26 = createGameContext({ gameVersion: "EA FC 26", challengeId: 42, observedAt: 10 });
  const fc27 = createGameContext({ gameVersion: "27", observedAt: 11 });
  assert.equal(fc26.gameVersion, GameVersion.FC26);
  assert.equal(fc26.challengeId, "42");
  assert.equal(fc26.state, "verified");
  assert.equal(fc27.gameVersion, GameVersion.FC27);
  assert.equal(fc27.state, "unverified");
  assert.equal(createGameContext({ gameVersion: "unknown" }).state, "unverified");
  assert.equal(Object.isFrozen(fc27), true);
});

test("capability registry fails unknown capabilities closed and preserves evidence", () => {
  const registry = new CapabilityRegistry();
  registry.declare("ea.inventory.read", { state: CapabilityState.AVAILABLE, evidence: { source: "controller" }, observedAt: 10 });
  const check = registry.require(["ea.inventory.read", "ea.sbc.submit"]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ["ea.sbc.submit"]);
  assert.equal(check.records[0].evidence.source, "controller");
  assert.equal(Object.isFrozen(check.records), true);
});

test("data providers require declared capabilities and return immutable evidence envelopes", async () => {
  const registry = new CapabilityRegistry();
  registry.declare("ea.inventory.read", { state: CapabilityState.AVAILABLE });
  const provider = new DataProvider({
    id: "ea-local",
    capabilityRegistry: registry,
    capabilityByOperation: { inventory: "ea.inventory.read" },
    operations: { inventory: async (input) => ({ value: { club: input.club }, evidence: { kind: "snapshot" }, observedAt: 12 }) },
  });
  const result = await provider.read("inventory", { club: 7 });
  assert.deepEqual(result.value, { club: 7 });
  assert.equal(result.evidence.kind, "snapshot");
  assert.equal(Object.isFrozen(result.value), true);
});

test("planner compiles deterministic preview plans for existing runtime services", async () => {
  const capabilities = new CapabilityRegistry();
  capabilities.declare("ea.sbc.context", { state: CapabilityState.AVAILABLE });
  const entitlements = new EntitlementService({ plan: ProductPlan.FREE });
  const compiler = new PlanCompiler({
    capabilityRegistry: capabilities,
    entitlementService: entitlements,
    strategies: {
      [GoalKind.COMPLETE_SBC]: ({ goal }) => ({
        requiredCapabilities: ["ea.sbc.context"],
        steps: [{ type: "CALL_EXISTING_SERVICE", service: "workflow", command: "OPEN_SBC_SOLVER", projectId: goal.inputs.projectId }],
        explanation: ["Use the existing verified solver path"],
      }),
    },
  });
  class FixedContext extends GameContextPort { async read() { return createGameContext({ gameVersion: GameVersion.FC26, challengeId: "c1", observedAt: 10 }); } }
  const planner = new Planner({ compiler, gameContextPort: new FixedContext() });
  const goal = createGoal({ kind: GoalKind.COMPLETE_SBC, intent: "Continue Marcelo", inputs: { projectId: "p1" }, createdAt: 1 });
  const first = await planner.plan(goal);
  const second = await planner.plan(goal);
  assert.equal(first.state, PlanState.READY);
  assert.equal(first.id, second.id);
  assert.equal(first.steps[0].service, "workflow");
  assert.equal(Object.isFrozen(first.steps), true);
});

test("compiler exposes entitlement, capability and future-version blockers without fake plans", async () => {
  const capabilities = new CapabilityRegistry();
  const free = new EntitlementService({ plan: ProductPlan.FREE });
  const compiler = new PlanCompiler({
    capabilityRegistry: capabilities,
    entitlementService: free,
    strategies: {
      [GoalKind.PLAN_EVOLUTION]: () => ({ requiredCapabilities: ["ea.evolution.read"], steps: [{ type: "UNREACHABLE" }] }),
      [GoalKind.COMPLETE_SBC]: () => ({ requiredCapabilities: ["ea.sbc.submit"], steps: [{ type: "UNREACHABLE" }] }),
    },
  });
  const evolution = await compiler.compile(createGoal({ kind: GoalKind.PLAN_EVOLUTION }), createGameContext({ gameVersion: GameVersion.FC26 }));
  const fc27 = await compiler.compile(createGoal({ kind: GoalKind.COMPLETE_SBC }), createGameContext({ gameVersion: GameVersion.FC27 }));
  assert.equal(evolution.state, PlanState.BLOCKED);
  assert.equal(evolution.blockers[0].code, "ENTITLEMENT_REQUIRED");
  assert.deepEqual(evolution.steps, []);
  assert.equal(fc27.blockers.some((blocker) => blocker.code === "GAME_CONTEXT_UNVERIFIED"), true);
  assert.deepEqual(fc27.steps, []);
  assert.equal(free.check(Feature.SBC_PROJECTS).entitled, true);
});

test("compiler capability preflight does not invoke a strategy when evidence is missing", async () => {
  const capabilities = new CapabilityRegistry();
  let calls = 0;
  const strategy = async () => {
    calls += 1;
    return { steps: [{ type: "UNREACHABLE" }] };
  };
  strategy.requiredCapabilities = ["ea.sbc.solve.preview"];
  const compiler = new PlanCompiler({
    capabilityRegistry: capabilities,
    entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
    strategies: { [GoalKind.COMPLETE_SBC]: strategy },
  });
  const plan = await compiler.compile(
    createGoal({ kind: GoalKind.COMPLETE_SBC }),
    createGameContext({ gameVersion: GameVersion.FC26 }),
  );
  assert.equal(plan.state, PlanState.BLOCKED);
  assert.equal(plan.blockers[0].code, "CAPABILITY_UNAVAILABLE");
  assert.equal(calls, 0);
});

test("surface slots order contributions and reject exclusive collisions", () => {
  const registry = new SurfaceSlotRegistry();
  registry.register(SurfaceSlot.ITEMS_HEADER, { id: "open-panel", label: "Open FUT Magic", priority: 10, exclusive: true });
  registry.register(SurfaceSlot.ITEMS_HEADER, { id: "route-items", label: "Route & recycle", priority: 20 });
  assert.deepEqual(registry.list(SurfaceSlot.ITEMS_HEADER).map((entry) => entry.id), ["route-items", "open-panel"]);
  assert.throws(() => registry.register(SurfaceSlot.ITEMS_HEADER, { id: "replacement", exclusive: true }), /collision/i);
});
