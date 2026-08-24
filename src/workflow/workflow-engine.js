import {
  DESTRUCTIVE_STEP_TYPES,
  MAX_LOOP_ITERATIONS,
  MAX_RUN_HISTORY,
  OnFailure,
  RunStatus,
  StepStatus,
  TERMINAL_RUN_STATUSES,
  WORKFLOW_MODES,
  WorkflowMode,
  WorkflowStepType,
} from "./constants.js";
import { evaluateCondition } from "./conditions.js";
import {
  createAutoApproval,
  hashWorkflowDefinition,
  normalizeWorkflowDefinition,
} from "./definitions.js";
import {
  WorkflowError,
  WorkflowPersistenceError,
  WorkflowTimeoutError,
} from "./errors.js";
import { assertSerializable, cloneSerializable, isPlainObject } from "./serialization.js";

const defaultNow = () => Date.now();

const defaultIdFactory = (prefix = "workflow") => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeMode = (mode) => {
  const value = String(mode ?? WorkflowMode.REVIEW).trim().toUpperCase();
  if (!WORKFLOW_MODES.includes(value)) {
    throw new WorkflowError(`Unsupported workflow mode: ${value || "<empty>"}`, {
      code: "WORKFLOW_MODE_INVALID",
    });
  }
  return value;
};

const normalizeError = (error) => ({
  code: String(error?.code ?? "STEP_FAILED"),
  message: String(error?.message ?? error ?? "Workflow step failed"),
  details: cloneSerializable(error?.details ?? null),
  safeToRetry: error?.safeToRetry === true || error?.notApplied === true,
  ambiguous: error?.ambiguous === true,
});

const isDestructive = (step) => DESTRUCTIVE_STEP_TYPES.has(step?.type);

const calculateRetryDelay = (policy, attempt) => {
  const exponent = Math.max(0, Number(attempt) - 1);
  return Math.min(
    Number(policy.maxDelayMs),
    Math.round(Number(policy.delayMs) * Number(policy.backoffFactor) ** exponent),
  );
};

const handlerFor = (handlers, type) => {
  if (handlers instanceof Map) return handlers.get(type) ?? null;
  return handlers?.[type] ?? null;
};

const callHandlerMethod = (handler, method, args) => {
  if (typeof handler === "function") {
    return method === "execute" ? handler(args) : undefined;
  }
  return typeof handler?.[method] === "function" ? handler[method](args) : undefined;
};

export const evaluateWorkflowModeGate = ({ run, node }) => {
  if (!isDestructive(node?.step)) return { allowed: true };
  if (run.mode === WorkflowMode.REVIEW) {
    return {
      allowed: false,
      code: "REVIEW_MODE_DESTRUCTIVE_STEP",
      message: `${node.step.type} requires leaving REVIEW mode.`,
    };
  }
  if (run.mode === WorkflowMode.ASSISTED) {
    if (run.authorizations?.[node.executionId] === true) return { allowed: true };
    return {
      allowed: false,
      code: "ASSISTED_APPROVAL_REQUIRED",
      message: `Approve ${node.step.type} before continuing.`,
    };
  }
  const approval = run.approval;
  if (
    approval?.confirmed === true &&
    approval?.workflowId === run.workflowId &&
    Number(approval?.workflowVersion) === Number(run.workflowVersion) &&
    approval?.workflowHash === run.workflowHash
  ) {
    return { allowed: true };
  }
  return {
    allowed: false,
    code: "AUTO_APPROVAL_INVALID",
    message: "AUTO approval is missing or no longer matches the workflow.",
  };
};

const createExecutionNode = (run, step, runtime = {}) => {
  run.executionSequence += 1;
  return {
    executionId: `${step.id}::${run.executionSequence}`,
    definitionStepId: step.id,
    step: cloneSerializable(step),
    status: StepStatus.PENDING,
    attempt: 0,
    intent: null,
    result: null,
    error: null,
    waitUntil: null,
    startedAt: null,
    completedAt: null,
    runtime: cloneSerializable(runtime),
  };
};

