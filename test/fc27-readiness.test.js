import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityRegistry,
  createGameContext,
  createGoal,
  EntitlementService,
  GameVersion,
  GoalKind,
  PlanCompiler,
  PlanState,
  ProductPlan,
} from "../src/application/index.js";

const createCompiler = (strategy) => new PlanCompiler({
  capabilityRegistry: new CapabilityRegistry(),
  entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
  strategies: { [GoalKind.COMPLETE_SBC]: strategy },
});

const goal = () => createGoal({
  kind: GoalKind.COMPLETE_SBC,
  intent: "Adversarial game-version boundary probe",
  createdAt: 0,
});

test("an outer verified FC27 context cannot invoke an FC26 plan strategy", async () => {
  let strategyCalls = 0;
  const strategy = async () => {
    strategyCalls += 1;
    return { steps: [{ type: "UNSAFE_FC27_EXECUTION" }] };
  };
  const compiler = createCompiler(strategy);

  // Deliberately bypass createGameContext: the compiler is a trust boundary and
  // must not rely on an outer caller having used the safe constructor.
  const plan = await compiler.compile(goal(), {
    gameVersion: GameVersion.FC27,
    state: "verified",
    challengeKind: "streamlined_score",
  });

  assert.equal(strategyCalls, 0);
  assert.equal(plan.state, PlanState.BLOCKED);
  assert.deepEqual(plan.steps, []);
  assert.equal(
    plan.blockers.some((blocker) => blocker.code === "GAME_STRATEGY_OBSERVE_ONLY"),
    true,
  );
  assert.equal(plan.strategy.gameVersion, GameVersion.FC27);
  assert.equal(plan.strategy.readiness, "observe_only");
  assert.equal(plan.strategy.canCompileSteps, false);
  assert.equal(Object.isFrozen(plan.strategy), true);
});

test("unknown and malformed raw versions cannot be upgraded into the FC26 strategy", async (t) => {
  const cases = [
    ["unknown", { gameVersion: GameVersion.UNKNOWN, state: "verified" }],
    ["future token", { gameVersion: "fc28", state: "verified" }],
    ["missing token", { state: "verified" }],
    ["non-string token", { gameVersion: { claimed: "fc26" }, state: "verified" }],
  ];

  for (const [name, rawContext] of cases) {
    await t.test(name, async () => {
      let strategyCalls = 0;
      const compiler = createCompiler(async () => {
        strategyCalls += 1;
        return { steps: [{ type: "UNSAFE_VERSION_FALLBACK" }] };
      });

      let plan = null;
      let rejection = null;
      try {
        plan = await compiler.compile(goal(), rawContext);
      } catch (error) {
        rejection = error;
      }

      assert.equal(strategyCalls, 0);
      if (rejection) {
        assert.equal(rejection instanceof TypeError, true);
        assert.match(rejection.message, /unsupported game version/i);
      } else {
        assert.equal(plan.state, PlanState.BLOCKED);
        assert.deepEqual(plan.steps, []);
      }
    });
  }
});

test("the safe game-context constructor never defaults absent evidence to FC26", () => {
  for (const input of [{}, { gameVersion: undefined }, { gameVersion: "unknown" }]) {
    const context = createGameContext(input);
    assert.equal(context.gameVersion, GameVersion.UNKNOWN);
    assert.equal(context.state, "unverified");
  }

  for (const malformed of [null, "", "fc28", {}, []]) {
    assert.throws(
      () => createGameContext({ gameVersion: malformed }),
      /unsupported game version/i,
    );
  }
});

test("the new version gate does not change the verified FC26 compiler path", async () => {
  let strategyCalls = 0;
  const compiler = createCompiler(async () => {
    strategyCalls += 1;
    return { steps: [{ type: "FC26_FIXTURE_STEP" }] };
  });

  const plan = await compiler.compile(
    goal(),
    createGameContext({ gameVersion: GameVersion.FC26, observedAt: 1 }),
  );

  assert.equal(strategyCalls, 1);
  assert.equal(plan.state, PlanState.READY);
  assert.equal(plan.steps[0].type, "FC26_FIXTURE_STEP");
});
