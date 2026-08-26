import { ActivityLogger } from "./core/activity-logger.js";
import { exportRunAnalytics, summarizeRunAnalytics } from "./analytics/run-analytics.js";
import {
  buildDuplicateRouteFingerprints,
  buildFodderReview,
  buildRuntimeCapabilityRegistry,
  buildSbcPlanFingerprints,
  canonicalDuplicateRouteActions,
  compareDuplicateRouteFingerprints,
  compareSbcPlanFingerprints,
  createGameContext,
  createGoal,
  EntitlementService,
  GameVersion,
  normalizeGameVersion,
  GoalKind,
  FODDER_REVIEW_CAPABILITIES,
  PlanCompiler,
  ProductPlan,
  projectChallengeForContext,
  recommendRouterNextAction,
  RouterActivityGuardState,
  DUPLICATE_ROUTE_MOVE_CAPABILITIES,
  DUPLICATE_ROUTE_POLICY,
  DUPLICATE_ROUTE_READ_CAPABILITIES,
  SBC_PREVIEW_CAPABILITIES,
  summarizeDuplicateRoute,
  summarizeSbcSolution,
} from "./application/index.js";
import { createDeveloperMode } from "./dev/debug-mode.js";
import { ControllerAdapter } from "./ea/controller-adapter.js";
import { PageStorageArea } from "./ea/page-storage-area.js";
import { PageWorkflowRepository } from "./ea/workflow-storage-repository.js";
import { InventoryService } from "./inventory/inventory-service.js";
import { PackService } from "./packs/pack-service.js";
import { identifyClaimedRewardPack, RewardService } from "./packs/reward-service.js";
import { PlayerPickService } from "./picks/player-pick-service.js";
import { FodderPolicy } from "./policies/fodder-policy.js";
import { TargetProjectService } from "./policies/target-project-service.js";
import { ChromeStorageProfileRepository } from "./profiles/profile-repository.js";
import { ProfileService } from "./profiles/profile-service.js";
import { buildProductShellViewModel } from "./presentation/product-shell-view-model.js";
import { GrindPanel } from "./ui/grind-panel.js";
import { EaSurfaceActions } from "./ui/ea-surface-actions.js";
import { RunHud } from "./ui/run-hud.js";
import {
  createAutoApproval,
  addWorkflowStep,
  createWorkflowStep,
  deleteWorkflowStep,
  duplicateWorkflowStep,
  evaluateCondition,
  evaluateWorkflowModeGate,
  finalizeWorkflowDraft,
  getWorkflowTemplate,
  importLegacySequence,
  listWorkflowTemplates,
  moveWorkflowStep,
  mutateWorkflowSteps,
  RunStatus,
  WorkflowEngine,
  WorkflowMode,
  WorkflowStepType,
} from "./workflow/index.js";

const VERSION = globalThis.document?.documentElement?.dataset?.eaDataExtensionVersion || "unknown";

const outcome = (result) => ({ status: "completed", result });
const latestResult = (run, type) =>
  [...(run?.nodes ?? [])].reverse().find(
    (node) => node.step?.type === type && node.status === "completed",
  )?.result ?? null;

const ownedItemId = (item) => String(item?.itemId ?? item?.id ?? "");
const inventoryItemIds = (raw = {}) =>
  new Set(
    [
      ...(raw?.club ?? []),
      ...(raw?.storage ?? []),
      ...(raw?.unassigned ?? []),
    ]
      .map(ownedItemId)
      .filter(Boolean),
  );
const packCount = (packs = [], packId) =>
  (Array.isArray(packs) ? packs : []).reduce(
    (sum, pack) =>
      String(pack?.packId ?? pack?.id ?? "") === String(packId)
        ? sum + Math.max(0, Number(pack?.count ?? 1) || 0)
        : sum,
    0,
  );
const sameStringSet = (left, right) =>
  left.size === right.size && [...left].every((value) => right.has(value));
const recovery = (status, result = null, message = null) => ({
  status,
  result,
  ...(message ? { error: { message } } : {}),
});

const buildInventoryBuckets = (items = []) => {
  const labels = ["75–79", "80–84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94+"];
  const result = Object.fromEntries(labels.map((label) => [label, { club: 0, storage: 0, unassigned: 0 }]));
  const labelFor = (rating) => {
    if (rating >= 94) return "94+";
    if (rating >= 85) return String(rating);
    if (rating >= 80) return "80–84";
    if (rating >= 75) return "75–79";
    return null;
  };
  for (const item of items) {
    const label = labelFor(Math.trunc(Number(item?.rating) || 0));
    const location = item?.location === "sbc_storage" ? "storage" : item?.location;
    if (label && result[label] && Object.hasOwn(result[label], location)) result[label][location] += 1;
  }
  return result;
};

const buildWorkflow = (config) => ({
  id: "reward-grind-loop",
  name: "Reward Grind Loop",
  version: 1,
  metadata: { source: "grindpilot-ui", safetyModel: "fail-closed" },
  steps: [{
    id: "grind-loop",
    type: WorkflowStepType.LOOP,
    config: {
      maxIterations: config.maxIterations,
      body: [
        { id: "solve-sbc", type: WorkflowStepType.SOLVE_SBC, timeoutMs: 120_000, retryPolicy: { maxAttempts: 2, delayMs: 800, retryableCodes: ["EA_OPERATION_UNAVAILABLE"] } },
        { id: "submit-sbc", type: WorkflowStepType.SUBMIT_SBC, timeoutMs: 30_000 },
        { id: "claim-reward", type: WorkflowStepType.CLAIM_REWARD, timeoutMs: 30_000 },
        { id: "open-reward", type: WorkflowStepType.OPEN_REWARD_PACK, timeoutMs: 45_000 },
        { id: "handle-player-pick", type: WorkflowStepType.HANDLE_PLAYER_PICK, timeoutMs: 30_000 },
        { id: "resolve-items", type: WorkflowStepType.RESOLVE_ITEMS, timeoutMs: 45_000 },
      ],
    },
  }],
});

class GrindPilotRuntime {
  constructor(options = {}) {
    this.storage = options.storage ?? new PageStorageArea();
    this.adapter = options.adapter ?? new ControllerAdapter();
    this.inventory = options.inventory ?? new InventoryService();
    this.logger = options.logger ?? new ActivityLogger({ maxEntries: 500 });
    this.targets = options.targets ?? new TargetProjectService();
    this.enableUi = options.enableUi !== false;
    this.enableActivityPersistence = options.enableActivityPersistence !== false;
    this.confirm = options.confirm ?? ((message) => globalThis.window?.confirm?.(message) === true);
    const runtimeRoot = options.root ?? globalThis.window ?? globalThis;
    const runtimeOrigin = options.origin ?? globalThis.location?.origin ?? "https://example.invalid";
    this.profileService = new ProfileService({
      repository:
        options.profileRepository ?? new ChromeStorageProfileRepository(this.storage),
    });
    this.dev = options.dev ?? createDeveloperMode({
      root: runtimeRoot,
      extensionVersion: VERSION,
      capabilityDefinitions: [
        { id: "ea-bridge", path: "eaData.grindPilot", requiredMethods: ["getHealth", "solveCurrentSbc", "submitCurrentSbc"] },
      ],
      allowedNetworkOrigins: [runtimeOrigin],
    });
    this.listeners = new Set();
    this.drivePromise = null;
    this.inventoryRefreshPromise = null;
    this.inventoryAvailable = false;
    this.sbcPlanCache = new Map();
    this.duplicateRoutePlanCache = new Map();
    this.duplicateRouteApprovalInFlight = false;
    this.wakeTimer = null;
    this.config = this.defaultConfig();
    this.state = {
      bridgeHealth: "checking", runStatus: "idle", currentStep: null,
      iterations: 0, maxIterations: 0, sbcCompleted: 0, packsOpened: 0,
      duplicatesRecycled: 0, protectedCardsSaved: 0, storageCount: 0,
      storageCapacity: 100, unassignedCount: 0, inventory: {}, logs: [],
      profiles: [], projects: [], diagnostics: { enabled: false }, draft: this.config,
      targetDashboard: [], solveDetails: null, picksCompleted: 0,
      workflowDraft: buildWorkflow(this.config),
      workflowTemplates: listWorkflowTemplates().map(({ id, name }) => ({ id, name })),
      legacySequences: [],
      inventoryBuckets: buildInventoryBuckets(),
      timeline: [],
      capabilityHealth: [],
      analytics: summarizeRunAnalytics(null),
      currentContext: null, contextObservedAt: null, inventoryAvailable: false,
      gameVersion: GameVersion.UNKNOWN,
      gameVersionObservation: "unverified",
      gameVersionSource: "none",
      runName: null, runModeLabel: null, productRevision: 0,
      legacyPanelOpen: false,
      sbcPlanPreviews: {}, sbcPlanNotices: {},
      duplicateRoutePlan: null, duplicateRouteNotice: null,
      routerRecommendation: null, routerRecommendationNotice: null,
      fodderReviewPlan: null,
      pauseReason: null, error: null,
    };
    this.inventoryFacade = {
      getState: async () => ({ unassigned: this.inventory.getSnapshot().unassigned.items }),
      refresh: async () => this.refreshInventory(),
    };
    this.rewardService = new RewardService({ adapter: this.adapter, logger: this.domainLogger() });
    this.packService = new PackService({ adapter: this.adapter, inventoryService: this.inventoryFacade, logger: this.domainLogger() });
    this.playerPickService = new PlayerPickService({
      adapter: this.adapter,
      logger: this.domainLogger(),
    });
    this.engine = new WorkflowEngine({
      repository:
        options.workflowRepository ?? new PageWorkflowRepository(this.storage),
      handlers: this.createHandlers(),
      contextProvider: () => this.conditionContext(),
      modeGate: (input) => this.evaluateRunGate(input),
    });
    this.engineUnsubscribe = null;
    this.logger.subscribe(() => {
      this.state.logs = this.logger.entries();
      if (this.enableActivityPersistence) this.persistActivity();
      this.emit();
    });
  }

  defaultConfig() {
    return { mode: WorkflowMode.REVIEW, maxIterations: 1, storageCapacity: 100, protectRatingAtOrAbove: 94,
      protectedCardTypes: ["FOF"], protectedItemIds: [], protectedPlayerIds: [], protectedResourceIds: [],
      protectStartingSquad: true, protectFavorites: true, protectTradables: false,
      preferUntradeables: true, preferDuplicates: true, preferSbcStorage: true,
      minimumReserveByRating: {}, packMode: "OPEN_CURRENT_REWARD", maxPacks: 1,
      organizerTargetProjectId: null,
      pickMode: "PAUSE_FOR_USER", workflow: null,
      runLimits: { maxIterations: 1 }, stopConditions: [] };
  }

  createFodderPolicy() {
    return new FodderPolicy({
      protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
      protectedCardTypes: this.config.protectedCardTypes,
      allowedSpecialTypes: this.config.allowedSpecialTypes,
      protectedItemIds: this.config.protectedItemIds || [],
      protectedPlayerIds: this.config.protectedPlayerIds || [],
      protectedResourceIds: this.config.protectedResourceIds || [],
      protectedRatings: this.config.protectedRatings || [],
      protectStartingSquad: this.config.protectStartingSquad === true,
      protectFavorites: this.config.protectFavorites === true,
      protectTradables: this.config.protectTradables === true,
      preferUntradeables: this.config.preferUntradeables !== false,
      preferDuplicates: this.config.preferDuplicates !== false,
      preferSbcStorage: this.config.preferSbcStorage !== false,
      minimumReserveByRating: this.config.minimumReserveByRating || {},
      specialReserveByCardType: this.config.specialReserveByCardType || {},
    }, { targetProjects: this.targets });
  }

  domainLogger() {
    return { info: (action, data) => this.logger.info(action, action, data), warn: (action, data) => this.logger.warn(action, action, data) };
  }

  invalidateRouterRecommendation(message = null) {
    const hadRecommendation = Boolean(this.state.routerRecommendation);
    this.state.routerRecommendation = null;
    if (hadRecommendation && message) {
      this.state.routerRecommendationNotice = String(message);
    }
  }

  invalidateDuplicateRoutePreview(message = null) {
    const hadPreview = Boolean(this.state.duplicateRoutePlan);
    this.duplicateRoutePlanCache?.clear?.();
    this.state.duplicateRoutePlan = null;
    if (hadPreview && message) {
      this.state.duplicateRouteNotice = String(message);
    }
  }

  invalidateGameSemanticPlans(message = null) {
    const hadSbcPreviews = this.sbcPlanCache.size > 0 ||
      Object.keys(this.state.sbcPlanPreviews || {}).length > 0;
    this.sbcPlanCache.clear();
    this.state.sbcPlanPreviews = {};
    if (hadSbcPreviews && message) {
      this.state.sbcPlanNotices = Object.fromEntries(
        Object.keys(this.state.sbcPlanNotices || {}).map((key) => [key, String(message)]),
      );
    }
    this.state.fodderReviewPlan = null;
    this.invalidateDuplicateRoutePreview(message);
    this.invalidateRouterRecommendation(message);
  }