const createRun = ({ definition, mode, approval, now, idFactory }) => {
  const createdAt = now();
  const run = {
    schemaVersion: 1,
    revision: 0,
    runId: idFactory("workflow-run"),
    workflowId: definition.id,
    workflowVersion: definition.version,
    workflowHash: hashWorkflowDefinition(definition),
    definition: cloneSerializable(definition),
    mode,
    status: RunStatus.RUNNING,
    pauseReason: null,
    approval: approval ? cloneSerializable(approval) : null,
    authorizations: {},
    cursor: 0,
    executionSequence: 0,
    nodes: [],
    counters: {
      completed: 0,
      skipped: 0,
      failed: 0,
      loopIterations: 0,
      transitions: 0,
    },
    history: [],
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    lastError: null,
  };
  run.nodes = definition.steps.map((step) => createExecutionNode(run, step));
  return run;
};

export class WorkflowEngine {
  constructor({
    repository,
    handlers = {},
    contextProvider = () => ({}),
    modeGate = evaluateWorkflowModeGate,
    now = defaultNow,
    idFactory = defaultIdFactory,
    setTimer = globalThis.setTimeout?.bind(globalThis),
    clearTimer = globalThis.clearTimeout?.bind(globalThis),
  } = {}) {
    if (!repository) {
      throw new WorkflowPersistenceError("WorkflowEngine requires a repository");
    }
    this.repository = repository;
    this.handlers = handlers;
    this.contextProvider = contextProvider;
    this.modeGate = modeGate;
    this.now = now;
    this.idFactory = idFactory;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.run = null;
    this.listeners = new Set();
    this.activeTick = null;
    this.controlRequest = null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return this.run ? cloneSerializable(this.run) : null;
  }

  async start(definitionValue, { mode = WorkflowMode.REVIEW, approval = null } = {}) {
    if (this.activeTick) throw new WorkflowError("Workflow engine is busy", { code: "WORKFLOW_BUSY" });
    const definition = normalizeWorkflowDefinition(definitionValue);
    const normalizedMode = normalizeMode(mode);
    const workflowHash = hashWorkflowDefinition(definition);
    if (normalizedMode === WorkflowMode.AUTO) {
      if (
        approval?.confirmed !== true ||
        approval?.workflowId !== definition.id ||
        Number(approval?.workflowVersion) !== Number(definition.version) ||
        approval?.workflowHash !== workflowHash
      ) {
        throw new WorkflowError("AUTO mode requires a matching confirmed approval", {
          code: "AUTO_APPROVAL_REQUIRED",
          details: { requiredApproval: createAutoApproval(definition) },
        });
      }
    }
    const existing = await this.repository.loadActiveRun();
    if (existing && !TERMINAL_RUN_STATUSES.has(existing.status)) {
      throw new WorkflowError("Another workflow run is still active", {
        code: "WORKFLOW_ALREADY_ACTIVE",
        details: { runId: existing.runId, status: existing.status },
      });
    }
    this.run = createRun({
      definition,
      mode: normalizedMode,
      approval,
      now: this.now,
      idFactory: this.idFactory,
    });
    this._record("RUN_STARTED", { mode: normalizedMode });
    assertSerializable(this.run, "Workflow run");
    this.run = await this.repository.createRun(this.run);
    this._emit();
    return this.getSnapshot();
  }

  async load(runId = null) {
    const loaded = runId == null
      ? await this.repository.loadActiveRun()
      : await this.repository.loadRun(runId);
    this.run = loaded ? cloneSerializable(loaded) : null;
    this._emit();
    return this.getSnapshot();
  }

  async tick() {
    if (this.activeTick) return this.activeTick;
    this.activeTick = this._tickCore().finally(() => {
      this.activeTick = null;
    });
    return this.activeTick;
  }

