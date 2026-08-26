import {
  buildSolverContext,
  solveSquad,
} from "../../../solver/solver.js";
import { compileConstraintSet } from "../../../solver/constraint-compiler.js";
import { FODDER_OBJECTIVE_FIELDS, FodderPolicy } from "../../policies/fodder-policy.js";
import { getBasePlayerId, normalizeOwnedItems } from "./item-identity.js";
import {
  SolverInterface,
  validateSolverRequest,
} from "./solver-interface.js";

const findTargetRating = (requirements) => {
  const compiled = compileConstraintSet(requirements);
  return compiled.summary.teamRatingTarget;
};

const duplicateFootballerIds = (items) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const id = getBasePlayerId(item);
    if (id == null) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
};

/** Adapter retaining AutoPilot as the canonical in-browser implementation. */
export class ExistingAutoPilotSolver extends SolverInterface {
  constructor({ buildContext = buildSolverContext, solve = solveSquad } = {}) {
    super("existing-autopilot");
    this.buildContext = buildContext;
    this.solveImplementation = solve;
  }

  get capabilities() {
    return Object.freeze({
      browser: true,
      sidecarRequired: false,
      chemistry: true,
      conceptFallback: true,
      conservationPolicy: true,
    });
  }

  solve(request) {
    validateSolverRequest(request);
    const players = normalizeOwnedItems(request.players).map((item) => ({
      ...item,
      id: item.id ?? item.itemId,
    }));
    const fodderPolicy =
      request.fodderPolicy instanceof FodderPolicy
        ? request.fodderPolicy
        : new FodderPolicy(request.fodderPolicy || {}, {
            targetProjects: request.targetProjects || [],
          });
    const policyAnalysis = fodderPolicy.analyze(players);
    const excludedPlayerIds = Array.from(
      new Set([
        ...(request.filters?.excludedPlayerIds || []).map(String),
        ...policyAnalysis.protectedItemIds,
      ]),
    );
    const prioritize = {
      ...(request.prioritize || {}),
      duplicates: fodderPolicy.config.preferDuplicates,
      storage: fodderPolicy.config.preferSbcStorage,
      untradeables: fodderPolicy.config.preferUntradeables,
    };
    const context = this.buildContext({
      ...request,
      players,
      filters: { ...(request.filters || {}), excludedPlayerIds },
      prioritize,
      conservationPolicy: {
        ...fodderPolicy.toSolverConservationPolicy(),
        protectedItemIds: policyAnalysis.protectedItemIds,
      },
    });
    const result = this.solveImplementation(context);
    const selectedIds = Array.isArray(result?.solutions?.[0])
      ? result.solutions[0].map(String)
      : [];
    const byId = new Map(players.map((item) => [String(item.id), item]));
    const selectedItems = selectedIds.map((id) => byId.get(id)).filter(Boolean);
    const repeatedFootballers = duplicateFootballerIds(selectedItems);
    const targetRating = findTargetRating(request.requirementsNormalized);
    const objectiveTuple = fodderPolicy.getSquadObjectiveTuple(selectedItems, {
      allItems: players,
      targetRating,
      analysis: policyAnalysis,
      hardRequirementViolations:
        Array.isArray(result?.failingRequirements) ? result.failingRequirements.length : 0,
    });

    if (repeatedFootballers.length) {
      const failingRequirements = [
        ...(Array.isArray(result?.failingRequirements)
          ? result.failingRequirements
          : []),
        {
          reason: "same_footballer_multiple_versions",
          basePlayerIds: repeatedFootballers,
        },
      ];
      return {
        ...result,
        stats: { ...(result?.stats || {}), solved: false },
        failingRequirements,
        solverAdapterId: this.id,
        policy: {
          protectedItemIds: policyAnalysis.protectedItemIds,
          reasonsByItemId: policyAnalysis.reasonsByItemId,
          activeTargetProjectIds: policyAnalysis.activeTargetProjectIds,
          objectiveFields: FODDER_OBJECTIVE_FIELDS,
          objectiveTuple,
        },
      };
    }

    return {
      ...result,
      solverAdapterId: this.id,
      policy: {
        protectedItemIds: policyAnalysis.protectedItemIds,
        reasonsByItemId: policyAnalysis.reasonsByItemId,
        activeTargetProjectIds: policyAnalysis.activeTargetProjectIds,
        objectiveFields: FODDER_OBJECTIVE_FIELDS,
        objectiveTuple,
      },
    };
  }
}