  async refreshGameContext() {
    const previous = this.state.currentContext || null;
    let observed = null;
    try {
      const raw = await this.adapter.getContext();
      let gameVersion = GameVersion.UNKNOWN;
      try { gameVersion = normalizeGameVersion(raw?.gameVersion); } catch {}
      observed = {
        route: raw?.route == null ? null : String(raw.route),
        setId: raw?.setId == null ? null : String(raw.setId),
        setName: raw?.setName == null ? null : String(raw.setName),
        challengeId: raw?.challengeId == null ? null : String(raw.challengeId),
        challengeName: raw?.challengeName == null ? null : String(raw.challengeName),
        challengeKind: raw?.challengeKind == null ? null : String(raw.challengeKind),
        gameVersion,
        gameVersionObservation: ["observed", "compatibility_default"].includes(raw?.gameVersionObservation)
          ? raw.gameVersionObservation
          : (gameVersion === GameVersion.UNKNOWN ? "unverified" : "observed"),
        gameVersionSource: raw?.gameVersionSource == null ? "none" : String(raw.gameVersionSource),
      };
    } catch {
      observed = {
        gameVersion: GameVersion.UNKNOWN,
        gameVersionObservation: "unverified",
        gameVersionSource: "none",
      };
    }
    this.state.currentContext = observed;
    this.state.gameVersion = observed.gameVersion;
    this.state.gameVersionObservation = observed.gameVersionObservation;
    this.state.gameVersionSource = observed.gameVersionSource;
    this.state.contextObservedAt = Date.now();
    const beforeKey = previous && JSON.stringify([
      previous.gameVersion,
      previous.gameVersionObservation,
      previous.gameVersionSource,
      previous.challengeKind,
      previous.setId,
      previous.challengeId,
    ]);
    const afterKey = JSON.stringify([
      observed.gameVersion,
      observed.gameVersionObservation,
      observed.gameVersionSource,
      observed.challengeKind,
      observed.setId,
      observed.challengeId,
    ]);
    if (beforeKey && beforeKey !== afterKey) {
      this.invalidateGameSemanticPlans(
        "The observed EA game context changed. Preview again before approving anything.",
      );
    }
    return this.currentGameContext();
  }

  currentRouterActivityGuard() {
    const run = this.engine?.getSnapshot?.();
    if (!run || [RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(run.status)) {
      return {
        state: RouterActivityGuardState.IDLE,
        evidence: { runStatus: run?.status || "idle" },
      };
    }
    if (Object.values(RunStatus).includes(run.status)) {
      return {
        state: RouterActivityGuardState.NON_IDLE,
        evidence: { runStatus: run.status, currentStep: run.nodes?.[run.cursor]?.step?.type || null },
      };
    }
    return {
      state: RouterActivityGuardState.UNKNOWN,
      evidence: { runStatus: String(run.status || "unknown") },
    };
  }

  async initialize() {
    await this.loadPersistentState();
    await this.refreshStatus();
    const active = await this.engine.load();
    if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
      await this.engine.recover(active.runId);
      this.logger.warn("Recovery", "Recovered a suspended run at a safe boundary", { runId: active.runId });
    }
    // Subscribe only after recovery. A loaded RUNNING snapshot must never queue
    // work before an interrupted destructive operation has been reconciled.
    this.engineUnsubscribe = this.engine.subscribe((run) => this.onRun(run));
    if (this.engine.getSnapshot()) this.onRun(this.engine.getSnapshot());
    if (this.enableUi) {
      this.panel = new GrindPanel(this);
      this.surfaceActions = new EaSurfaceActions(this);
      this.runHud = new RunHud(this);
    }
    this.emit();
  }

  async loadPersistentState() {
    const stored = await this.storage.loadBootstrap();
    for (const entry of Array.isArray(stored.activity) ? stored.activity : []) {
      this.logger.log(entry.level || "info", entry.action || "Restored", entry.message || "", entry.data ?? null);
    }
    const projects = Array.isArray(stored.projects) ? stored.projects : [];
    this.targets = new TargetProjectService(projects);
    this.state.projects = this.targets.list();
    this.config = {
      ...this.defaultConfig(),
      ...(stored.settings || {}),
      // This is a non-configurable invariant: active-squad cards are never fodder.
      protectStartingSquad: true,
    };
    this.state.storageCapacity = Math.max(1, Math.min(100, Math.trunc(this.config.storageCapacity || 100)));
    this.state.draft = this.config;
    this.state.workflowDraft = structuredClone(
      this.config.workflow || buildWorkflow(this.config),
    );
    this.state.profiles = await this.profileService.list();
  }

