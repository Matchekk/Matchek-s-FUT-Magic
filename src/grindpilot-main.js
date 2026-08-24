import { ActivityLogger } from "./core/activity-logger.js";
import { createDeveloperMode } from "./dev/debug-mode.js";
import { ControllerAdapter } from "./ea/controller-adapter.js";
import { PageStorageArea } from "./ea/page-storage-area.js";
import { PageWorkflowRepository } from "./ea/workflow-storage-repository.js";
import { InventoryService } from "./inventory/inventory-service.js";
import { PackService } from "./packs/pack-service.js";
import { RewardService } from "./packs/reward-service.js";
import { FodderPolicy } from "./policies/fodder-policy.js";
import { TargetProjectService } from "./policies/target-project-service.js";
import { ChromeStorageProfileRepository } from "./profiles/profile-repository.js";
import { ProfileService } from "./profiles/profile-service.js";
import { GrindPanel } from "./ui/grind-panel.js";
import {
  createAutoApproval,
  RunStatus,
  WorkflowEngine,
  WorkflowMode,
  WorkflowStepType,
} from "./workflow/index.js";

const VERSION = globalThis.document?.documentElement?.dataset?.eaDataExtensionVersion || "unknown";
const ACTIVITY_KEY = "grindpilot.activity.v1";
const PROJECTS_KEY = "grindpilot.projects.v1";
const SETTINGS_KEY = "grindpilot.settings.v1";