  async runUntilBlocked({ maxTransitions = 1_000 } = {}) {
    const limit = Math.max(1, Math.min(10_000, Math.trunc(Number(maxTransitions) || 1_000)));
    for (let index = 0; index < limit; index += 1) {
      const beforeRevision = this.run?.revision ?? -1;
      const snapshot = await this.tick();
      if (!snapshot || snapshot.status !== RunStatus.RUNNING) return snapshot;
      if ((snapshot.revision ?? -1) === beforeRevision) return snapshot;
    }
    if (this.run?.status === RunStatus.RUNNING) {
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: "TRANSITION_LIMIT_REACHED",
        message: "Workflow paused after reaching the transition safety limit.",
      };
      this._record("RUN_PAUSED", this.run.pauseReason);
      await this._persist();
    }
    return this.getSnapshot();
  }

  async pause({ reason = "Paused by user." } = {}) {
    this._requireRun();
    if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
    this.controlRequest = { type: "pause", reason: String(reason) };
    if (this.activeTick) await this.activeTick;
    if (this.run.status !== RunStatus.PAUSED) await this._applyControlRequest();
    return this.getSnapshot();
  }

  async stop({ reason = "Stopped by user." } = {}) {
    this._requireRun();
    if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
    this.controlRequest = { type: "stop", reason: String(reason) };
    if (this.activeTick) await this.activeTick;
    if (this.run.status !== RunStatus.STOPPED) await this._applyControlRequest();
    return this.getSnapshot();
  }

  async resume({
    approveCurrent = false,
    acknowledgeRecovery = false,
    retryCurrent = false,
    skipCurrent = false,
  } = {}) {
    this._requireRun();
    if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
    const node = this._currentNode();
    if (this.run.status === RunStatus.RECOVERY_REQUIRED && !acknowledgeRecovery) {
      throw new WorkflowError("Recovery must be acknowledged before resuming", {
        code: "RECOVERY_ACKNOWLEDGEMENT_REQUIRED",
      });
    }
    if (node?.status === StepStatus.FAILED) {
      if (skipCurrent) {
        node.status = StepStatus.SKIPPED;
        node.completedAt = this.now();
        this.run.counters.skipped += 1;
        this.run.cursor += 1;
      } else if (retryCurrent) {
        node.status = StepStatus.PENDING;
        node.attempt = 0;
        node.error = null;
        node.waitUntil = null;
      } else {
        throw new WorkflowError("Choose retryCurrent or skipCurrent for the failed step", {
          code: "FAILED_STEP_DECISION_REQUIRED",
        });
      }
    } else if (node?.status === StepStatus.PAUSED && node.step.type === WorkflowStepType.PAUSE) {
      this._completeNode(node, { resumed: true });
    } else if (node?.status === StepStatus.WAITING) {
      if (this.run.mode === WorkflowMode.REVIEW && isDestructive(node.step)) {
        throw new WorkflowError("REVIEW mode cannot authorize destructive steps", {
          code: "REVIEW_MODE_DESTRUCTIVE_STEP",
        });
      }
      if (this.run.mode === WorkflowMode.ASSISTED && isDestructive(node.step)) {
        if (!approveCurrent) {
          throw new WorkflowError("This step requires assisted approval", {
            code: "ASSISTED_APPROVAL_REQUIRED",
          });
        }
        this.run.authorizations[node.executionId] = true;
      }
      node.status = StepStatus.PENDING;
      node.waitUntil = null;
    }
    this.run.status = RunStatus.RUNNING;
    this.run.pauseReason = null;
    this.controlRequest = null;
    this._record("RUN_RESUMED", {
      approveCurrent: Boolean(approveCurrent),
      acknowledgeRecovery: Boolean(acknowledgeRecovery),
    });
    await this._persist();
    return this.getSnapshot();
  }

  async recover(runId = null) {
    await this.load(runId);
    this._requireRun();
    if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
    if (this.run.status === RunStatus.STOPPING) {
      this.run.status = RunStatus.STOPPED;
      this.run.pauseReason = null;
      this._record("RUN_RECOVERED_AS_STOPPED");
      await this._persist();
      return this.getSnapshot();
    }
    const node = this._currentNode();
    if (!node) {
      this.run.status = RunStatus.COMPLETED;
      this.run.completedAt = this.now();
      this._record("RUN_RECOVERED_AS_COMPLETED");
      await this._persist();
      return this.getSnapshot();
    }
    if (node.status === StepStatus.RUNNING) {
      const handler = handlerFor(this.handlers, node.step.type);
      const recoveryMethod = typeof handler?.recover === "function";
      if (recoveryMethod) {
        const context = await this._getContext(node);
        let outcome;
        try {
          outcome = await callHandlerMethod(handler, "recover", {
            step: cloneSerializable(node.step),
            node: cloneSerializable(node),
            run: this.getSnapshot(),
            context,
          });
        } catch (error) {
          outcome = { status: "ambiguous", error: normalizeError(error) };
        }
        const status = String(outcome?.status ?? "ambiguous").toLowerCase();
        if (status === "completed") {
          this._completeNode(node, outcome?.result ?? null);
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: "RECOVERED_STEP_COMPLETED",
            message: "The interrupted step was verified as completed. Resume to continue.",
          };
        } else if (status === "not_applied" || status === "retry") {
          node.status = StepStatus.PENDING;
          node.error = null;
          this.run.status = RunStatus.PAUSED;
          this.run.pauseReason = {
            code: "RECOVERED_STEP_NOT_APPLIED",
            message: "The interrupted step was verified as not applied. Resume to retry.",
          };
        } else {
          this._requireRecovery(node, {
            code: "RECOVERY_AMBIGUOUS",
            message: outcome?.error?.message ?? "The interrupted operation is ambiguous.",
          });
        }
      } else if (isDestructive(node.step)) {
        this._requireRecovery(node, {
          code: "RECOVERY_HANDLER_REQUIRED",
          message: "A destructive operation was interrupted and cannot be verified.",
        });
      } else {
        node.status = StepStatus.PENDING;
        node.error = null;
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: "RECOVERED_SAFE_RETRY",
          message: "The non-destructive step can be retried. Resume to continue.",
        };
      }
    } else if (this.run.status === RunStatus.RUNNING) {
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: "RECOVERED_SAFE_BOUNDARY",
        message: "Workflow recovered at a safe boundary. Resume to continue.",
      };
    }
    this._record("RUN_RECOVERED", { status: this.run.status });
    await this._persist();
    return this.getSnapshot();
  }

  async _tickCore() {
    this._requireRun();
    if (this.controlRequest) {
      await this._applyControlRequest();
      return this.getSnapshot();
    }
    if (TERMINAL_RUN_STATUSES.has(this.run.status)) return this.getSnapshot();
    const node = this._currentNode();
    if (!node) {
      this.run.status = RunStatus.COMPLETED;
      this.run.completedAt = this.now();
      this.run.pauseReason = null;
      this._record("RUN_COMPLETED");
      await this._persist();
      return this.getSnapshot();
    }
    if (this.run.status === RunStatus.PAUSED || this.run.status === RunStatus.RECOVERY_REQUIRED) {
      return this.getSnapshot();
    }
    if (this.run.status === RunStatus.WAITING) {
      if (node.waitUntil == null || this.now() < node.waitUntil) return this.getSnapshot();
      node.status = StepStatus.PENDING;
      node.waitUntil = null;
      this.run.status = RunStatus.RUNNING;
      this._record("STEP_WAIT_FINISHED", { executionId: node.executionId });
      await this._persist();
      return this.getSnapshot();
    }
    if (node.status === StepStatus.COMPLETED || node.status === StepStatus.SKIPPED) {
      this.run.cursor += 1;
      await this._persist();
      return this.getSnapshot();
    }

    if (node.step.type === WorkflowStepType.CONDITIONAL) {
      await this._executeConditional(node);
    } else if (node.step.type === WorkflowStepType.LOOP) {
      await this._executeLoop(node);
    } else if (node.step.type === WorkflowStepType.DELAY) {
      await this._executeDelay(node);
    } else if (node.step.type === WorkflowStepType.PAUSE) {
      node.status = StepStatus.PAUSED;
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: "PAUSE_STEP_REACHED",
        message: node.step.config.reason,
      };
      this._record("STEP_PAUSED", { executionId: node.executionId });
      await this._persist();
    } else {
      await this._executeHandler(node);
    }

    if (this.controlRequest && !TERMINAL_RUN_STATUSES.has(this.run.status)) {
      await this._applyControlRequest();
    }
    return this.getSnapshot();
  }

  async _executeConditional(node) {
    try {
      const context = await this._getContext(node);
      const conditionResult = evaluateCondition(node.step.config.condition, context);
      const selected = conditionResult
        ? node.step.config.thenSteps
        : node.step.config.elseSteps;
      const inserted = selected.map((step) => createExecutionNode(this.run, step, {
        parentExecutionId: node.executionId,
        branch: conditionResult ? "then" : "else",
      }));
      this.run.nodes.splice(this.run.cursor + 1, 0, ...inserted);
      this._completeNode(node, {
        conditionResult,
        branch: conditionResult ? "then" : "else",
        inserted: inserted.length,
      });
      this._record("CONDITION_EVALUATED", {
        executionId: node.executionId,
        conditionResult,
      });
      await this._persist();
    } catch (error) {
      await this._handleStepError(node, error);
    }
  }

  async _executeLoop(node) {
    try {
      const iteration = Math.max(0, Number(node.runtime?.iteration) || 0);
      const maxIterations = Number(node.step.config.maxIterations) || 1;
      let conditionResult = true;
      if (node.step.config.condition != null) {
        conditionResult = evaluateCondition(
          node.step.config.condition,
          await this._getContext(node, { loopIteration: iteration }),
        );
      }
      if (iteration >= maxIterations || !conditionResult) {
        this._completeNode(node, {
          done: true,
          iterations: iteration,
          conditionResult,
        });
        this._record("LOOP_COMPLETED", {
          executionId: node.executionId,
          iterations: iteration,
        });
        await this._persist();
        return;
      }
      if (this.run.counters.loopIterations >= MAX_LOOP_ITERATIONS) {
        throw new WorkflowError("Workflow loop safety limit reached", {
          code: "LOOP_LIMIT_REACHED",
        });
      }
      this.run.counters.loopIterations += 1;
      const body = node.step.config.body.map((step) =>
        createExecutionNode(this.run, step, {
          parentExecutionId: node.executionId,
          loopStepId: node.step.id,
          iteration: iteration + 1,
        }),
      );
      const nextLoop = createExecutionNode(this.run, node.step, {
        ...node.runtime,
        iteration: iteration + 1,
      });
      this.run.nodes.splice(this.run.cursor + 1, 0, ...body, nextLoop);
      this._completeNode(node, {
        done: false,
        iteration: iteration + 1,
        inserted: body.length,
      });
      this._record("LOOP_ITERATION_STARTED", {
        executionId: node.executionId,
        iteration: iteration + 1,
      });
      await this._persist();
    } catch (error) {
      await this._handleStepError(node, error);
    }
  }

  async _executeDelay(node) {
    const durationMs = Number(node.step.config.durationMs) || 0;
    if (durationMs <= 0) {
      this._completeNode(node, { durationMs: 0 });
      await this._persist();
      return;
    }
    node.status = StepStatus.WAITING;
    node.waitUntil = this.now() + durationMs;
    node.result = { durationMs, wakeAt: node.waitUntil };
    this.run.status = RunStatus.WAITING;
    this._record("STEP_WAITING", {
      executionId: node.executionId,
      wakeAt: node.waitUntil,
    });
    await this._persist();
  }

  async _executeHandler(node) {
    const gate = await this.modeGate({
      run: this.getSnapshot(),
      node: cloneSerializable(node),
    });
    if (!gate?.allowed) {
      node.status = StepStatus.WAITING;
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: gate?.code ?? "STEP_APPROVAL_REQUIRED",
        message: gate?.message ?? "Step approval is required.",
        executionId: node.executionId,
      };
      this._record("STEP_GATED", this.run.pauseReason);
      await this._persist();
      return;
    }

    const handler = handlerFor(this.handlers, node.step.type);
    if (!handler) {
      await this._handleStepError(
        node,
        new WorkflowError(`No handler registered for ${node.step.type}`, {
          code: "STEP_HANDLER_MISSING",
        }),
      );
      return;
    }
    const context = await this._getContext(node);
    try {
      if (!node.intent) {
        const prepared = await callHandlerMethod(handler, "prepare", {
          step: cloneSerializable(node.step),
          run: this.getSnapshot(),
          context,
        });
        node.intent = {
          operationId: this.idFactory("workflow-operation"),
          stepId: node.step.id,
          type: node.step.type,
          preparedAt: this.now(),
          ...(isPlainObject(prepared) ? cloneSerializable(prepared) : {}),
        };
        assertSerializable(node.intent, "Workflow step intent");
        this._record("STEP_INTENT_PREPARED", {
          executionId: node.executionId,
          operationId: node.intent.operationId,
        });
        await this._persist();
      }

      node.attempt += 1;
      node.status = StepStatus.RUNNING;
      node.startedAt = node.startedAt ?? this.now();
      node.error = null;
      this._record("STEP_STARTED", {
        executionId: node.executionId,
        attempt: node.attempt,
      });
      await this._persist();

      const abortController = typeof AbortController === "function"
        ? new AbortController()
        : null;
      const execution = callHandlerMethod(handler, "execute", {
        step: cloneSerializable(node.step),
        intent: cloneSerializable(node.intent),
        run: this.getSnapshot(),
        context,
        attempt: node.attempt,
        signal: abortController?.signal ?? null,
      });
      const outcome = await this._withTimeout(
        execution,
        node.step.timeoutMs,
        abortController,
      );
      assertSerializable(outcome, "Workflow step result");
      const outcomeStatus = String(outcome?.status ?? "completed").toLowerCase();
      if (outcomeStatus === "waiting") {
        node.status = StepStatus.WAITING;
        node.result = cloneSerializable(outcome?.result ?? null);
        node.waitUntil = Number.isFinite(Number(outcome?.resumeAt))
          ? Number(outcome.resumeAt)
          : null;
        this.run.status = RunStatus.WAITING;
        this._record("STEP_WAITING", { executionId: node.executionId, wakeAt: node.waitUntil });
      } else if (outcomeStatus === "paused") {
        node.status = StepStatus.PAUSED;
        node.result = cloneSerializable(outcome?.result ?? null);
        this.run.status = RunStatus.PAUSED;
        this.run.pauseReason = {
          code: String(outcome?.code ?? "HANDLER_PAUSED"),
          message: String(outcome?.message ?? "Step paused by its handler."),
        };
      } else if (outcomeStatus === "skipped") {
        this._skipNode(node, outcome?.result ?? null);
      } else if (outcomeStatus === "failed") {
        const error = new WorkflowError(outcome?.message ?? "Step handler reported failure", {
          code: outcome?.code ?? "STEP_FAILED",
          details: outcome?.details ?? null,
        });
        error.safeToRetry = outcome?.safeToRetry === true;
        error.ambiguous = outcome?.ambiguous === true;
        throw error;
      } else {
        this._completeNode(node, outcome?.result ?? outcome ?? null);
      }
      await this._persist();
    } catch (error) {
      await this._handleStepError(node, error);
    }
  }

  async _handleStepError(node, error) {
    if (node.status !== StepStatus.RUNNING) node.attempt += 1;
    const normalized = normalizeError(error);
    const destructive = isDestructive(node.step);
    const ambiguous =
      normalized.ambiguous ||
      (destructive && normalized.safeToRetry !== true);
    node.error = normalized;
    this.run.lastError = {
      ...normalized,
      executionId: node.executionId,
      at: this.now(),
    };
    if (ambiguous) {
      node.status = StepStatus.FAILED;
      this.run.counters.failed += 1;
      this._requireRecovery(node, {
        code: "DESTRUCTIVE_STEP_AMBIGUOUS",
        message: normalized.message,
      });
      this._record("STEP_AMBIGUOUS", { executionId: node.executionId, error: normalized });
      await this._persist();
      return;
    }

    const policy = node.step.retryPolicy;
    const retryCodes = Array.isArray(policy.retryableCodes) ? policy.retryableCodes : [];
    const codeAllowed = retryCodes.length === 0 || retryCodes.includes(normalized.code);
    if (node.attempt < policy.maxAttempts && codeAllowed) {
      const delayMs = calculateRetryDelay(policy, node.attempt);
      node.status = StepStatus.WAITING;
      node.waitUntil = this.now() + delayMs;
      this.run.status = RunStatus.WAITING;
      this._record("STEP_RETRY_SCHEDULED", {
        executionId: node.executionId,
        attempt: node.attempt,
        wakeAt: node.waitUntil,
        error: normalized,
      });
      await this._persist();
      return;
    }

    this.run.counters.failed += 1;
    node.status = StepStatus.FAILED;
    node.completedAt = this.now();
    if (node.step.onFailure === OnFailure.SKIP) {
      node.status = StepStatus.SKIPPED;
      this.run.counters.skipped += 1;
      this.run.cursor += 1;
      this.run.status = RunStatus.RUNNING;
      this._record("STEP_SKIPPED_AFTER_FAILURE", { executionId: node.executionId, error: normalized });
    } else if (node.step.onFailure === OnFailure.STOP) {
      this.run.status = RunStatus.FAILED;
      this.run.completedAt = this.now();
      this._record("RUN_FAILED", { executionId: node.executionId, error: normalized });
    } else {
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: "STEP_FAILED",
        message: normalized.message,
        executionId: node.executionId,
      };
      this._record("RUN_PAUSED_AFTER_FAILURE", this.run.pauseReason);
    }
    await this._persist();
  }

  async _withTimeout(value, timeoutMs, abortController = null) {
    if (!this.setTimer || !this.clearTimer) return Promise.resolve(value);
    let timerId;
    try {
      return await Promise.race([
        Promise.resolve(value),
        new Promise((_, reject) => {
          timerId = this.setTimer(
            () => {
              abortController?.abort?.();
              reject(new WorkflowTimeoutError(timeoutMs));
            },
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timerId != null) this.clearTimer(timerId);
    }
  }

  async _getContext(node, extra = {}) {
    const context = await this.contextProvider({
      run: this.getSnapshot(),
      node: cloneSerializable(node),
      ...extra,
    });
    return isPlainObject(context) ? context : {};
  }

  _completeNode(node, result) {
    node.status = StepStatus.COMPLETED;
    node.result = cloneSerializable(result ?? null);
    node.error = null;
    node.waitUntil = null;
    node.completedAt = this.now();
    this.run.counters.completed += 1;
    this.run.cursor += 1;
    this._record("STEP_COMPLETED", { executionId: node.executionId, type: node.step.type });
  }

  _skipNode(node, result) {
    node.status = StepStatus.SKIPPED;
    node.result = cloneSerializable(result ?? null);
    node.completedAt = this.now();
    this.run.counters.skipped += 1;
    this.run.cursor += 1;
    this._record("STEP_SKIPPED", { executionId: node.executionId, type: node.step.type });
  }

  _requireRecovery(node, reason) {
    this.run.status = RunStatus.RECOVERY_REQUIRED;
    this.run.pauseReason = {
      ...cloneSerializable(reason),
      executionId: node?.executionId ?? null,
    };
  }

  _currentNode() {
    return this.run?.nodes?.[this.run.cursor] ?? null;
  }

  _requireRun() {
    if (!this.run) throw new WorkflowError("No workflow run is loaded", { code: "WORKFLOW_NOT_LOADED" });
  }

  _record(type, details = null) {
    if (!this.run) return;
    this.run.counters.transitions += 1;
    this.run.history.push({
      sequence: this.run.counters.transitions,
      at: this.now(),
      type,
      details: details == null ? null : cloneSerializable(details),
    });
    if (this.run.history.length > MAX_RUN_HISTORY) {
      this.run.history.splice(0, this.run.history.length - MAX_RUN_HISTORY);
    }
  }

  async _applyControlRequest() {
    if (!this.controlRequest || !this.run) return;
    const request = this.controlRequest;
    this.controlRequest = null;
    if (request.type === "stop") {
      this.run.status = RunStatus.STOPPED;
      this.run.completedAt = this.now();
      this.run.pauseReason = null;
      this._record("RUN_STOPPED", { reason: request.reason });
    } else {
      this.run.status = RunStatus.PAUSED;
      this.run.pauseReason = {
        code: "USER_PAUSED",
        message: request.reason,
      };
      this._record("RUN_PAUSED", this.run.pauseReason);
    }
    await this._persist();
  }

  async _persist() {
    this._requireRun();
    const expectedRevision = Number(this.run.revision) || 0;
    // Keep the in-memory object identity stable: active handlers retain a
    // reference to their execution node across the intent/running/result
    // checkpoints. Replacing the run with a repository clone would make that
    // node stale and lose later transitions.
    this.run.revision = expectedRevision + 1;
    this.run.updatedAt = this.now();
    assertSerializable(this.run, "Workflow run");
    try {
      await this.repository.saveRun(this.run, { expectedRevision });
    } catch (error) {
      this.run.revision = expectedRevision;
      throw error;
    }
    this._emit();
    return this.run;
  }

  _emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // UI observers must not roll back a checkpoint that was already
        // committed, but their failures still need to remain visible.
        console.error("[GrindPilot] Workflow listener failed", error);
      }
    }
  }
}

export { createAutoApproval };