  createHandlers() {
    return {
      [WorkflowStepType.SOLVE_SBC]: {
        execute: async ({ run, step }) => {
          const target = step?.config?.target || { kind: "CURRENT_OPEN_SBC" };
          const context = await this.adapter.getContext();
          if (
            target.kind === "SPECIFIC_CHALLENGE" &&
            (
              String(context?.challengeId ?? "") !== String(target.challengeId ?? "") ||
              (target.setId != null &&
                String(context?.setId ?? "") !== String(target.setId ?? ""))
            )
          ) {
            return {
              status: "paused",
              code: "SBC_TARGET_NOT_OPEN",
              message: "Open the workflow's stable challenge ID before continuing.",
              result: { target, observed: context },
            };
          }
          if (
            target.kind === "SPECIFIC_SET" &&
            String(context?.setId ?? "") !== String(target.setId ?? "")
          ) {
            return {
              status: "paused",
              code: "SBC_TARGET_NOT_OPEN",
              message: "Open the workflow's stable SBC set ID before continuing.",
              result: { target, observed: context },
            };
          }
          await this.refreshInventory();
          const policy = this.createFodderPolicy();
          const inventoryItems = this.inventory.getSnapshot().items;
          const analysis = policy.analyze(inventoryItems);
          this.currentProtectedItemIds = analysis.protectedItemIds;
          const solved = await this.adapter.solveCurrentSbc({
            previewOnly: run.mode === WorkflowMode.REVIEW,
            protectedItemIds: analysis.protectedItemIds,
            conservationPolicy: {
              ...policy.toSolverConservationPolicy(),
              protectedItemIds: analysis.protectedItemIds,
            },
            prioritize: {
              duplicates: this.config.preferDuplicates !== false,
              untradeables: this.config.preferUntradeables !== false,
              storage: this.config.preferSbcStorage !== false,
            },
            solverSettings: {
              ...(this.config.solverSettings || {}),
              ...(step?.config?.solverSettings || {}),
            },
          });
          if (
            target.kind === "SPECIFIC_CHALLENGE" &&
            (
              String(solved?.challengeId ?? "") !== String(target.challengeId ?? "") ||
              (target.setId != null &&
                String(solved?.setId ?? "") !== String(target.setId ?? ""))
            )
          ) {
            const error = new Error("The solved squad no longer matches the approved SBC challenge");
            error.code = "SBC_TARGET_CHANGED_DURING_SOLVE";
            throw error;
          }
          const explanation = policy.explainSelection(
            solved.solutionIds,
            inventoryItems,
          );
          const selectedIds = new Set((solved.solutionIds ?? []).map(String));
          const selectedItems = inventoryItems
            .filter((item) => selectedIds.has(String(item.itemId)))
            .map((item) => ({ itemId: item.itemId, rating: item.rating }));
          const protectedIds = new Set(analysis.protectedItemIds.map(String));
          if ([...selectedIds].some((id) => protectedIds.has(id))) {
            const error = new Error("The solved squad contains a protected card");
            error.code = "PROTECTED_ITEM_SELECTED";
            throw error;
          }
          if (selectedIds.size !== 11 || selectedItems.length !== 11) {
            const error = new Error("The solved squad is not a verified 11-card Club selection");
            error.code = "SOLUTION_ITEMS_UNOBSERVED";
            throw error;
          }
          this.state.protectedCardsSaved = analysis.protectedItemIds.length;
          this.state.solveDetails = explanation;
          this.logger.info("Solve", "Verified squad solution", {
            challengeId: solved.challengeId,
            protected: analysis.protectedItemIds.length,
            explanation: explanation.explanations,
            objectiveTuple: solved?.stats?.conservationObjectiveTuple ?? explanation.objectiveTuple,
          });
          return outcome({
            ...solved,
            protectedItemIds: analysis.protectedItemIds,
            explanation,
            selectedItems,
          });
        },
      },
      [WorkflowStepType.SUBMIT_SBC]: {
        prepare: ({ run }) => {
          const solved = latestResult(run, WorkflowStepType.SOLVE_SBC);
          if (!solved?.submitReady) throw Object.assign(new Error("No submit-ready verified solution"), { code: "SOLUTION_NOT_READY", safeToRetry: true });
          return { expectedChallengeId: solved.challengeId, expectedSetId: solved.setId ?? null, expectedItemIds: solved.solutionIds, protectedItemIds: solved.protectedItemIds || [] };
        },
        execute: async ({ intent }) => {
          const result = await this.adapter.submitCurrentSbc(intent);
          await this.recordVerifiedTargetCompletion(intent);
          this.logger.info("Submit", "SBC submission verified", { challengeId: intent.expectedChallengeId });
          return outcome(result);
        },
        recover: async ({ node }) => {
          const intent = node?.intent ?? {};
          if (typeof this.adapter.reconcileSubmit === "function") {
            return this.adapter.reconcileSubmit(intent);
          }
          let project = null;
          try { project = await this.adapter.readCurrentSbcProject(); } catch {}
          const challenge = project?.challenges?.find(
            (entry) => String(entry?.id ?? "") === String(intent.expectedChallengeId ?? ""),
          );
          if (challenge?.completed === true) {
            await this.recordVerifiedTargetCompletion(intent);
            return recovery("completed", { challengeId: intent.expectedChallengeId });
          }
          let observed;
          let context;
          try {
            [observed, context] = await Promise.all([
              this.adapter.readInventory(),
              this.adapter.getContext(),
            ]);
          } catch (error) {
            return recovery("ambiguous", null, error?.message || "SBC post-state is unavailable");
          }
          const ids = inventoryItemIds(observed);
          const expected = (intent.expectedItemIds ?? []).map(String);
          const present = expected.filter((id) => ids.has(id));
          if (
            expected.length > 0 &&
            present.length === 0 &&
            (context?.challengeCompleted === true ||
              String(context?.challengeId ?? "") !== String(intent.expectedChallengeId ?? ""))
          ) {
            await this.recordVerifiedTargetCompletion(intent);
            return recovery("completed", { challengeId: intent.expectedChallengeId });
          }
          if (
            present.length === expected.length &&
            String(context?.challengeId ?? "") === String(intent.expectedChallengeId ?? "") &&
            context?.challengeCompleted !== true
          ) {
            return recovery("not_applied");
          }
          return recovery("ambiguous", null, "SBC submission post-state is mixed or inconclusive");
        },
      },
      [WorkflowStepType.CLAIM_REWARD]: {
        prepare: async () => ({ packsBefore: await this.adapter.listOwnedPacks() }),
        execute: async ({ intent }) => {
          const reward = await this.rewardService.claimAndIdentify(
            { source: "current-sbc" },
            intent.packsBefore,
          );
          this.logger.info("Reward", "Reward claimed and pack identified", { packId: reward.identifiedPackId });
          return outcome(reward);
        },
        recover: async ({ node }) => {
          const intent = node?.intent ?? {};
          if (typeof this.adapter.reconcileRewardClaim === "function") {
            return this.adapter.reconcileRewardClaim(intent);
          }
          try {
            const packsAfter = await this.adapter.listOwnedPacks();
            const pack = identifyClaimedRewardPack({
              packsBefore: intent.packsBefore ?? [],
              packsAfter,
            });
            return recovery("completed", {
              identifiedPackId: String(pack?.packId ?? pack?.id ?? ""),
              pack,
            });
          } catch (error) {
            const beforeTotal = (intent.packsBefore ?? []).reduce(
              (sum, pack) => sum + Number(pack?.count ?? 1),
              0,
            );
            let packsAfter = [];
            try { packsAfter = await this.adapter.listOwnedPacks(); } catch {}
            const afterTotal = packsAfter.reduce(
              (sum, pack) => sum + Number(pack?.count ?? 1),
              0,
            );
            if (afterTotal === beforeTotal) {
              return recovery("ambiguous", null, "Reward availability cannot be proven after interruption");
            }
            return recovery("ambiguous", null, error?.message || "Reward claim post-state is ambiguous");
          }
        },
      },
      [WorkflowStepType.OPEN_REWARD_PACK]: {
        prepare: async ({ run, step }) => {
          const reward = latestResult(run, WorkflowStepType.CLAIM_REWARD);
          const quickOpen = step?.config?.quickOpen === true;
          const quickPackId = String(step?.config?.packId ?? "");
          const plan = await this.packService.plan({
            policy: quickOpen
              ? {
                  mode: "OPEN_ALL_ALLOWED_PACKS",
                  maxPacks: 1,
                  allowedPackIds: quickPackId ? [quickPackId] : [],
                }
              : { mode: this.config.packMode, maxPacks: this.config.maxPacks || 1 },
            currentReward: quickOpen ? null : reward,
          });
          if (plan.packs.length !== 1) {
            throw Object.assign(new Error("Exactly one verified owned reward pack is required"), {
              code: "PACK_PLAN_AMBIGUOUS",
            });
          }
          const inventoryBefore = await this.adapter.readInventory();
          return {
            plan,
            packId: String(plan.packs[0]?.packId ?? plan.packs[0]?.id ?? ""),
            packsBefore: await this.adapter.listOwnedPacks(),
            inventoryItemIdsBefore: [...inventoryItemIds(inventoryBefore)],
          };
        },
        execute: async ({ intent }) => {
          const opened = await this.packService.openPlan(intent.plan);
          const packOpened = Array.isArray(opened.opened) && opened.opened.length > 0;
          const expectedUnassignedStop = packOpened && opened.reason === "UNASSIGNED_BLOCKING";
          if (!packOpened || (opened.status !== "completed" && !expectedUnassignedStop)) {
            return { status: "paused", code: opened.reason || "PACK_NOT_OPENED", message: "Reward pack opening requires attention", result: opened };
          }
          const beforeIds = new Set((intent.inventoryItemIdsBefore ?? []).map(String));
          const receivedItems = this.inventory.getSnapshot().items
            .filter((item) => !beforeIds.has(String(item.itemId)))
            .map((item) => ({ itemId: item.itemId, rating: item.rating }));
          this.logger.info("Pack", "Reward pack opened", { packId: opened.opened[0].packId });
          return outcome({ ...opened, receivedItems });
        },
        recover: async ({ node }) => {
          const intent = node?.intent ?? {};
          if (typeof this.adapter.reconcilePackOpen === "function") {
            return this.adapter.reconcilePackOpen(intent);
          }
          try {
            const [packsAfter, inventoryAfter] = await Promise.all([
              this.adapter.listOwnedPacks(),
              this.adapter.readInventory(),
            ]);
            const beforeCount = packCount(intent.packsBefore, intent.packId);
            const afterCount = packCount(packsAfter, intent.packId);
            const beforeIds = new Set((intent.inventoryItemIdsBefore ?? []).map(String));
            const afterIds = inventoryItemIds(inventoryAfter);
            const addedIds = [...afterIds].filter((id) => !beforeIds.has(id));
            if (beforeCount - afterCount === 1 && addedIds.length > 0) {
              const receivedItems = [
                ...(inventoryAfter.club ?? []),
                ...(inventoryAfter.storage ?? []),
                ...(inventoryAfter.unassigned ?? []),
              ]
                .filter((item) => addedIds.includes(ownedItemId(item)))
                .map((item) => ({ itemId: ownedItemId(item), rating: Number(item?.rating) || 0 }));
              return recovery("completed", {
                packId: intent.packId,
                itemIds: addedIds,
                receivedItems,
              });
            }
            if (beforeCount === afterCount && sameStringSet(beforeIds, afterIds)) {
              return recovery("not_applied");
            }
            return recovery("ambiguous", null, "Owned-pack and inventory evidence do not agree");
          } catch (error) {
            return recovery("ambiguous", null, error?.message || "Pack post-state is unavailable");
          }
        },
      },
      [WorkflowStepType.RESOLVE_ITEMS]: {
        prepare: async ({ step }) => {
          const approvedBoundary = Array.isArray(step?.config?.approvedRouteActions);
          if (approvedBoundary) await this.refreshStatus();
          else await this.refreshInventory();
          const resolutionPolicy = approvedBoundary
            ? { ...step.config.resolutionPolicy }
            : {
                preferSbcStorage: this.config.preferSbcStorage !== false,
                tradableWhenStorageUnavailable: "SAFE_HOLD",
                untradeableWhenStorageUnavailable: "PAUSE",
              };
          const plan = this.inventory.planUnassignedResolution(resolutionPolicy);
          const currentRouteActions = canonicalDuplicateRouteActions(plan.actions);
          const currentUnassignedItemIds = this.inventory
            .getSnapshot().unassigned.items.map((item) => String(item.itemId)).sort();
          if (approvedBoundary) {
            const capabilities = buildRuntimeCapabilityRegistry(this.state.capabilityHealth)
              .require([
                ...DUPLICATE_ROUTE_READ_CAPABILITIES,
                ...DUPLICATE_ROUTE_MOVE_CAPABILITIES,
              ]);
            if (!capabilities.ok) {
              const error = new Error(
                "A required EA item-move capability changed after approval",
              );
              error.code = "DUPLICATE_CAPABILITY_CHANGED";
              error.notApplied = true;
              error.safeToRetry = false;
              throw error;
            }
            const approvedRouteActions = canonicalDuplicateRouteActions(
              step.config.approvedRouteActions,
            );
            const expectedUnassignedItemIdsBefore = [
              ...(step.config.expectedUnassignedItemIdsBefore || []),
            ].map(String).sort();
            if (JSON.stringify(currentRouteActions) !== JSON.stringify(approvedRouteActions) ||
                JSON.stringify(currentUnassignedItemIds) !==
                  JSON.stringify(expectedUnassignedItemIdsBefore)) {
              const error = new Error(
                "Unassigned items or their safe destinations changed after approval",
              );
              error.code = "DUPLICATE_PLAN_STALE";
              error.notApplied = true;
              error.safeToRetry = false;
              throw error;
            }
          }
          const allowPartial = step?.config?.allowPartial === true;
          const expectedActions = approvedBoundary
            ? canonicalDuplicateRouteActions(step.config.approvedActions || [])
            : allowPartial
              ? plan.actions.filter((action) =>
                ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(action.type),
              )
              : plan.actions;
          return {
            plan,
            expectedActions,
            allowPartial,
            allowUnresolved: step?.config?.allowUnresolved === true,
            approvedBoundary,
            expectedUnassignedItemIdsBefore: approvedBoundary
              ? [...step.config.expectedUnassignedItemIdsBefore]
              : null,
            expectedRemainingItemIdsAfter: approvedBoundary
              ? [...step.config.expectedRemainingItemIdsAfter]
              : null,
            actionSetFingerprint: approvedBoundary
              ? String(step.config.actionSetFingerprint || "")
              : null,
          };
        },
        execute: async ({ intent }) => {
          if (intent?.plan?.requiresUserAction && !intent?.allowPartial &&
              !intent?.approvedBoundary) {
            return {
              status: "paused",
              code: "UNASSIGNED_USER_ACTION_REQUIRED",
              message: "The persisted duplicate plan requires a user decision; no item was moved.",
              result: intent.plan,
            };
          }
          const result = await this.adapter.resolveUnassigned({
            storageCapacity: this.state.storageCapacity,
            expectedActions: intent.expectedActions,
            allowPartial: intent.allowPartial === true,
            expectedUnassignedItemIdsBefore: intent.expectedUnassignedItemIdsBefore,
            expectedRemainingItemIdsAfter: intent.expectedRemainingItemIdsAfter,
            actionSetFingerprint: intent.actionSetFingerprint,
          });
          await this.refreshInventory();
          if (result.unresolvedUnassigned > 0 && !intent?.allowUnresolved) {
            this.logger.warn("Duplicate", "Unresolved items require user action", { count: result.unresolvedUnassigned });
            return { status: "paused", code: "UNRESOLVED_UNASSIGNED", message: `${result.unresolvedUnassigned} unassigned item(s) require a safe policy decision`, result };
          }
          this.logger.info("Duplicate", "Unassigned items resolved safely", { storage: result.movedToStorage?.length || 0 });
          return outcome(result);
        },
        recover: async ({ node }) => {
          const intent = node?.intent ?? {};
          if (typeof this.adapter.reconcileUnassignedResolution === "function") {
            return this.adapter.reconcileUnassignedResolution(intent);
          }
          try {
            const observed = await this.adapter.readInventory();
            const byLocation = {
              club: new Set((observed.club ?? []).map(ownedItemId)),
              sbc_storage: new Set((observed.storage ?? []).map(ownedItemId)),
              unassigned: new Set((observed.unassigned ?? []).map(ownedItemId)),
            };
            const actions = (intent.expectedActions ?? []).filter((action) =>
              ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(action?.type),
            );
            if (!actions.length) return recovery("completed", { movedToClub: [], movedToStorage: [] });
            const atDestination = actions.filter((action) =>
              byLocation[action.to]?.has(String(action.itemId)),
            ).length;
            const stillUnassigned = actions.filter((action) =>
              byLocation.unassigned.has(String(action.itemId)),
            ).length;
            if (atDestination === actions.length) {
              if (Array.isArray(intent.expectedRemainingItemIdsAfter)) {
                const expectedRemaining = new Set(
                  intent.expectedRemainingItemIdsAfter.map(String),
                );
                if (!sameStringSet(byLocation.unassigned, expectedRemaining)) {
                  return recovery(
                    "ambiguous",
                    null,
                    "Moved items reached their destinations, but the remaining Unassigned set changed",
                  );
                }
              }
              return recovery("completed", {
                movedToClub: actions.filter((action) => action.to === "club").map((action) => action.itemId),
                movedToStorage: actions.filter((action) => action.to === "sbc_storage").map((action) => action.itemId),
              });
            }
            if (stillUnassigned === actions.length) {
              if (Array.isArray(intent.expectedUnassignedItemIdsBefore)) {
                const expectedBefore = new Set(
                  intent.expectedUnassignedItemIdsBefore.map(String),
                );
                if (!sameStringSet(byLocation.unassigned, expectedBefore)) {
                  return recovery(
                    "ambiguous",
                    null,
                    "Approved items remain, but the complete Unassigned set changed",
                  );
                }
              }
              return recovery("not_applied");
            }
            return recovery("ambiguous", null, "Unassigned resolution is partial or items are missing");
          } catch (error) {
            return recovery("ambiguous", null, error?.message || "Unassigned post-state is unavailable");
          }
        },
      },
      [WorkflowStepType.ORGANIZE_ITEMS]: {
        prepare: async () => {
          await this.refreshInventory();
          const unassigned = this.inventory.getSnapshot().unassigned.items;
          const requiredItemIds = unassigned.map((item) => String(item.itemId));
          if (!requiredItemIds.length) return { requiredItemIds: [], target: null };
          if (requiredItemIds.length > 11) {
            const error = new Error(
              "More than 11 cards remain unassigned; Organizer will not consume only a partial batch",
            );
            error.code = "ORGANIZER_TOO_MANY_ITEMS";
            throw error;
          }
          const target = await this.getOrganizerTarget();
          const policy = new FodderPolicy({
            protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
            protectedCardTypes: this.config.protectedCardTypes,
            protectedItemIds: this.config.protectedItemIds || [],
            protectedPlayerIds: this.config.protectedPlayerIds || [],
            protectedResourceIds: this.config.protectedResourceIds || [],
            protectStartingSquad: this.config.protectStartingSquad === true,
            protectFavorites: this.config.protectFavorites === true,
            protectTradables: this.config.protectTradables === true,
            minimumReserveByRating: this.config.minimumReserveByRating || {},
          }, { targetProjects: this.targets });
          const analysis = policy.analyze(this.inventory.getSnapshot().items);
          const protectedIds = new Set(analysis.protectedItemIds.map(String));
          const protectedRequiredItemIds = requiredItemIds.filter((id) => protectedIds.has(id));
          if (protectedRequiredItemIds.length) {
            const error = new Error(
              "At least one remaining unassigned card is protected; no SBC was submitted",
            );
            error.code = "ORGANIZER_PROTECTED_ITEM";
            error.details = { protectedRequiredItemIds };
            throw error;
          }
          return {
            target,
            requiredItemIds,
            protectedItemIds: analysis.protectedItemIds,
            solverSettings: { ...(this.config.solverSettings || {}), useUnassigned: true },
          };
        },
        execute: async ({ intent }) => {
          if (!intent?.requiredItemIds?.length) {
            return outcome({ organizedItemIds: [], noOp: true });
          }
          const result = await this.adapter.organizeIntoSbc({
            setId: intent.target.setId,
            challengeId: intent.target.challengeId,
            requiredItemIds: intent.requiredItemIds,
            protectedItemIds: intent.protectedItemIds,
            solverSettings: intent.solverSettings,
          });
          await this.recordVerifiedTargetCompletion({
            expectedSetId: result.setId ?? intent.target.setId,
            expectedChallengeId: result.challengeId ?? intent.target.challengeId,
          });
          await this.refreshInventory();
          const remaining = new Set(
            this.inventory.getSnapshot().unassigned.items.map((item) => String(item.itemId)),
          );
          const stillUnassigned = intent.requiredItemIds.filter((id) => remaining.has(String(id)));
          if (stillUnassigned.length) {
            return {
              status: "paused",
              code: "ORGANIZER_POST_STATE_UNVERIFIED",
              message: "Organizer could not verify that every required card was consumed",
              result: { ...result, stillUnassigned },
            };
          }
          this.logger.info("Organizer", "Remaining cards consumed in selected SBC", {
            target: intent.target.name,
            count: intent.requiredItemIds.length,
          });
          return outcome({ ...result, organizedItemIds: intent.requiredItemIds });
        },
        recover: async ({ node }) => {
          const intent = node?.intent ?? {};
          try {
            const [observed, challengeState] = await Promise.all([
              this.adapter.readInventory(),
              this.adapter.readSbcChallengeState({
                setId: intent.target?.setId,
                challengeId: intent.target?.challengeId,
              }),
            ]);
            const ids = inventoryItemIds(observed);
            const expected = (intent.requiredItemIds ?? []).map(String);
            const present = expected.filter((id) => ids.has(id));
            if (!expected.length || (present.length === 0 && challengeState?.completed === true)) {
              await this.recordVerifiedTargetCompletion({
                expectedSetId: intent.target?.setId,
                expectedChallengeId: intent.target?.challengeId,
              });
              return recovery("completed", { organizedItemIds: expected });
            }
            if (
              present.length === expected.length &&
              challengeState?.available === true &&
              challengeState?.completed === false
            ) {
              return recovery("not_applied");
            }
            return recovery("ambiguous", null, "Organizer required-card post-state is mixed");
          } catch (error) {
            return recovery("ambiguous", null, error?.message || "Organizer post-state is unavailable");
          }
        },
      },
      [WorkflowStepType.HANDLE_PLAYER_PICK]: {
        prepare: async ({ run }) => {
          const decision = await this.playerPickService.handle({
            policy: this.currentPickPolicy(),
            context: this.playerPickContext(),
            execute: false,
          });
          const inventoryItems = this.inventory.getSnapshot().items;
          const selectedResourceId = decision.intent?.selectedResourceId ?? null;
          const pickIntent = decision.intent
            ? {
                ...decision.intent,
                inventoryItemIdsBefore: inventoryItems.map((item) => item.itemId),
                selectedResourceCountBefore: selectedResourceId
                  ? inventoryItems.filter(
                      (item) => String(item.resourceId ?? "") === String(selectedResourceId),
                    ).length
                  : 0,
              }
            : null;
          return {
            pickIntent,
            decisionStatus: decision.status,
            decisionReason: decision.reason,
            reviewOnly: run.mode === WorkflowMode.REVIEW,
          };
        },
        execute: async ({ intent, run }) => {
          if (!intent?.pickIntent) {
            if (intent?.decisionReason === "PICK_ALREADY_RESOLVED") {
              return outcome({ pending: false });
            }
            return {
              status: "paused",
              code: intent?.decisionReason || "PLAYER_PICK_UNVERIFIED",
              message: "Player-pick offers are unavailable, incomplete, or ambiguous. No selection was made.",
              result: { policy: this.currentPickPolicy() },
            };
          }
          const decision = await this.playerPickService.handle({
            pickId: intent.pickIntent.pickIdentity,
            policy: this.currentPickPolicy(),
            context: this.playerPickContext(),
            execute: run.mode !== WorkflowMode.REVIEW,
            approved: run.mode !== WorkflowMode.REVIEW,
            expectedIntent: intent.pickIntent,
          });
          if (decision.status === "completed" || (run.mode === WorkflowMode.REVIEW && decision.status === "selected")) {
            if (decision.status === "completed") this.state.picksCompleted = Number(this.state.picksCompleted || 0) + 1;
            return outcome({ ...decision, reviewOnly: run.mode === WorkflowMode.REVIEW });
          }
          return {
            status: "paused",
            code: decision.reason || "PLAYER_PICK_USER_REQUIRED",
            message: `Player pick paused safely: ${decision.reason || "no unique verified selection"}.`,
            result: decision,
          };
        },
        recover: async ({ node }) => {
          const result = await this.playerPickService.recover(
            node?.intent?.pickIntent,
            { ...this.playerPickContext(), inventoryItems: this.inventory.getSnapshot().items },
          );
          return result;
        },
      },
    };
  }