const outcome = (result) => ({ status: "completed", result });
const latestResult = (run, type) =>
  [...(run?.nodes ?? [])].reverse().find(
    (node) => node.step?.type === type && node.status === "completed",
  )?.result ?? null;

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
  constructor() {
    this.storage = new PageStorageArea();
    this.adapter = new ControllerAdapter();
    this.inventory = new InventoryService();
    this.logger = new ActivityLogger({ maxEntries: 500 });
    this.targets = new TargetProjectService();
    this.profileService = new ProfileService({
      repository: new ChromeStorageProfileRepository(this.storage),
    });
    this.dev = createDeveloperMode({
      root: window,
      extensionVersion: VERSION,
      capabilityDefinitions: [
        { id: "ea-bridge", path: "eaData.grindPilot", requiredMethods: ["getHealth", "solveCurrentSbc", "submitCurrentSbc"] },
      ],
      allowedNetworkOrigins: [location.origin],
    });
    this.listeners = new Set();
    this.drivePromise = null;
    this.wakeTimer = null;
    this.config = this.defaultConfig();
    this.state = {
      bridgeHealth: "checking", runStatus: "idle", currentStep: null,
      iterations: 0, maxIterations: 0, sbcCompleted: 0, packsOpened: 0,
      duplicatesRecycled: 0, protectedCardsSaved: 0, storageCount: 0,
      storageCapacity: 100, unassignedCount: 0, inventory: {}, logs: [],
      profiles: [], projects: [], diagnostics: { enabled: false }, draft: this.config,
      pauseReason: null, error: null,
    };
    this.inventoryFacade = {
      getState: async () => ({ unassigned: this.inventory.getSnapshot().unassigned.items }),
      refresh: async () => this.refreshInventory(),
    };
    this.rewardService = new RewardService({ adapter: this.adapter, logger: this.domainLogger() });
    this.packService = new PackService({ adapter: this.adapter, inventoryService: this.inventoryFacade, logger: this.domainLogger() });
    this.engine = new WorkflowEngine({
      repository: new PageWorkflowRepository(this.storage),
      handlers: this.createHandlers(),
      contextProvider: () => this.conditionContext(),
    });
    this.engine.subscribe((run) => this.onRun(run));
    this.logger.subscribe(() => { this.state.logs = this.logger.entries(); this.persistActivity(); this.emit(); });
  }

  defaultConfig() {
    return { mode: WorkflowMode.REVIEW, maxIterations: 1, protectRatingAtOrAbove: 94,
      protectedCardTypes: ["FOF"], packMode: "OPEN_CURRENT_REWARD", pickMode: "PAUSE_FOR_USER" };
  }

  domainLogger() {
    return { info: (action, data) => this.logger.info(action, action, data), warn: (action, data) => this.logger.warn(action, action, data) };
  }

  async initialize() {
    await this.loadPersistentState();
    await this.refreshStatus();
    const active = await this.engine.load();
    if (active && ![RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.FAILED].includes(active.status)) {
      await this.engine.recover(active.runId);
      this.logger.warn("Recovery", "Recovered a suspended run at a safe boundary", { runId: active.runId });
    }
    this.panel = new GrindPanel(this);
    this.emit();
  }

  async loadPersistentState() {
    const stored = await this.storage.get([ACTIVITY_KEY, PROJECTS_KEY, SETTINGS_KEY]);
    for (const entry of Array.isArray(stored[ACTIVITY_KEY]) ? stored[ACTIVITY_KEY] : []) {
      this.logger.log(entry.level || "info", entry.action || "Restored", entry.message || "", entry.data ?? null);
    }
    const projects = Array.isArray(stored[PROJECTS_KEY]) ? stored[PROJECTS_KEY] : [];
    this.targets = new TargetProjectService(projects);
    this.state.projects = this.targets.list();
    this.config = { ...this.defaultConfig(), ...(stored[SETTINGS_KEY] || {}) };
    this.state.draft = this.config;
    this.state.profiles = await this.profileService.list();
  }

  createHandlers() {
    return {
      [WorkflowStepType.SOLVE_SBC]: {
        execute: async ({ run }) => {
          await this.refreshInventory();
          const analysis = new FodderPolicy({
            protectRatingAtOrAbove: this.config.protectRatingAtOrAbove,
            protectedCardTypes: this.config.protectedCardTypes,
            protectedItemIds: this.config.protectedItemIds || [],
            protectedResourceIds: this.config.protectedResourceIds || [],
            protectStartingSquad: this.config.protectStartingSquad === true,
            protectFavorites: this.config.protectFavorites === true,
            protectTradables: this.config.protectTradables === true,
            minimumReserveByRating: this.config.minimumReserveByRating || {},
          }, { targetProjects: this.targets }).analyze(this.inventory.getSnapshot().items);
          this.currentProtectedItemIds = analysis.protectedItemIds;
          const solved = await this.adapter.solveCurrentSbc({
            previewOnly: run.mode === WorkflowMode.REVIEW,
            protectedItemIds: analysis.protectedItemIds,
          });
          this.state.protectedCardsSaved = analysis.protectedItemIds.length;
          this.logger.info("Solve", "Verified squad solution", { challengeId: solved.challengeId, protected: analysis.protectedItemIds.length });
          return outcome({ ...solved, protectedItemIds: analysis.protectedItemIds });
        },
      },
      [WorkflowStepType.SUBMIT_SBC]: {
        prepare: ({ run }) => {
          const solved = latestResult(run, WorkflowStepType.SOLVE_SBC);
          if (!solved?.submitReady) throw Object.assign(new Error("No submit-ready verified solution"), { code: "SOLUTION_NOT_READY", safeToRetry: true });
          return { expectedChallengeId: solved.challengeId, expectedItemIds: solved.solutionIds, protectedItemIds: solved.protectedItemIds || [] };
        },
        execute: async ({ intent }) => {
          const result = await this.adapter.submitCurrentSbc(intent);
          this.logger.info("Submit", "SBC submission verified", { challengeId: intent.expectedChallengeId });
          return outcome(result);
        },
      },
      [WorkflowStepType.CLAIM_REWARD]: {
        execute: async () => {
          const reward = await this.rewardService.claimAndIdentify({ source: "current-sbc" });
          this.logger.info("Reward", "Reward claimed and pack identified", { packId: reward.identifiedPackId });
          return outcome(reward);
        },
      },
      [WorkflowStepType.OPEN_REWARD_PACK]: {
        execute: async ({ run }) => {
          const reward = latestResult(run, WorkflowStepType.CLAIM_REWARD);
          const opened = await this.packService.open({ policy: { mode: this.config.packMode, maxPacks: 1 }, currentReward: reward });
          if (!opened.opened?.length) return { status: "paused", code: opened.reason || "PACK_NOT_OPENED", message: "Reward pack was not opened and verified", result: opened };
          this.logger.info("Pack", "Reward pack opened", { packId: opened.opened[0].packId });
          return outcome(opened);
        },
      },
      [WorkflowStepType.RESOLVE_ITEMS]: {
        execute: async () => {
          const result = await this.adapter.resolveUnassigned({ storageCapacity: this.state.storageCapacity });
          await this.refreshInventory();
          if (result.unresolvedUnassigned > 0) {
            this.logger.warn("Duplicate", "Unresolved items require user action", { count: result.unresolvedUnassigned });
            return { status: "paused", code: "UNRESOLVED_UNASSIGNED", message: `${result.unresolvedUnassigned} unassigned item(s) require a safe policy decision`, result };
          }
          this.logger.info("Duplicate", "Unassigned items resolved safely", { storage: result.movedToStorage?.length || 0 });
          return outcome(result);
        },
      },
      [WorkflowStepType.HANDLE_PLAYER_PICK]: {
        execute: async () => {
          const pick = await this.adapter.getPlayerPick();
          if (pick.resolved === true) return outcome({ pending: false });
          this.logger.warn("Player Pick", "Player pick requires a verified user decision", {
            policy: this.config.pickMode,
            pickId: pick.id,
          });
          return {
            status: "paused",
            code: "PLAYER_PICK_USER_REQUIRED",
            message: `Player pick detected. Intended policy: ${this.config.pickMode}. Resolve it in the Web App, then resume.`,
            result: { pickId: pick.id, policy: this.config.pickMode },
          };
        },
      },
    };
  }

  conditionContext() {
    const inventory = this.inventory.getStatus();
    const run = this.engine?.getSnapshot();
    return { inventory, workflowIterations: run?.counters?.loopIterations || 0,
      storageFreeSlots: inventory.storageFreeSlots, unresolvedUnassigned: inventory.unassignedCount };
  }

  getState() { return structuredClone(this.state); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  emit() { const snapshot=this.getState(); for(const listener of this.listeners) listener(snapshot); }

  onRun(run) {
    if (!run) return;
    const node = run.nodes?.[run.cursor];
    const completed = (type) => run.nodes.filter((entry) => entry.step?.type === type && entry.status === "completed");
    this.state.runStatus = run.status; this.state.currentStep = node?.step?.type || null;
    this.state.iterations = run.counters?.loopIterations || 0; this.state.maxIterations = this.config.maxIterations;
    this.state.sbcCompleted = completed(WorkflowStepType.SUBMIT_SBC).length;
    this.state.packsOpened = completed(WorkflowStepType.OPEN_REWARD_PACK).length;
    this.state.duplicatesRecycled = completed(WorkflowStepType.RESOLVE_ITEMS).reduce((sum, entry) => sum + Number(entry.result?.movedToStorage?.length || 0), 0);
    this.state.pauseReason = run.pauseReason?.message || null;
    this.state.error = run.lastError?.message || null;
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
    this.config = { ...this.defaultConfig(), ...config, maxIterations: Math.max(1, Math.min(1000, Math.trunc(config.maxIterations || 1))) };
    const definition = buildWorkflow(this.config);
    let approval = null;
    if (this.config.mode === WorkflowMode.AUTO) {
      const summary = [`SBC: currently open challenge`, `Iterations: ${this.config.maxIterations}`, `Protected rating: ${this.config.protectRatingAtOrAbove}+`, `Protected types: ${this.config.protectedCardTypes.join(", ") || "none"}`, `Packs: ${this.config.packMode} (owned rewards only)`, `Duplicates: Storage, otherwise pause`, `Player picks: ${this.config.pickMode}`].join("\n");
      if (!window.confirm(`Authorize this GrindPilot AUTO run?\n\n${summary}`)) return;
      approval = createAutoApproval(definition);
    }
    await this.storage.set({ [SETTINGS_KEY]: this.config });
    this.state.draft = this.config; this.state.maxIterations = this.config.maxIterations;
    await this.engine.start(definition, { mode: this.config.mode, approval });
    this.logger.info("Start", `Workflow started in ${this.config.mode} mode`, { maxIterations: this.config.maxIterations });
    await this.drive();
  }

  async pause() { await this.engine.pause({ reason: "Paused by user" }); }
  async stop() { clearTimeout(this.wakeTimer); await this.engine.stop({ reason: "Stopped by user" }); }
  async resume() {
    const run=this.engine.getSnapshot(); const current=run?.nodes?.[run.cursor];
    let approveCurrent=false;
    if(run?.mode===WorkflowMode.ASSISTED && current && [WorkflowStepType.SUBMIT_SBC,WorkflowStepType.CLAIM_REWARD,WorkflowStepType.OPEN_REWARD_PACK,WorkflowStepType.RESOLVE_ITEMS,WorkflowStepType.HANDLE_PLAYER_PICK].includes(current.step.type)) {
      approveCurrent=window.confirm(`Approve destructive step ${current.step.type}?`); if(!approveCurrent)return;
    }
    await this.engine.resume({ approveCurrent, acknowledgeRecovery: run?.status===RunStatus.RECOVERY_REQUIRED, retryCurrent: current?.status==="failed" });
    await this.drive();
  }

  async refreshStatus() {
    try { const health=await this.adapter.health(); this.state.bridgeHealth=health.eaReady ? "healthy" : "initializing"; this.state.error=null; }
    catch(error){ this.state.bridgeHealth="unavailable"; this.state.error=error.message; }
    await this.refreshInventory().catch(()=>null); this.emit(); return this.getState();
  }

  async refreshInventory() {
    const raw=await this.adapter.readInventory();
    const snapshot=this.inventory.synchronize({ club:raw.club, storage:raw.storage, unassigned:raw.unassigned, storageCapacity:this.state.storageCapacity });
    const status=this.inventory.getStatus(); this.state.inventory=status; this.state.storageCount=status.storageCount; this.state.unassignedCount=status.unassignedCount; this.emit(); return snapshot;
  }

  async saveDraftProfile() {
    const id=`profile-${Date.now()}`; const profile=await this.profileService.save({ id, name:`Grind profile ${new Date().toLocaleString()}`, workflow:buildWorkflow(this.config), solverSettings:{}, fodderPolicy:{ protectRatingAtOrAbove:this.config.protectRatingAtOrAbove, protectedCardTypes:this.config.protectedCardTypes }, duplicatePolicy:{ quicksell:false, unresolved:"PAUSE" }, packPolicy:{ mode:this.config.packMode, maxPacks:1 }, pickPolicy:{ type:this.config.pickMode }, runLimits:{ maxIterations:this.config.maxIterations }, stopConditions:[], targetProjects:this.targets.list() });
    this.state.profiles=await this.profileService.list(); this.emit(); return profile;
  }
  async loadProfile(id) { const p=await this.profileService.get(id); if(!p)return; this.config={...this.defaultConfig(),maxIterations:p.runLimits.maxIterations,protectRatingAtOrAbove:p.fodderPolicy.protectRatingAtOrAbove,protectedCardTypes:p.fodderPolicy.protectedCardTypes||[],packMode:p.packPolicy.mode,pickMode:p.pickPolicy.type}; this.state.draft=this.config; this.emit(); }
  async exportCurrentProfile() { const p=this.state.profiles.at(-1) || await this.saveDraftProfile(); return this.profileService.export(p.id); }
  async importProfile(text) { await this.profileService.import(text,{overwrite:false}); this.state.profiles=await this.profileService.list(); this.emit(); }
  async setDeveloperMode(enabled) { enabled?this.dev.enable():this.dev.disable(); this.state.diagnostics={...this.dev.getStatus(),latest:this.state.diagnostics.latest||null}; this.emit(); }
  async takeDiagnosticSnapshot() { const health=await this.adapter.health().catch(error=>({error:error.message})); const latest=this.dev.captureSnapshot({ bridgeHealth:health,route:location.pathname,selectors:{controllerBridge:Boolean(window.eaData?.grindPilot)} }); this.state.diagnostics={...this.dev.getStatus(),latest,diff:this.dev.compareLatestSnapshots()}; this.emit(); return latest; }
  async exportDiagnostics() { return this.dev.exportDiagnostics({ healthChecks:[await this.adapter.health().catch(error=>({error:error.message}))], logs:this.logger.entries() }); }
  reportUiError(error) { this.state.error=error?.message||String(error); this.logger.error("Error",this.state.error,{code:error?.code||null}); this.emit(); }
  persistActivity() { clearTimeout(this.activityTimer); this.activityTimer=setTimeout(()=>this.storage.set({[ACTIVITY_KEY]:this.logger.entries()}).catch(()=>{}),250); }
}

if (globalThis.window && !globalThis.window.__grindPilotRuntime) {
  const runtime = new GrindPilotRuntime();
  globalThis.window.__grindPilotRuntime = runtime;
  runtime.initialize().catch((error) => {
    console.error("[GrindPilot] Initialization failed", { message: error?.message, code: error?.code });
  });
}

export { GrindPilotRuntime, buildWorkflow };
