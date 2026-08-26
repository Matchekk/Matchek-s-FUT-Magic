export const WORKFLOW_SCHEMA_VERSION = 1;

export const WorkflowStepType = Object.freeze({
  SOLVE_SBC: "SOLVE_SBC",
  SUBMIT_SBC: "SUBMIT_SBC",
  CLAIM_REWARD: "CLAIM_REWARD",
  OPEN_REWARD_PACK: "OPEN_REWARD_PACK",
  RESOLVE_ITEMS: "RESOLVE_ITEMS",
  ORGANIZE_ITEMS: "ORGANIZE_ITEMS",
  HANDLE_PLAYER_PICK: "HANDLE_PLAYER_PICK",
  DELAY: "DELAY",
  CONDITIONAL: "CONDITIONAL",
  LOOP: "LOOP",
  PAUSE: "PAUSE",
});

export const WORKFLOW_STEP_TYPES = Object.freeze(
  Object.values(WorkflowStepType),
);

export const WorkflowMode = Object.freeze({
  REVIEW: "REVIEW",
  ASSISTED: "ASSISTED",
  AUTO: "AUTO",
});

export const WORKFLOW_MODES = Object.freeze(Object.values(WorkflowMode));

export const StepStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAITING: "waiting",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed",
  PAUSED: "paused",
});

export const RunStatus = Object.freeze({
  RUNNING: "running",
  WAITING: "waiting",
  PAUSED: "paused",
  STOPPING: "stopping",
  STOPPED: "stopped",
  COMPLETED: "completed",
  FAILED: "failed",
  RECOVERY_REQUIRED: "recovery_required",
});

export const OnFailure = Object.freeze({
  PAUSE: "PAUSE",
  STOP: "STOP",
  SKIP: "SKIP",
});

export const ON_FAILURE_VALUES = Object.freeze(Object.values(OnFailure));

export const DESTRUCTIVE_STEP_TYPES = new Set([
  WorkflowStepType.SUBMIT_SBC,
  WorkflowStepType.CLAIM_REWARD,
  WorkflowStepType.OPEN_REWARD_PACK,
  WorkflowStepType.RESOLVE_ITEMS,
  WorkflowStepType.ORGANIZE_ITEMS,
  WorkflowStepType.HANDLE_PLAYER_PICK,
]);

export const TERMINAL_RUN_STATUSES = new Set([
  RunStatus.STOPPED,
  RunStatus.COMPLETED,
  RunStatus.FAILED,
]);

export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 1,
  delayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 30_000,
  retryableCodes: Object.freeze([]),
});

export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
export const MAX_STEP_TIMEOUT_MS = 10 * 60_000;
export const MAX_RETRY_ATTEMPTS = 10;
export const MAX_LOOP_ITERATIONS = 1_000;
export const MAX_WORKFLOW_STEPS = 2_000;
export const MAX_WORKFLOW_DEPTH = 24;
export const MAX_RUN_HISTORY = 500;