  async recordVerifiedTargetCompletion(intent = {}) {
    const updated = this.targets.markVerifiedChallengeCompleted({
      setId: intent.expectedSetId,
      challengeId: intent.expectedChallengeId,
    });
    if (!updated) return null;
    this.state.projects = this.targets.list();
    let items = [];
    try { items = this.inventory.getSnapshot().items; } catch {}
    this.state.targetDashboard = this.targets.getDashboard(items);
    await this.storage.saveProjects(this.state.projects);
    return updated;
  }

  currentGameContext({ requireSbcTarget = false } = {}) {
    const observed = this.state.currentContext || {};
    let gameVersion = GameVersion.UNKNOWN;
    try { gameVersion = normalizeGameVersion(observed.gameVersion ?? this.state.gameVersion); } catch {}
    const verified =
      this.state.bridgeHealth === "healthy" &&
      gameVersion === GameVersion.FC26 &&
      ["observed", "compatibility_default"].includes(
        observed.gameVersionObservation ?? this.state.gameVersionObservation,
      ) &&
      (!requireSbcTarget || (Boolean(observed.setId) && Boolean(observed.challengeId)));
    return createGameContext({
      gameVersion,
      state: verified ? "verified" : "unverified",
      challengeKind: observed.challengeKind,
      gameVersionObservation: observed.gameVersionObservation ?? this.state.gameVersionObservation,
      gameVersionSource: observed.gameVersionSource ?? this.state.gameVersionSource,
      route: observed.route,
      setId: observed.setId,
      setName: observed.setName,
      challengeId: observed.challengeId,
      challengeName: observed.challengeName,
      observedAt: Number(this.state.contextObservedAt || Date.now()),
    });
  }

  currentSbcGameContext() {
    return this.currentGameContext({ requireSbcTarget: true });
  }

  async requireFc26PlanningContext({ requireSbcTarget = false } = {}) {
    await this.refreshGameContext();
    const context = this.currentGameContext({ requireSbcTarget });
    if (context.gameVersion !== GameVersion.FC26 || context.state !== "verified") {
      const error = new Error(context.gameVersion === GameVersion.FC27
        ? "FC 27 planning is observe-only in this build"
        : "The active EA game version could not be verified for planning");
      error.code = context.gameVersion === GameVersion.FC27
        ? "GAME_VERSION_UNSUPPORTED"
        : "GAME_CONTEXT_UNVERIFIED";
      throw error;
    }
    return context;
  }

  buildDuplicateRouteEvidence() {
    const inventorySnapshot = this.inventory.getSnapshot();
    const policy = {
      ...DUPLICATE_ROUTE_POLICY,
      preferSbcStorage: this.config.preferSbcStorage !== false,
    };
    const resolutionPlan = this.inventory.planUnassignedResolution(policy);
    const capabilityRegistry = buildRuntimeCapabilityRegistry(this.state.capabilityHealth);
    if (!this.inventoryAvailable) {
      capabilityRegistry.declare("ea.inventory.read", {
        state: "unavailable",
        reason: "A current Club snapshot is unavailable",
      });
      capabilityRegistry.declare("ea.unassigned.read", {
        state: "unavailable",
        reason: "A current Unassigned snapshot is unavailable",
      });
    }
    const capabilitySnapshot = capabilityRegistry.snapshot();
    const gameContext = this.currentGameContext();
    const summary = summarizeDuplicateRoute({ plan: resolutionPlan, inventorySnapshot });
    const fingerprints = buildDuplicateRouteFingerprints({
      gameContext,
      inventorySnapshot,
      capabilitySnapshot,
      policy,
      routeActions: summary.routeActions,
    });
    return {
      inventorySnapshot,
      policy,
      resolutionPlan,
      summary,
      capabilityRegistry,
      capabilitySnapshot,
      gameContext,
      fingerprints,
    };
  }

  async previewDuplicateRoute() {
    await this.refreshStatus();
    const evidence = this.buildDuplicateRouteEvidence();
    const protectionPolicy = this.createFodderPolicy();
    const protectionAnalysis = protectionPolicy.analyze(evidence.inventorySnapshot.items);
    const routerRecommendation = recommendRouterNextAction({
      inventorySnapshot: evidence.inventorySnapshot,
      routeSummary: evidence.summary,
      capabilitySnapshot: evidence.capabilitySnapshot,
      gameContext: evidence.gameContext,
      activityGuard: this.currentRouterActivityGuard(),
      protectionAnalysis: {
        protectedItemIds: [...protectionAnalysis.protectedItemIds].map(String).sort(),
        reasonsByItemId: protectionAnalysis.reasonsByItemId,
        activeTargetProjectIds: [...protectionAnalysis.activeTargetProjectIds].map(String).sort(),
      },
      conservationPolicy: protectionPolicy.toSolverConservationPolicy(),
      duplicatePolicy: evidence.policy,
      observedAt: Number(evidence.inventorySnapshot.updatedAt || this.state.contextObservedAt || Date.now()),
    });
    const strategy = async () => {
      const { summary, fingerprints } = evidence;
      const blockers = [...summary.blockers];
      if (summary.totalCount > 0 && summary.safeCount === 0) {
        blockers.push({
          code: "NO_SAFE_ROUTE",
          message: "No current Unassigned item has a verified safe destination.",
        });
      }
      const requiredCapabilities = summary.safeCount > 0
        ? [...DUPLICATE_ROUTE_READ_CAPABILITIES, ...DUPLICATE_ROUTE_MOVE_CAPABILITIES]
        : DUPLICATE_ROUTE_READ_CAPABILITIES;
      return {
        requiredCapabilities,
        blockers,
        fingerprints,
        explanation: [
          "Only the listed moves to Club or SBC Storage can run.",
          "SBC submission, pack opening, and quicksell are outside this plan.",
        ],
        preview: {
          ...summary,
          status: blockers.length ? "blocked" : summary.status,
          safetyBoundary: "SAFE_ITEM_MOVES_ONLY",
        },
        steps: blockers.length || summary.safeCount === 0 ? [] : [{
          type: "CALL_EXISTING_SERVICE",
          service: "workflow",
          command: "RESOLVE_APPROVED_UNASSIGNED",
          approvedActions: summary.approvedActions,
          routeActions: summary.routeActions,
          expectedUnassignedItemIdsBefore: summary.expectedUnassignedItemIdsBefore,
          expectedRemainingItemIdsAfter: summary.expectedRemainingItemIdsAfter,
          actionSetFingerprint: summary.actionSetFingerprint,
        }],
      };
    };
    strategy.requiredCapabilities = DUPLICATE_ROUTE_READ_CAPABILITIES;
    const compiler = new PlanCompiler({
      capabilityRegistry: evidence.capabilityRegistry,
      entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
      strategies: { [GoalKind.CLEAR_DUPLICATES]: strategy },
      compilerVersion: 2,
    });
    const goal = createGoal({
      kind: GoalKind.CLEAR_DUPLICATES,
      intent: "Preview one bounded safe route for current Unassigned items",
      inputs: { policyVersion: evidence.policy.schemaVersion },
      createdAt: 0,
    });
    const plan = await compiler.compile(goal, evidence.gameContext);
    this.duplicateRoutePlanCache.clear();
    this.duplicateRoutePlanCache.set(plan.id, plan);
    this.state.duplicateRoutePlan = plan;
    this.state.duplicateRouteNotice = null;
    this.state.routerRecommendation = routerRecommendation;
    this.state.routerRecommendationNotice = null;
    this.logger.info("Duplicate Preview", plan.state === "ready"
      ? "Built a safe duplicate route preview; no cards were changed"
      : "Duplicate route preview blocked safely", {
      planId: plan.id,
      safeMoves: plan.preview?.safeCount || 0,
      attention: plan.preview?.attentionCount || 0,
      blockerCodes: plan.blockers.map((blocker) => blocker.code),
      routerState: routerRecommendation.state,
      routerKind: routerRecommendation.outcome.kind,
      routerReason: routerRecommendation.outcome.reasonCode,
    });
    this.emit();
    return plan;
  }

  buildFodderReviewEvidence() {
    const inventorySnapshot = this.inventory.getSnapshot();
    const items = inventorySnapshot.items || [];
    const verifiedWhenComplete = (field) =>
      items.length > 0 && items.every((item) => item?.[field] === true)
        ? "verified"
        : "unverified";
    const startingSquadState = verifiedWhenComplete("hasStartingSquadEvidence");
    const sourceEvidence = {
      schemaVersion: 1,
      fields: {
        locked: verifiedWhenComplete("hasLockedEvidence"),
        protected: verifiedWhenComplete("hasProtectedEvidence"),
        favorite: verifiedWhenComplete("hasFavoriteEvidence"),
        special: verifiedWhenComplete("hasSpecialEvidence"),
        tradability: verifiedWhenComplete("hasTradabilityEvidence"),
        startingSquad: startingSquadState,
      },
      activeSquadProtection: {
        state: startingSquadState,
        mode: "per_item_flag",
      },
      loansIncluded: false,
    };
    const capabilityRegistry = buildRuntimeCapabilityRegistry(this.state.capabilityHealth);
    if (!this.inventoryAvailable) {
      capabilityRegistry.declare("ea.inventory.read", {
        state: "unavailable",
        reason: "A current Club snapshot is unavailable",
      });
    }
    return {
      inventorySnapshot,
      policy: this.createFodderPolicy(),
      targetProjects: this.targets,
      capabilityRegistry,
      capabilitySnapshot: capabilityRegistry.snapshot(),
      gameContext: this.currentGameContext(),
      sourceEvidence,
    };
  }

