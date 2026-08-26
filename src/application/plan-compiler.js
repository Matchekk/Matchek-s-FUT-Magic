import { Feature } from "./entitlement-service.js";
import {
  GameStrategyReadiness,
  createLegacyFc26StrategyRegistry,
  gameStrategyMetadata,
  isGameStrategyExecutionEnabled,
} from "./game-strategy-registry.js";
import { createPlan } from "./plans.js";

const DEFAULT_FEATURES = Object.freeze({
  complete_sbc: Feature.SBC_PROJECTS,
  grind_upgrades: Feature.LOCAL_RECIPES,
  clear_duplicates: Feature.PRODUCT_SHELL,
  optimize_fodder: Feature.PRODUCT_SHELL,
  plan_evolution: Feature.EVOLUTION_PLANNING,
  optimize_club: Feature.CLUB_OPTIMIZATION,
});

export class PlanCompiler {
  constructor({
    capabilityRegistry,
    entitlementService,
    strategies = {},
    strategyRegistry = null,
    compilerVersion = 1,
  }) {
    this.capabilities = capabilityRegistry;
    this.entitlements = entitlementService;
    if (strategyRegistry != null && typeof strategyRegistry.resolve !== "function") {
      throw new TypeError("PlanCompiler strategyRegistry must provide resolve()");
    }
    this.strategyRegistry = strategyRegistry ?? createLegacyFc26StrategyRegistry(strategies);
    this.compilerVersion = compilerVersion;
  }

  async compile(goal, gameContext) {
    const resolution = this.strategyRegistry.resolve({
      gameVersion: gameContext?.gameVersion,
      goalKind: goal?.kind,
      challengeKind: gameContext?.challengeKind ?? null,
    });
    const executionEnabled = isGameStrategyExecutionEnabled(gameContext?.gameVersion);
    const strategy = executionEnabled ? resolution.strategy : null;
    const strategyMetadata = gameStrategyMetadata(resolution);
    const feature = DEFAULT_FEATURES[goal?.kind];
    const entitlement = this.entitlements.check(feature);
    const blockers = [];
    if (!entitlement.entitled) blockers.push({ code: "ENTITLEMENT_REQUIRED", feature, requiredPlan: entitlement.requiredPlan });
    if (resolution.readiness === GameStrategyReadiness.OBSERVE_ONLY) {
      blockers.push({
        code: "GAME_STRATEGY_OBSERVE_ONLY",
        goalKind: goal?.kind,
        gameVersion: gameContext?.gameVersion,
        strategyId: resolution.id,
      });
    } else if (!executionEnabled ||
        resolution.readiness !== GameStrategyReadiness.VERIFIED ||
        typeof strategy !== "function") {
      blockers.push({
        code: "GAME_STRATEGY_UNAVAILABLE",
        goalKind: goal?.kind,
        gameVersion: gameContext?.gameVersion,
      });
    }
    if (gameContext?.state !== "verified") blockers.push({ code: "GAME_CONTEXT_UNVERIFIED", gameVersion: gameContext?.gameVersion });
    const preflight = this.capabilities.require(resolution.requiredCapabilities || []);
    if (!preflight.ok) {
      blockers.push(...preflight.missing.map((id) => ({ code: "CAPABILITY_UNAVAILABLE", capabilityId: id })));
    }
    if (blockers.length) return createPlan({
      goal,
      gameContext,
      blockers,
      strategy: strategyMetadata,
      compilerVersion: this.compilerVersion,
    });
    const draft = await strategy({ goal, gameContext });
    const capabilityCheck = this.capabilities.require(draft.requiredCapabilities || []);
    if (!capabilityCheck.ok) {
      blockers.push(...capabilityCheck.missing.map((id) => ({ code: "CAPABILITY_UNAVAILABLE", capabilityId: id })));
    }
    blockers.push(...(draft.blockers || []));
    return createPlan({
      goal,
      gameContext,
      steps: blockers.length ? [] : draft.steps || [],
      blockers,
      explanation: draft.explanation || [],
      fingerprints: draft.fingerprints || null,
      preview: draft.preview || null,
      strategy: strategyMetadata,
      compilerVersion: this.compilerVersion,
    });
  }
}

export class Planner {
  constructor({ compiler, gameContextPort }) {
    this.compiler = compiler;
    this.gameContextPort = gameContextPort;
  }

  async plan(goal) {
    return this.compiler.compile(goal, await this.gameContextPort.read());
  }
}