  async previewFodderReview() {
    await this.refreshStatus();
    const evidence = this.buildFodderReviewEvidence();
    const strategy = async () => buildFodderReview(evidence);
    strategy.requiredCapabilities = FODDER_REVIEW_CAPABILITIES;
    const compiler = new PlanCompiler({
      capabilityRegistry: evidence.capabilityRegistry,
      entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
      strategies: { [GoalKind.OPTIMIZE_FODDER]: strategy },
      compilerVersion: 2,
    });
    const goal = createGoal({
      kind: GoalKind.OPTIMIZE_FODDER,
      intent: "Review current card protection and local squad preferences",
      inputs: { scope: "current_inventory", reviewSchemaVersion: 1 },
      createdAt: 0,
    });
    const plan = await compiler.compile(goal, evidence.gameContext);
    this.state.fodderReviewPlan = plan;
    this.logger.info("Card protection", plan.state === "ready"
      ? "Reviewed current protection; no cards were changed"
      : "Protection review is unavailable with current evidence", {
      planId: plan.id,
      verificationState: plan.preview?.verificationState || "blocked",
      protectedCount: plan.preview?.uniqueHardProtectedCount ?? null,
      blockerCodes: plan.blockers.map((blocker) => blocker.code),
    });
    this.emit();
    return plan;
  }

  async approveDuplicateRoute(planId) {
    if (this.duplicateRouteApprovalInFlight) {
      const error = new Error("A duplicate-route approval is already being checked");
      error.code = "DUPLICATE_APPROVAL_IN_FLIGHT";
      throw error;
    }
    this.duplicateRouteApprovalInFlight = true;
    try {
    const expected = this.duplicateRoutePlanCache.get(String(planId || ""));
    if (!expected || expected.id !== String(planId || "") ||
        expected.state !== "ready" || expected.preview?.safeCount <= 0 ||
        expected.preview?.safetyBoundary !== "SAFE_ITEM_MOVES_ONLY") {
      const error = new Error("Preview the safe duplicate route again before approving it");
      error.code = "DUPLICATE_PLAN_NOT_APPROVABLE";
      throw error;
    }
    const active = this.engine.getSnapshot();
    if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
      const error = new Error("Finish or stop the active run before moving these items");
      error.code = "WORKFLOW_ALREADY_ACTIVE";
      throw error;
    }

    await this.refreshStatus();
    const current = this.buildDuplicateRouteEvidence();
    const comparison = compareDuplicateRouteFingerprints(
      expected.fingerprints,
      current.fingerprints,
    );
    if (!comparison.ok ||
        current.summary.actionSetFingerprint !== expected.preview.actionSetFingerprint) {
      this.duplicateRoutePlanCache.clear();
      this.state.duplicateRoutePlan = null;
      this.state.duplicateRouteNotice =
        "Unassigned items, destinations, or EA capabilities changed. Preview again.";
      this.invalidateRouterRecommendation(
        "Unassigned items, destinations, or EA capabilities changed. Nothing moved.",
      );
      this.logger.warn("Duplicate Approval", "Stale duplicate route rejected", {
        changedEvidence: comparison.changed,
      });
      this.emit();
      return { started: false, stale: true, changed: comparison.changed };
    }

    const preview = expected.preview;
    const definition = {
      id: `fut-magic-duplicates-${expected.id}`,
      name: `Move ${preview.safeCount} safe item${preview.safeCount === 1 ? "" : "s"}`,
      version: 1,
      metadata: {
        source: "fut-magic-duplicate-route",
        planId: expected.id,
        safetyModel: "exact-refresh-verify-move",
      },
      steps: [{
        id: "approved-safe-item-moves",
        type: WorkflowStepType.RESOLVE_ITEMS,
        config: {
          approvedActions: preview.approvedActions,
          approvedRouteActions: preview.routeActions,
          expectedUnassignedItemIdsBefore: preview.expectedUnassignedItemIdsBefore,
          expectedRemainingItemIdsAfter: preview.expectedRemainingItemIdsAfter,
          resolutionPolicy: current.policy,
          actionSetFingerprint: preview.actionSetFingerprint,
          allowPartial: false,
          allowUnresolved: preview.expectedRemainingItemIdsAfter.length > 0,
        },
        timeoutMs: 45_000,
        retryPolicy: { maxAttempts: 1 },
        onFailure: "PAUSE",
      }],
    };
    this.state.maxIterations = 1;
    await this.engine.start(definition, {
      mode: WorkflowMode.AUTO,
      approval: createAutoApproval(definition),
    });
    this.duplicateRoutePlanCache.clear();
    this.state.duplicateRoutePlan = null;
    this.state.duplicateRouteNotice = null;
    this.invalidateRouterRecommendation();
    this.state.routerRecommendationNotice = null;
    this.logger.info("Duplicate Approval", "Approved one exact set of safe item moves", {
      planId: expected.id,
      safeMoves: preview.safeCount,
    });
    queueMicrotask(() => this.drive());
    this.emit();
    return { started: true, runId: this.engine.getSnapshot()?.runId || null };
    } finally {
      this.duplicateRouteApprovalInFlight = false;
    }
  }

  buildSbcPlanningEvidence(projectId) {
    const project = this.targets
      .list()
      .find((candidate) => String(candidate.id) === String(projectId));
    if (!project) {
      const error = new Error("The selected Target Project no longer exists");
      error.code = "PROJECT_NOT_FOUND";
      throw error;
    }
    const inventorySnapshot = this.inventory.getSnapshot();
    const policy = this.createFodderPolicy();
    const analysis = policy.analyze(inventorySnapshot.items);
    const policySnapshot = {
      protectedItemIds: [...analysis.protectedItemIds].map(String).sort(),
      reasonsByItemId: analysis.reasonsByItemId,
      activeTargetProjectIds: [...analysis.activeTargetProjectIds].map(String).sort(),
      conservationPolicy: policy.toSolverConservationPolicy(),
    };
    const capabilityRegistry = buildRuntimeCapabilityRegistry(
      this.state.capabilityHealth,
    );
    if (!this.inventoryAvailable) {
      capabilityRegistry.declare("ea.inventory.read", {
        state: "unavailable",
        reason: "A current Club snapshot is unavailable",
      });
    }
    const capabilitySnapshot = capabilityRegistry.snapshot();
    const gameContext = this.currentSbcGameContext();
    const fingerprints = buildSbcPlanFingerprints({
      gameContext,
      inventorySnapshot,
      project,
      policySnapshot,
      capabilitySnapshot,
    });
    return {
      project,
      inventorySnapshot,
      policy,
      analysis,
      capabilityRegistry,
      capabilitySnapshot,
      gameContext,
      fingerprints,
    };
  }

  async previewSbcProject(projectId) {
    await this.refreshStatus();
    const evidence = this.buildSbcPlanningEvidence(projectId);
    const strategy = async () => {
      const { project, gameContext, inventorySnapshot, policy, analysis, fingerprints } = evidence;
      const challenge = projectChallengeForContext(project, gameContext);
      const blockers = [];
      if (String(project.sourceSetId || "") !== String(gameContext.setId || "")) {
        blockers.push({
          code: "OPEN_PROJECT_REQUIRED",
          message: "Open this project's SBC set in EA before previewing a squad.",
        });
      } else if (!challenge) {
        blockers.push({
          code: "CURRENT_CHALLENGE_NOT_IN_PROJECT",
          message: "The open challenge is not mapped to this Target Project.",
        });
      } else if (challenge.completed) {
        blockers.push({
          code: "CHALLENGE_COMPLETED",
          message: "The open challenge is already complete.",
        });
      } else if (challenge.unknownRequirements?.length) {
        blockers.push({
          code: "UNKNOWN_REQUIREMENTS",
          message: "EA exposed requirements that FUT Magic cannot verify safely.",
          count: challenge.unknownRequirements.length,
        });
      }

      const basePreview = {
        status: blockers.length ? "blocked" : "planning",
        projectId: project.id,
        setId: project.sourceSetId,
        challengeId: challenge?.id || gameContext.challengeId,
        challengeName: challenge?.name || gameContext.challengeName || "Open challenge",
        targetRating: challenge?.requiredSquadRating ?? null,
      };
      if (blockers.length) {
        return {
          requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
          blockers,
          fingerprints,
          preview: basePreview,
        };
      }

      let solution;
      try {
        solution = await this.adapter.solveCurrentSbc({
          previewOnly: true,
          protectedItemIds: analysis.protectedItemIds,
          conservationPolicy: {
            ...policy.toSolverConservationPolicy(),
            protectedItemIds: analysis.protectedItemIds,
          },
          prioritize: {
            duplicates: this.config.preferDuplicates !== false,
            untradeables: this.config.preferUntradeables !== false,
            storage: this.config.preferSbcStorage !== false,
          },
          solverSettings: { ...(this.config.solverSettings || {}) },
        });
      } catch (error) {
        return {
          requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
          blockers: [{
            code: String(error?.code || "NO_VERIFIED_SOLUTION"),
            message: String(error?.message || "No verified squad solution is available."),
          }],
          fingerprints,
          preview: { ...basePreview, status: "blocked" },
        };
      }

      const summary = summarizeSbcSolution({
        solution,
        inventorySnapshot,
        protectedItemIds: analysis.protectedItemIds,
      });
      if (!summary.solved || summary.selectedCount !== 11) {
        blockers.push({
          code: "NO_VERIFIED_SOLUTION",
          message: "The solver did not return a submit-ready 11-card squad.",
        });
      }
      if (summary.unobservedItemIds.length) {
        blockers.push({
          code: "SOLUTION_ITEMS_UNOBSERVED",
          message: "The preview referenced cards outside the current Club snapshot.",
        });
      }
      if (summary.protectedViolations.length) {
        blockers.push({
          code: "PROTECTED_ITEM_SELECTED",
          message: "The preview included a protected card.",
        });
      }
      const explanation = policy.explainSelection(
        solution.solutionIds,
        inventorySnapshot.items,
        { targetRating: challenge.requiredSquadRating },
      );
      return {
        requiredCapabilities: SBC_PREVIEW_CAPABILITIES,
        blockers,
        fingerprints,
        explanation: explanation.explanations,
        preview: {
          ...basePreview,
          status: blockers.length ? "blocked" : "ready",
          solved: summary.solved,
          selectedCount: summary.selectedCount,
          cards: summary.cards,
          ratingRange: summary.ratingRange,
          specialCount: summary.specialCount,
          duplicateCount: summary.duplicateCount,
          storageCount: summary.storageCount,
          protectedCount: analysis.protectedItemIds.length,
          selectedProtectedCount: summary.selectedProtectedCount,
          objectiveTuple: summary.objectiveTuple,
        },
        steps: blockers.length ? [] : [{
          type: "CALL_EXISTING_SERVICE",
          service: "workflow",
          command: "COMPLETE_CURRENT_SBC",
          projectId: project.id,
          setId: project.sourceSetId,
          challengeId: challenge.id,
        }],
      };
    };
    strategy.requiredCapabilities = SBC_PREVIEW_CAPABILITIES;
    const compiler = new PlanCompiler({
      capabilityRegistry: evidence.capabilityRegistry,
      entitlementService: new EntitlementService({ plan: ProductPlan.FREE }),
      strategies: { [GoalKind.COMPLETE_SBC]: strategy },
      compilerVersion: 2,
    });
    const goal = createGoal({
      kind: GoalKind.COMPLETE_SBC,
      intent: "Preview a protected squad for the open challenge",
      inputs: { projectId: evidence.project.id },
      createdAt: 0,
    });
    const plan = await compiler.compile(goal, evidence.gameContext);
    this.sbcPlanCache.set(String(projectId), plan);
    this.state.sbcPlanPreviews = {
      ...this.state.sbcPlanPreviews,
      [String(projectId)]: plan,
    };
    this.state.sbcPlanNotices = {
      ...this.state.sbcPlanNotices,
      [String(projectId)]: null,
    };
    this.logger.info("SBC Preview", plan.state === "ready"
      ? "Built a protected squad preview; no cards were changed"
      : "Squad preview blocked safely", {
      projectId: String(projectId),
      planId: plan.id,
      blockerCodes: plan.blockers.map((blocker) => blocker.code),
    });
    this.emit();
    return plan;
  }

  async approveSbcPlan(projectId, planId) {
    const key = String(projectId || "");
    const expected = this.sbcPlanCache.get(key);
    if (!expected || expected.id !== String(planId || "") || expected.state !== "ready") {
      const error = new Error("Preview this squad again before approving it");
      error.code = "SBC_PLAN_NOT_APPROVABLE";
      throw error;
    }
    const active = this.engine.getSnapshot();
    if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
      const error = new Error("Finish or stop the active run before approving this squad");
      error.code = "WORKFLOW_ALREADY_ACTIVE";
      throw error;
    }

    await this.refreshStatus();
    const current = this.buildSbcPlanningEvidence(key);
    const comparison = compareSbcPlanFingerprints(expected.fingerprints, current.fingerprints);
    if (!comparison.ok) {
      this.sbcPlanCache.delete(key);
      const nextPreviews = { ...this.state.sbcPlanPreviews };
      delete nextPreviews[key];
      this.state.sbcPlanPreviews = nextPreviews;
      this.state.sbcPlanNotices = {
        ...this.state.sbcPlanNotices,
        [key]: "Club, protections, project, capabilities, or the open EA squad changed. Preview again.",
      };
      this.logger.warn("SBC Approval", "Stale squad preview rejected", {
        projectId: key,
        changedEvidence: comparison.changed,
      });
      this.emit();
      return { started: false, stale: true, changed: comparison.changed };
    }

    const preview = expected.preview;
    const definition = {
      id: `fut-magic-sbc-${expected.id}`,
      name: `Complete ${preview?.challengeName || "open SBC"}`,
      version: 1,
      metadata: {
        source: "fut-magic-sbc-plan",
        planId: expected.id,
        projectId: key,
        safetyModel: "refresh-re-solve-verify-submit",
      },
      steps: [
        {
          id: "approved-sbc-solve",
          type: WorkflowStepType.SOLVE_SBC,
          config: {
            target: {
              kind: "SPECIFIC_CHALLENGE",
              setId: preview.setId,
              challengeId: preview.challengeId,
            },
          },
          timeoutMs: 120_000,
          retryPolicy: { maxAttempts: 1 },
          onFailure: "PAUSE",
        },
        {
          id: "approved-sbc-submit",
          type: WorkflowStepType.SUBMIT_SBC,
          timeoutMs: 30_000,
          retryPolicy: { maxAttempts: 1 },
          onFailure: "PAUSE",
        },
      ],
    };
    this.state.maxIterations = 1;
    await this.engine.start(definition, {
      mode: WorkflowMode.AUTO,
      approval: createAutoApproval(definition),
    });
    this.sbcPlanCache.delete(key);
    const nextPreviews = { ...this.state.sbcPlanPreviews };
    delete nextPreviews[key];
    this.state.sbcPlanPreviews = nextPreviews;
    this.state.sbcPlanNotices = { ...this.state.sbcPlanNotices, [key]: null };
    this.logger.info("SBC Approval", "Approved one refreshed, verified squad submission", {
      projectId: key,
      planId: expected.id,
    });
    queueMicrotask(() => this.drive());
    this.emit();
    return { started: true, runId: this.engine.getSnapshot()?.runId || null };
  }

  stopConditionTriggered(condition, context) {
    const type = String(condition?.type ?? "").trim().toUpperCase();
    if (type === "UNRESOLVED_UNASSIGNED") {
      return Number(context.unresolvedUnassigned ?? 0) > 0;
    }
    if (type === "STORAGE_FULL") {
      return Number(context.storageFreeSlots ?? 0) <= 0;
    }
    if (type === "REQUIRED_SPECIAL_MISSING") {
      if (context.inventoryAvailable !== true) {
        throw new Error(
          context.inventoryUnavailableReason ||
            "Current inventory is unavailable for required-special evaluation",
        );
      }
      const requestedTypes = condition?.requiredSpecialTypes ?? condition?.cardTypes;
      if (requestedTypes != null) {
        if (!Array.isArray(requestedTypes)) {
          throw new TypeError("Required special types must be an array");
        }
        const normalizedTypes = new Set(
          requestedTypes.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
        );
        if (normalizedTypes.size) {
          if (!Array.isArray(context.requiredSpecialCardTypes)) {
            throw new Error("Current special-card types are unavailable");
          }
          return !context.requiredSpecialCardTypes.some((cardType) =>
            normalizedTypes.has(cardType),
          );
        }
      }
      const requiredSpecialCount = Number(context.requiredSpecialCount);
      return !Number.isSafeInteger(requiredSpecialCount) || requiredSpecialCount <= 0;
    }
    if (type === "CONDITION") return evaluateCondition(condition.condition, context);
    if (["COMPARE", "ALL", "ANY", "NOT", "TRUTHY", "EXISTS"].includes(type)) {
      return evaluateCondition(condition, context);
    }
    // An unknown persisted stop condition is a schema mismatch, not permission
    // to continue an AUTO run.
    return true;
  }

  async evaluateRunGate({ run, node }) {
    const versionSensitiveSteps = new Set([
      WorkflowStepType.SOLVE_SBC,
      WorkflowStepType.SUBMIT_SBC,
      WorkflowStepType.CLAIM_REWARD,
      WorkflowStepType.OPEN_REWARD_PACK,
      WorkflowStepType.RESOLVE_ITEMS,
      WorkflowStepType.ORGANIZE_ITEMS,
      WorkflowStepType.HANDLE_PLAYER_PICK,
    ]);
    if (versionSensitiveSteps.has(node?.step?.type)) {
      const gameContext = await this.refreshGameContext();
      if (gameContext.gameVersion !== GameVersion.FC26) {
        return {
          allowed: false,
          code: gameContext.gameVersion === GameVersion.FC27
            ? "GAME_VERSION_UNSUPPORTED"
            : "GAME_CONTEXT_UNVERIFIED",
          message: gameContext.gameVersion === GameVersion.FC27
            ? "FC 27 is observe-only in this build. No workflow action was run."
            : "The active EA game version could not be verified. No workflow action was run.",
        };
      }
      if (gameContext.state !== "verified") {
        return {
          allowed: false,
          code: "GAME_CONTEXT_UNVERIFIED",
          message: "The current FC 26 context is not verified. No workflow action was run.",
        };
      }
    }
    const limits = this.config.runLimits || { maxIterations: this.config.maxIterations };
    const cleanupStep = [WorkflowStepType.HANDLE_PLAYER_PICK, WorkflowStepType.RESOLVE_ITEMS, WorkflowStepType.ORGANIZE_ITEMS].includes(node?.step?.type);
    const completed = (type) =>
      (run?.nodes || []).filter(
        (entry) => entry.step?.type === type && entry.status === "completed",
      ).length;
    const checks = [
      [limits.maxIterations != null && Number(run?.counters?.loopIterations || 0) > Number(limits.maxIterations), "Maximum workflow iterations reached"],
      [limits.maxSbcSubmissions != null && [WorkflowStepType.SOLVE_SBC, WorkflowStepType.SUBMIT_SBC].includes(node?.step?.type) && completed(WorkflowStepType.SUBMIT_SBC) >= Number(limits.maxSbcSubmissions), "Maximum SBC submissions reached"],
      [limits.maxPacksOpened != null && !cleanupStep && completed(WorkflowStepType.OPEN_REWARD_PACK) >= Number(limits.maxPacksOpened), "Maximum opened packs reached"],
      [limits.maxDurationMinutes != null && !cleanupStep && Date.now() - Number(run?.createdAt || Date.now()) >= Number(limits.maxDurationMinutes) * 60_000, "Maximum workflow duration reached"],
    ];
    const reached = checks.find(([blocked]) => blocked);
    if (reached) return { allowed: false, code: "RUN_LIMIT_REACHED", message: reached[1] };
    const context = this.conditionContext(run);
    for (const condition of this.config.stopConditions || []) {
      try {
        if (!cleanupStep && this.stopConditionTriggered(condition, context)) {
          return { allowed: false, code: "STOP_CONDITION_REACHED", message: `Stop condition reached: ${condition.type}` };
        }
      } catch (error) {
        return { allowed: false, code: "STOP_CONDITION_INVALID", message: error?.message || "Stop condition could not be evaluated" };
      }
    }
    if (
      run?.mode === WorkflowMode.REVIEW &&
      node?.step?.type === WorkflowStepType.HANDLE_PLAYER_PICK
    ) {
      return { allowed: true };
    }
    return evaluateWorkflowModeGate({ run, node });
  }

  currentPickPolicy() {
    return {
      type: this.config.pickMode || "PAUSE_FOR_USER",
      ...(this.config.pickPolicy || {}),
    };
  }

  playerPickContext() {
    let items = [];
    try { items = this.inventory.getSnapshot().items; } catch {}
    const duplicateResourceIds = this.inventoryAvailable
      ? this.inventory.getDuplicateGroups().flatMap((group) =>
          group.items.map((item) => item.resourceId).filter(Boolean),
        )
      : [];
    const overlay = this.targets.getFodderPolicyOverlay();
    return {
      existingResourceIds: items.map((item) => item.resourceId).filter(Boolean),
      duplicateResourceIds,
      duplicateItemIds: items.filter((item) => item.isDuplicate).map((item) => item.itemId),
      requiredSpecialTypes: Object.keys(overlay.specialReserveByCardType || {}),
      activeTargetProjectIds: overlay.activeProjectIds || [],
    };
  }

  conditionContext(runOverride = null) {
    const inventory = this.inventory.getStatus();
    let snapshot = null;
    let inventoryUnavailableReason = null;
    try {
      snapshot = this.inventory.getSnapshot();
    } catch (error) {
      inventoryUnavailableReason =
        error?.message || "Current inventory snapshot is unavailable";
    }
    const inventoryAvailable =
      this.inventoryAvailable === true &&
      snapshot?.updatedAt != null &&
      Array.isArray(snapshot?.items);
    const specialItems = inventoryAvailable
      ? snapshot.items.filter((item) => item?.isSpecial === true)
      : [];
    const run = runOverride || this.engine?.getSnapshot();
    return { inventory, workflowIterations: run?.counters?.loopIterations || 0,
      storageFreeSlots: inventory.storageFreeSlots, unresolvedUnassigned: inventory.unassignedCount,
      inventoryAvailable, requiredSpecialCount: inventoryAvailable ? specialItems.length : null,
      inventoryUnavailableReason,
      requiredSpecialCardTypes: inventoryAvailable
        ? specialItems.flatMap((item) => [item.cardType, item.rarityName, ...(item.specialGroups || [])])
          .map((value) => String(value ?? "").trim().toLowerCase())
          .filter(Boolean)
        : null };
  }

  getState() { return structuredClone(this.state); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  emit() { this.state.productRevision += 1; const snapshot=this.getState(); for(const listener of this.listeners) listener(snapshot); }

  onRun(run) {
    if (!run) return;
    if (![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(run.status)) {
      this.invalidateDuplicateRoutePreview(
        "Activity Guard changed while a workflow was active. Preview again.",
      );
    }
    this.invalidateRouterRecommendation(
      "Activity Guard changed while a workflow was active. Check again.",
    );
    const node = run.nodes?.[run.cursor];
    const completed = (type) => run.nodes.filter((entry) => entry.step?.type === type && entry.status === "completed");
    this.state.runStatus = run.status; this.state.currentStep = node?.step?.type || null;
    this.state.runName = run.definition?.name || "FUT Magic run";
    this.state.runModeLabel = run.mode === WorkflowMode.REVIEW
      ? "Preview only"
      : run.mode === WorkflowMode.ASSISTED
        ? "Ask before each action"
        : "Approved plan";
    this.state.iterations = run.counters?.loopIterations || 0; this.state.maxIterations = this.config.maxIterations;
    this.state.sbcCompleted = completed(WorkflowStepType.SUBMIT_SBC).length;
    this.state.packsOpened = completed(WorkflowStepType.OPEN_REWARD_PACK).length;
    this.state.picksCompleted = completed(WorkflowStepType.HANDLE_PLAYER_PICK).filter(
      (entry) => entry.result?.pending !== false,
    ).length;
    this.state.duplicatesRecycled = completed(WorkflowStepType.RESOLVE_ITEMS).reduce((sum, entry) => sum + Number(entry.result?.movedToStorage?.length || 0), 0);
    this.state.pauseReason = run.pauseReason?.message || null;
    this.state.error = run.lastError?.message || null;
    const timelineTypes = [
      WorkflowStepType.SOLVE_SBC,
      WorkflowStepType.SUBMIT_SBC,
      WorkflowStepType.CLAIM_REWARD,
      WorkflowStepType.OPEN_REWARD_PACK,
      WorkflowStepType.HANDLE_PLAYER_PICK,
      WorkflowStepType.RESOLVE_ITEMS,
      WorkflowStepType.ORGANIZE_ITEMS,
    ];
    this.state.timeline = timelineTypes.map((type) => {
      const entries = run.nodes.filter((entry) => entry.step?.type === type);
      const active = entries.find((entry) => entry.executionId === node?.executionId);
      const latest = active || entries.at(-1);
      return { type, status: latest?.status || "pending", active: Boolean(active) };
    });
    this.state.analytics = summarizeRunAnalytics(run);
    this.emit();
    if (run.status === RunStatus.RUNNING) queueMicrotask(() => this.drive());
    if (run.status === RunStatus.WAITING) this.scheduleWake(run);
  }

  async drive() {
    if (this.drivePromise) return this.drivePromise;
    this.drivePromise = this.engine.runUntilBlocked({ maxTransitions: 200 }).catch((error) => this.reportUiError(error)).finally(() => { this.drivePromise = null; });
    return this.drivePromise;
  }

  scheduleWake(run) {
    clearTimeout(this.wakeTimer);
    const node=run.nodes?.[run.cursor]; const delay=Math.max(0, Number(node?.waitUntil || Date.now())-Date.now());
    this.wakeTimer=setTimeout(()=>this.drive(), Math.min(delay+20, 2_147_000_000));
  }

  async start(config) {
    const previous = this.config || this.defaultConfig();
    const ceilings = previous.profileCeilings || null;
    const requestedIterations = Math.max(1, Math.min(1000, Math.trunc(config.maxIterations || previous.maxIterations || 1)));
    const maxIterations = ceilings?.maxIterations == null
      ? requestedIterations
      : Math.min(requestedIterations, Number(ceilings.maxIterations));
    const requestedLimits = { ...(previous.runLimits || {}), ...(config.runLimits || {}), maxIterations };
    if (ceilings) {
      for (const field of ["maxSbcSubmissions", "maxPacksOpened", "maxDurationMinutes"]) {
        if (ceilings[field] != null) {
          requestedLimits[field] = requestedLimits[field] == null
            ? Number(ceilings[field])
            : Math.min(Number(requestedLimits[field]), Number(ceilings[field]));
        }
      }
    }
    this.config = {
      ...this.defaultConfig(),
      ...previous,
      ...config,
      workflow: finalizeWorkflowDraft(config.workflow || this.state.workflowDraft || buildWorkflow(config)),
      maxIterations,
      runLimits: requestedLimits,
    };
    this.config.maxPacks = Math.max(1, Math.min(100, Math.trunc(this.config.maxPacks || 1)));
    if (ceilings?.maxPacks != null) this.config.maxPacks = Math.min(this.config.maxPacks, Number(ceilings.maxPacks));
    this.state.storageCapacity = Math.max(1, Math.min(100, Math.trunc(this.config.storageCapacity || 100)));
    const definition = this.config.workflow || buildWorkflow(this.config);
    let approval = null;
    if (this.config.mode === WorkflowMode.AUTO) {
      const summary = [`Workflow: ${definition.name}`, `Iterations: ${this.config.maxIterations}`, `Max submissions: ${requestedLimits.maxSbcSubmissions ?? "workflow bound"}`, `Max opened packs: ${requestedLimits.maxPacksOpened ?? "workflow bound"}`, `Max duration: ${requestedLimits.maxDurationMinutes ? `${requestedLimits.maxDurationMinutes} min` : "workflow bound"}`, `Protected rating: ${this.config.protectRatingAtOrAbove}+`, `Protected types: ${this.config.protectedCardTypes.join(", ") || "none"}`, `Packs: ${this.config.packMode}, max ${this.config.maxPacks} per step (owned rewards only)`, `Duplicates: Storage, otherwise pause`, `Player picks: ${this.config.pickMode}`].join("\n");
      if (!this.confirm(`Authorize this GrindPilot AUTO run?\n\n${summary}`)) return;
      approval = createAutoApproval(definition);
    }
    await this.storage.saveSettings(this.config);
    this.state.draft = this.config; this.state.maxIterations = this.config.maxIterations;
    await this.engine.start(definition, { mode: this.config.mode, approval });
    this.logger.info("Start", `Workflow started in ${this.config.mode} mode`, { maxIterations: this.config.maxIterations });
    await this.drive();
  }

  async recycleCards() {
    const active = this.engine.getSnapshot();
    if (
      active &&
      ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)
    ) {
      const error = new Error("Finish or stop the active workflow before recycling cards");
      error.code = "WORKFLOW_ALREADY_ACTIVE";
      throw error;
    }

    await this.refreshInventory();
    const plan = this.inventory.planUnassignedResolution({
      preferSbcStorage: this.config.preferSbcStorage !== false,
      tradableWhenStorageUnavailable: "SAFE_HOLD",
      untradeableWhenStorageUnavailable: "PAUSE",
    });
    if (!plan.actions.length) {
      this.logger.info("Recycle Cards", "No unassigned cards need recycling", null);
      return { status: "completed", result: plan };
    }
    const toClub = plan.actions.filter((action) => action.type === "SEND_TO_CLUB").length;
    const toStorage = plan.actions.filter(
      (action) => action.type === "MOVE_TO_SBC_STORAGE",
    ).length;
    const organizerTarget = plan.requiresUserAction ? await this.getOrganizerTarget() : null;

    const definition = {
      id: "recycle-cards",
      name: "Recycle Cards",
      version: 1,
      metadata: { source: "grindpilot-recycle-button", safetyModel: "fail-closed" },
      steps: [
        {
          id: "recycle-unassigned-items",
          type: WorkflowStepType.RESOLVE_ITEMS,
          config: {
            allowPartial: true,
            allowUnresolved: true,
          },
          timeoutMs: 45_000,
          retryPolicy: { maxAttempts: 1 },
          onFailure: "PAUSE",
        },
        {
          id: "organize-remaining-items",
          type: WorkflowStepType.ORGANIZE_ITEMS,
          timeoutMs: 180_000,
          retryPolicy: { maxAttempts: 1 },
          onFailure: "PAUSE",
        },
      ],
    };
    await this.engine.start(definition, {
      mode: WorkflowMode.AUTO,
      approval: createAutoApproval(definition),
    });
    this.logger.info("Recycle Cards", "Approved safe unassigned-card recycling", {
      toClub,
      toStorage,
      organizerTarget: organizerTarget?.name ?? null,
    });
    await this.drive();
    return this.engine.getSnapshot();
  }

  async getOrganizerTarget() {
    const candidates = this.targets
      .getActiveProjects()
      .filter(
        (project) =>
          project.sourceSetId &&
          (project.sourceChallenges?.length || project.sourceChallengeIds?.length),
      );
    const configuredId = String(this.config.organizerTargetProjectId ?? "");
    let project = configuredId
      ? candidates.find((entry) => String(entry.id) === configuredId)
      : null;
    if (configuredId && !project) {
      const error = new Error(
        "The selected Organizer Target Project is inactive, complete, or has no stable EA IDs",
      );
      error.code = "ORGANIZER_TARGET_UNAVAILABLE";
      throw error;
    }
    project ??= candidates.find((entry) => /85\s*[x×]\s*10/i.test(entry.name));
    project ??= candidates[0] ?? null;
    if (!project) {
      const target = await this.adapter.findSbcTarget({
        preferredNames: ["10x 85+ Upgrade", "85x10"],
      });
      return {
        projectId: null,
        name: target.name || "10x 85+ Upgrade",
        setId: target.setId,
        challengeId: target.challengeId,
      };
    }
    const challenge =
      project.sourceChallenges?.find((entry) => entry.completed !== true) ?? null;
    const challengeId = challenge?.id ?? project.sourceChallengeIds?.[0] ?? null;
    if (!challengeId) {
      const error = new Error("The Organizer target has no incomplete mapped challenge");
      error.code = "ORGANIZER_CHALLENGE_REQUIRED";
      throw error;
    }
    return {
      projectId: project.id,
      name: project.name,
      setId: project.sourceSetId,
      challengeId,
    };
  }

  async saveOrganizerSettings(projectId = null) {
    this.config = {
      ...this.config,
      organizerTargetProjectId: projectId ? String(projectId) : null,
    };
    this.state.draft = this.config;
    await this.storage.saveSettings(this.config);
    this.emit();
    return { organizerTargetProjectId: this.config.organizerTargetProjectId };
  }

  async listQuickOpenPacks() {
    const plan = await this.packService.plan({
      policy: { mode: "OPEN_ALL_ALLOWED_PACKS", maxPacks: 100 },
    });
    return plan.packs.map((pack) => ({ ...pack }));
  }

  async quickOpenPack(selection = null) {
    const active = this.engine.getSnapshot();
    if (
      active &&
      ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)
    ) {
      const error = new Error("Finish or stop the active workflow before opening a pack");
      error.code = "WORKFLOW_ALREADY_ACTIVE";
      throw error;
    }
    await this.refreshInventory();
    const requestedPackId = String(
      typeof selection === "object" ? selection?.packId ?? "" : selection ?? "",
    );
    const plan = await this.packService.plan({
      policy: {
        mode: "OPEN_ALL_ALLOWED_PACKS",
        maxPacks: 1,
        ...(requestedPackId ? { allowedPackIds: [requestedPackId] } : {}),
      },
    });
    if (plan.packs.length !== 1) {
      const error = new Error("No uniquely selected owned pack is ready to open safely");
      error.code = "QUICK_OPEN_PACK_UNAVAILABLE";
      throw error;
    }
    const pack = plan.packs[0];
    const packId = String(pack?.packId ?? pack?.id ?? "");
    const label = String(pack?.name ?? pack?.packName ?? pack?.type ?? packId);
    if (!requestedPackId && !this.confirm(`Open ${label} safely?\n\nOnly this already-owned pack will be opened. No purchase is allowed.`)) {
      return { status: "cancelled", result: { packId } };
    }
    const definition = {
      id: "quick-open-pack",
      name: "Open safely",
      version: 1,
      metadata: { source: "grindpilot-quick-open", safetyModel: "owned-only" },
      steps: [{
        id: "quick-open-owned-pack",
        type: WorkflowStepType.OPEN_REWARD_PACK,
        config: { quickOpen: true, packId },
        timeoutMs: 45_000,
        retryPolicy: { maxAttempts: 1 },
        onFailure: "PAUSE",
      }],
    };
    await this.engine.start(definition, {
      mode: WorkflowMode.AUTO,
      approval: createAutoApproval(definition),
    });
    this.logger.info("Open safely", "Approved one verified owned pack", { packId });
    await this.drive();
    return this.engine.getSnapshot();
  }

  async pause() { await this.engine.pause({ reason: "Paused by user" }); }
  async stop() { clearTimeout(this.wakeTimer); await this.engine.stop({ reason: "Stopped by user" }); }
  async resume() {
    const run=this.engine.getSnapshot(); const current=run?.nodes?.[run.cursor];
    if (run?.status === RunStatus.RECOVERY_REQUIRED) {
      const error = new Error("The interrupted destructive step must be reconciled before this run can resume");
      error.code = "RECOVERY_RECONCILIATION_REQUIRED";
      throw error;
    }
    let approveCurrent=false;
    if(run?.mode===WorkflowMode.ASSISTED && current && [WorkflowStepType.SUBMIT_SBC,WorkflowStepType.CLAIM_REWARD,WorkflowStepType.OPEN_REWARD_PACK,WorkflowStepType.RESOLVE_ITEMS,WorkflowStepType.ORGANIZE_ITEMS,WorkflowStepType.HANDLE_PLAYER_PICK].includes(current.step.type)) {
      approveCurrent=this.confirm(`Approve destructive step ${current.step.type}?`); if(!approveCurrent)return;
    }
    await this.engine.resume({ approveCurrent, retryCurrent: current?.status==="failed" });
    await this.drive();
  }

  async refreshStatus() {
    try { const health=await this.adapter.health(); this.state.bridgeHealth=health.eaReady ? "healthy" : "initializing"; this.state.error=null; }
    catch(error){ this.state.bridgeHealth="unavailable"; this.state.error=error.message; }
    try {
      await this.refreshInventory();
    } catch (error) {
      this.state.error = this.state.error || `Inventory refresh failed: ${error?.message || error}`;
    }
    await this.refreshGameContext();
    try { this.state.capabilityHealth = await this.adapter.getCapabilityHealth(); }
    catch (error) {
      this.state.capabilityHealth = (Array.isArray(this.state.capabilityHealth)
        ? this.state.capabilityHealth
        : [])
        .filter((entry) => String(entry?.id || "").trim())
        .map((entry) => ({ id: entry.id, status: "UNAVAILABLE", evidence: null }));
      this.state.error = this.state.error || `Capability refresh failed: ${error?.message || error}`;
    }
    this.emit(); return this.getState();
  }

  async refreshInventory() {
    if (this.inventoryRefreshPromise) return this.inventoryRefreshPromise;
    this.inventoryRefreshPromise = (async () => {
      this.inventoryAvailable = false;
      this.state.inventoryAvailable = false;
      this.state.fodderReviewPlan = null;
      this.invalidateDuplicateRoutePreview(
        "Club or Unassigned evidence was refreshed. Preview the safe route again.",
      );
      this.invalidateRouterRecommendation(
        "Club or Unassigned evidence was refreshed. Check the next action again.",
      );
      const raw=await this.adapter.readInventory();
      const snapshot=this.inventory.synchronize({ club:raw.club, storage:raw.storage, unassigned:raw.unassigned, storageCapacity:this.state.storageCapacity });
      this.inventoryAvailable = true;
      const status=this.inventory.getStatus();
      this.inventoryAvailable = true;
      this.state.inventoryAvailable = true;
      this.state.inventory=status;
      this.state.storageCount=status.storageCount;
      this.state.unassignedCount=status.unassignedCount;
      this.state.targetDashboard=this.targets?.getDashboard?.(snapshot.items) ?? [];
      this.state.inventoryBuckets=buildInventoryBuckets(snapshot.items);
      this.emit();
      return snapshot;
    })().finally(() => { this.inventoryRefreshPromise = null; });
    return this.inventoryRefreshPromise;
  }

  async saveDraftProfile() {
    const fodderPolicy=Object.fromEntries(["protectRatingAtOrAbove","preferredFodderRange","protectedCardTypes","allowedSpecialTypes","protectedItemIds","protectedPlayerIds","protectedResourceIds","protectedRatings","protectStartingSquad","protectFavorites","protectTradables","preferUntradeables","preferDuplicates","preferSbcStorage","minimumReserveByRating","specialReserveByCardType"].map((key)=>[key,this.config[key]]));
    const id=`profile-${Date.now()}`; const profile=await this.profileService.save({ id, name:`Grind profile ${new Date().toLocaleString()}`, automationMode:this.config.mode, workflow:this.config.workflow||buildWorkflow(this.config), solverSettings:this.config.solverSettings||{}, fodderPolicy, duplicatePolicy:{ ...(this.config.duplicatePolicy||{}), quicksell:false, unresolved:"PAUSE", storageCapacity:this.config.storageCapacity }, packPolicy:{ mode:this.config.packMode, maxPacks:this.config.maxPacks||1 }, pickPolicy:{ type:this.config.pickMode, ...(this.config.pickPolicy||{}) }, runLimits:{ ...(this.config.runLimits||{}), maxIterations:this.config.maxIterations }, stopConditions:this.config.stopConditions||[], targetProjects:this.targets.list() });
    this.state.profiles=await this.profileService.list(); this.emit(); return profile;
  }
  async loadProfile(id) { const p=await this.profileService.get(id); if(!p)return; this.config={...this.defaultConfig(),...p.fodderPolicy,mode:p.automationMode||WorkflowMode.REVIEW,workflow:p.workflow,runLimits:{...p.runLimits},maxIterations:p.runLimits.maxIterations,storageCapacity:Math.min(100,p.duplicatePolicy.storageCapacity||100),solverSettings:p.solverSettings,duplicatePolicy:p.duplicatePolicy,packMode:p.packPolicy.mode,maxPacks:p.packPolicy.maxPacks,pickMode:p.pickPolicy.type,pickPolicy:p.pickPolicy,stopConditions:p.stopConditions,loadedProfileId:p.id,profileCeilings:{...p.runLimits,maxPacks:p.packPolicy.maxPacks},protectStartingSquad:true}; this.state.storageCapacity=this.config.storageCapacity; this.state.workflowDraft=structuredClone(p.workflow); if(Array.isArray(p.targetProjects)){this.targets=new TargetProjectService(p.targetProjects);this.state.projects=this.targets.list();} this.state.draft=this.config; this.state.fodderReviewPlan=null; this.invalidateRouterRecommendation("Protection or project settings changed. Check the next action again."); this.emit(); }
  async exportCurrentProfile() { const p=this.state.profiles.at(-1) || await this.saveDraftProfile(); return this.profileService.export(p.id); }
  exportRunAnalytics() { return exportRunAnalytics(this.engine.getSnapshot()); }
  async importProfile(text) { await this.profileService.import(text,{overwrite:false}); this.state.profiles=await this.profileService.list(); this.emit(); }
  async saveProtectionSettings(input) {
    this.config = { ...this.config, ...input, protectStartingSquad: true };
    this.state.draft = this.config;
    this.state.fodderReviewPlan = null;
    this.invalidateRouterRecommendation(
      "Protection settings changed. Check the next action again.",
    );
    this.sbcPlanCache.clear();
    this.state.sbcPlanPreviews = {};
    await this.storage.saveSettings(this.config);
    this.emit();
  }
  useWorkflowTemplate(id) {
    this.state.workflowDraft = getWorkflowTemplate(id);
    this.emit();
    return this.state.workflowDraft;
  }
  addWorkflowBuilderStep(path = [], type = WorkflowStepType.SOLVE_SBC) {
    this.state.workflowDraft = addWorkflowStep(this.state.workflowDraft, path, type);
    this.emit();
  }
  deleteWorkflowBuilderStep(path, index) {
    this.state.workflowDraft = deleteWorkflowStep(this.state.workflowDraft, path, index);
    this.emit();
  }
  moveWorkflowBuilderStep(path, index, direction) {
    this.state.workflowDraft = moveWorkflowStep(this.state.workflowDraft, path, index, direction);
    this.emit();
  }
  duplicateWorkflowBuilderStep(path, index) {
    this.state.workflowDraft = duplicateWorkflowStep(this.state.workflowDraft, path, index);
    this.emit();
  }
  updateWorkflowBuilderStep(path, index, patch) {
    this.state.workflowDraft = mutateWorkflowSteps(this.state.workflowDraft, path, (steps) => {
      const current = steps[index];
      if (!current) throw new TypeError("Workflow step is no longer available");
      if (patch.type && patch.type !== current.type) {
        steps[index] = { ...createWorkflowStep(patch.type), id: current.id };
        return;
      }
      steps[index] = {
        ...current,
        ...patch,
        config: { ...(current.config || {}), ...(patch.config || {}) },
        retryPolicy: {
          ...(current.retryPolicy || {}),
          ...(patch.retryPolicy || {}),
        },
      };
    });
    this.emit();
  }
  saveWorkflowDraft() {
    const workflow = finalizeWorkflowDraft(this.state.workflowDraft);
    this.config = { ...this.config, workflow };
    this.state.draft = this.config;
    this.state.workflowDraft = workflow;
    this.emit();
    return workflow;
  }
  async refreshLegacySequences() {
    this.state.legacySequences = await this.adapter.readLegacySequences();
    this.emit();
    return this.state.legacySequences;
  }
  async importLegacySequencePlan(id) {
    const plans = this.state.legacySequences.length
      ? this.state.legacySequences
      : await this.adapter.readLegacySequences();
    const plan = plans.find((entry) => String(entry.id) === String(id)) ||
      (plans.length === 1 ? plans[0] : null);
    if (!plan) throw new TypeError("Select one legacy Sequence plan to import");
    this.state.workflowDraft = importLegacySequence(plan);
    this.emit();
    return this.state.workflowDraft;
  }
  async addTargetProject(input) {
    const name=String(input?.name||"").trim(); if(!name)throw new Error("Target project name is required");
    const project=this.targets.upsert({ id:`project-${Date.now()}`, name, active:true, priority:Math.max(0,Math.trunc(input.priority||0)), requiredSquadsRemaining:Math.max(0,Math.trunc(input.requiredSquadsRemaining||0)), protectedRatings:{ atOrAbove:input.protectRatingAtOrAbove||null }, ratingRequirements:[], specialCardRequirements:[], completionProgress:0 });
    this.state.projects=this.targets.list(); this.state.fodderReviewPlan=null; this.invalidateRouterRecommendation("Target Projects changed. Check the next action again."); await this.storage.saveProjects(this.state.projects); this.emit(); return project;
  }
  async saveTargetProject(input) {
    const project = this.targets.upsert({
      ...input,
      id: input?.id || `project-${Date.now()}`,
    });
    this.state.projects = this.targets.list();
    this.state.fodderReviewPlan = null;
    this.invalidateRouterRecommendation(
      "Target Projects changed. Check the next action again.",
    );
    let items = [];
    try { items = this.inventory.getSnapshot().items; } catch {}
    this.state.targetDashboard = this.targets.getDashboard(items);
    await this.storage.saveProjects(this.state.projects);
    this.emit();
    return project;
  }
  async importCurrentSbcProject() {
    await this.requireFc26PlanningContext({ requireSbcTarget: true });
    const snapshot = await this.adapter.readCurrentSbcProject();
    const project = this.targets.importCurrentSbc(snapshot);
    this.state.projects = this.targets.list();
    this.state.fodderReviewPlan = null;
    this.invalidateRouterRecommendation(
      "Target Projects changed. Check the next action again.",
    );
    this.state.targetDashboard = this.targets.getDashboard(
      this.inventoryAvailable ? this.inventory.getSnapshot().items : [],
    );
    await this.storage.saveProjects(this.state.projects);
    this.logger.info("Target Project", "Imported current SBC set", {
      setId: snapshot.setId,
      challenges: snapshot.challenges.length,
      unknownRequirements: snapshot.challenges.reduce(
        (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
        0,
      ),
    });
    this.emit();
    return project;
  }
  async syncTargetProject(id) {
    await this.requireFc26PlanningContext({ requireSbcTarget: true });
    const snapshot = await this.adapter.readCurrentSbcProject();
    const project = this.targets.synchronizeFromCurrentSbc(id, snapshot);
    this.state.projects = this.targets.list();
    this.state.fodderReviewPlan = null;
    this.invalidateRouterRecommendation(
      "Target Projects changed. Check the next action again.",
    );
    this.state.targetDashboard = this.targets.getDashboard(
      this.inventoryAvailable ? this.inventory.getSnapshot().items : [],
    );
    await this.storage.saveProjects(this.state.projects);
    this.emit();
    return project;
  }
  async removeTargetProject(id) { this.targets.remove(id); this.state.projects=this.targets.list(); this.state.fodderReviewPlan=null; this.invalidateRouterRecommendation("Target Projects changed. Check the next action again."); await this.storage.saveProjects(this.state.projects); this.emit(); }
  async setDeveloperMode(enabled) { enabled?this.dev.enable():this.dev.disable(); this.state.diagnostics={...this.dev.getStatus(),latest:this.state.diagnostics.latest||null}; this.emit(); }
  async takeDiagnosticSnapshot() { const health=await this.adapter.health().catch(error=>({error:error.message})); const latest=this.dev.captureSnapshot({ bridgeHealth:health,route:location.pathname,selectors:{controllerBridge:Boolean(window.eaData?.grindPilot)} }); this.state.diagnostics={...this.dev.getStatus(),latest,diff:this.dev.compareLatestSnapshots()}; this.emit(); return latest; }
  async exportDiagnostics() { return this.dev.exportDiagnostics({ healthChecks:[await this.adapter.health().catch(error=>({error:error.message}))], logs:this.logger.entries() }); }
  getProductShellViewModel() {
    return buildProductShellViewModel({
      ...this.state,
      gameContext: this.currentGameContext(),
    });
  }
  async executeProductShellCommand(command = {}) {
    const type = String(command?.type || "");
    if (type === "REFRESH") return this.refreshStatus().then(() => this.getProductShellViewModel());
    if (type === "PAUSE_RUN") await this.pause();
    else if (type === "RESUME_RUN") await this.resume();
    else if (type === "STOP_RUN") await this.stop();
    else if (type === "IMPORT_CURRENT_SBC_PROJECT") await this.importCurrentSbcProject();
    else if (type === "PREVIEW_SBC_PROJECT") {
      await this.previewSbcProject(String(command.projectId || ""));
    }
    else if (type === "APPROVE_SBC_PLAN") {
      await this.approveSbcPlan(
        String(command.projectId || ""),
        String(command.planId || ""),
      );
    }
    else if (type === "PREVIEW_CLEAR_DUPLICATES") {
      await this.previewDuplicateRoute();
    }
    else if (type === "PREVIEW_FODDER_REVIEW") {
      await this.previewFodderReview();
    }
    else if (type === "APPROVE_CLEAR_DUPLICATES_PLAN") {
      await this.approveDuplicateRoute(String(command.planId || ""));
    }
    else if (type === "OPEN_LEGACY_UI") {
      const allowed = new Set(["Easy Loop", "SBC Solver", "Workflows", "Profiles", "Inventory", "Protected Cards", "Target Projects", "Activity", "Settings", "Developer"]);
      const section = allowed.has(String(command.section)) ? String(command.section) : "Easy Loop";
      this.panel?.openSection?.(section);
    } else {
      const error = new Error("Unsupported FUT Magic surface command");
      error.code = "FUT_MAGIC_COMMAND_FORBIDDEN";
      throw error;
    }
    return this.getProductShellViewModel();
  }
  async openSidePanel() {
    return new Promise((resolve, reject) => {
      const api = globalThis.chrome?.runtime;
      if (!api?.sendMessage) {
        this.panel?.openSection?.("Easy Loop");
        resolve({ opened: false, legacy: true });
        return;
      }
      api.sendMessage({ type: "FUT_MAGIC_OPEN_PANEL_V1" }, (response) => {
        const error = api.lastError;
        if (error || !response?.ok) reject(new Error(error?.message || response?.error?.message || "FUT Magic Side Panel could not open"));
        else resolve(response.data || { opened: true });
      });
    });
  }
  reportUiError(error) { this.state.error=error?.message||String(error); this.logger.error("Error",this.state.error,{code:error?.code||null}); this.emit(); }
  persistActivity() {
    clearTimeout(this.activityTimer);
    this.activityTimer=setTimeout(()=>this.storage.saveActivity(this.logger.entries()).catch((error)=>{
      console.warn("[GrindPilot] Activity persistence failed", { code:error?.code||null, message:error?.message||String(error) });
    }),250);
  }
}

const mountGrindPilotRuntime = async () => {
  if (!globalThis.window || globalThis.window.__grindPilotRuntime) return;
  await (globalThis.__grindPilotIsolatedReady || Promise.resolve());
  const runtime = new GrindPilotRuntime();
  globalThis.window.__grindPilotRuntime = runtime;
  await runtime.initialize();
};
void mountGrindPilotRuntime().catch((error) => {
  console.error("[GrindPilot] Initialization failed", { message: error?.message, code: error?.code });
});

export { GrindPilotRuntime, buildWorkflow };
